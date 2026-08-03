import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { can } from "../../../helpers/permissions.js";
import { normalizeSettlementCutoffTime } from "../../../helpers/business-day.js";
import { createStoreWorkDateKey } from "../../../helpers/work-date-utils.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import type {
  ShopAttendanceAssigneeType,
  ShopAttendanceType,
} from "../../../repository/firestore/shop/shop.types.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { subtractMoney, sumMoney } from "../../../helpers/money.js";
import {
  areAttendanceServiceReferencesValid,
  parseAttendancePayload,
} from "../domain/attendance-payload.js";
import { resolveAttendanceTimingForStore } from "../domain/attendance-timing.js";
import { mergeAttendanceAssignees, resolveAttendanceServices } from "../domain/attendance-money.js";
import {
  attachEmployeeNamesToServiceAssignees,
  buildAssigneesWithoutServiceShares,
  resolveAttendanceAssigneeInputs,
  toEmployeePresentationItem,
} from "../domain/attendance-employees.js";
import { isAttendanceReadyForConfirmation } from "../domain/attendance-rules.js";
import { toAttendanceActorRole } from "../domain/attendance-origin.js";
import {
  normalizeAttendanceForResponse,
  toFrontendAttendanceItem,
} from "../domain/attendance-presentation.js";
import { resolveAttendanceStoreScope } from "../domain/attendance-store-scope.js";
import {
  applyClosingRecalculation,
  buildClosingRecalculationForBackfill,
  isClosingInvalidAfterBackfill,
} from "./attendance-settlement-recalculation.js";
// Dùng lại helper + bảng lỗi của endpoint tạo thường (sibling cùng module) — không đẻ file shared riêng.
import {
  ATTENDANCE_CREATE_SERVICE_ERRORS as SERVICE_ERRORS,
  buildAttendanceDocumentData,
  resolveAttendanceDiscount,
} from "./post-create-attendance.js";
import {
  addActiveAttendanceSpanEvent,
  setActiveAttendanceSpanAttributes,
  withAttendanceSpan,
} from "./attendance-observability.js";
import {
  ATTENDANCE_TRACE_CHILD_SPANS,
  ATTENDANCE_TRACE_EVENTS,
} from "./attendance-tracing-contract.js";

// Ghi bù chấm công vào một ngày ĐÃ chốt sổ: tạo chấm công `closed` rồi tính lại lương của ngày đó.
// Chỉ chủ/quản lý (`attendance:backfill`). Ngày chưa chốt → dùng POST .../attendances (endpoint thường).
export const backfillAttendance = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (!can(authContext.role, "attendance:backfill")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenAttendance, {
      reason: "backfill requires owner or manager",
      role: authContext.role,
    });
  }

  const attendancePayloadParseResult = parseAttendancePayload(mergeUrlPathStoreId(req, req.body));

  if (!attendancePayloadParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "invalid attendance payload",
    });
  }

  const requestedStoreId = attendancePayloadParseResult.data.storeId;
  const storeScope = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.scopeResolve,
    { "app.store_id": requestedStoreId },
    () => resolveAttendanceStoreScope(authContext, requestedStoreId),
  );

  // Không resolve được store = không có quyền vào store đó → 403 (đồng bộ với các endpoint attendance khác).
  if (!storeScope) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      storeId: attendancePayloadParseResult.data.storeId,
    });
  }

  const attendanceInput = { ...attendancePayloadParseResult.data, storeId: storeScope.storeId };

  const [store, activeEmployeesInStore, serviceCatalog] = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.contextLoad,
    { "app.store_id": attendanceInput.storeId },
    () =>
      Promise.all([
        storeScope.store ??
          firestoreRepository.shop.store.getStore(authContext.ownerId, attendanceInput.storeId),
        firestoreRepository.user
          .listShopEmployees(authContext.ownerId, {
            storeId: attendanceInput.storeId,
            active: true,
          })
          .then((employees) => employees.map(toEmployeePresentationItem)),
        firestoreRepository.shop.service.getShopServiceFactory(
          authContext.ownerId,
          attendanceInput.storeId,
        ),
      ]),
  );
  const settlementCutoffTime = normalizeSettlementCutoffTime(store.settlementCutoffTime);
  const attendanceTiming = resolveAttendanceTimingForStore(attendanceInput, {
    storeTimezone: store.timezone,
    settlementCutoffTime,
  });
  const activeEmployeesInStoreByUid = new Map(
    activeEmployeesInStore.map((employee) => [employee.uid, employee]),
  );
  const attendanceServiceInputs = attendanceInput.services;

  if (!areAttendanceServiceReferencesValid(attendanceServiceInputs, serviceCatalog)) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "invalid service references",
    });
  }

  // `assignees` đã là hợp (thợ trong services) ∪ (thợ chính FE khai), dedupe sẵn — kiểm mọi người có
  // đang làm ở store không.
  const attendanceAssigneeInputs = attendanceInput.assignees;
  const resolvedAssigneeInputs = resolveAttendanceAssigneeInputs(
    attendanceAssigneeInputs,
    activeEmployeesInStore,
  );
  const assigneeInputsFoundInStore = resolvedAssigneeInputs.filter(
    (assignee): assignee is NonNullable<(typeof resolvedAssigneeInputs)[number]> =>
      assignee !== undefined,
  );

  if (assigneeInputsFoundInStore.length !== attendanceAssigneeInputs.length) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "unresolved assignees",
    });
  }

  const effectiveWorkDate = attendanceTiming.workDate;
  const existingSettlement = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.workDayCheck,
    {
      "app.store_id": attendanceInput.storeId,
      "attendance.work_date": effectiveWorkDate,
    },
    () =>
      firestoreRepository.shop.settlement.getWorkDaySettlement(
        authContext.ownerId,
        attendanceInput.storeId,
        effectiveWorkDate,
      ),
  );
  setActiveAttendanceSpanAttributes({
    "attendance.work_day_closed": existingSettlement?.status === "closed",
  });

  // Endpoint này CHỈ dành cho ngày đã chốt sổ. Ngày chưa chốt → dùng POST .../attendances.
  if (existingSettlement?.status !== "closed" || existingSettlement.closing === undefined) {
    return createErrorResponse(res, SERVICE_ERRORS.workDayNotClosed, {
      storeId: attendanceInput.storeId,
      workDate: effectiveWorkDate,
    });
  }
  const existingClosing = existingSettlement.closing;

  const attendanceServices = resolveAttendanceServices(attendanceServiceInputs, {
    ownerId: authContext.ownerId,
    storeId: attendanceInput.storeId,
    serviceCatalog,
  }).map((service) => ({
    ...service,
    employees: attachEmployeeNamesToServiceAssignees(
      service.employees ?? [],
      activeEmployeesInStoreByUid,
    ),
  }));
  const subtotalAmount = sumMoney(attendanceServices.map((service) => service.price));
  const assigneesWithServiceShares = mergeAttendanceAssignees(attendanceServices, subtotalAmount);
  let normalizedAssignees: ShopAttendanceAssigneeType[];

  if (assigneesWithServiceShares.length > 0) {
    normalizedAssignees = assigneesWithServiceShares;
  } else {
    normalizedAssignees = buildAssigneesWithoutServiceShares(
      assigneeInputsFoundInStore,
      activeEmployeesInStoreByUid,
    );
  }

  if (
    !isAttendanceReadyForConfirmation({
      employeeUserId: attendanceInput.mainAssigneeUserId,
      assignees: normalizedAssignees,
      services: attendanceServices,
    })
  ) {
    return createErrorResponse(res, SERVICE_ERRORS.confirmationIncomplete, {
      reason: "missing assigned employee or service",
    });
  }

  const discountResolution = resolveAttendanceDiscount(subtotalAmount, attendanceInput);

  if (discountResolution.invalidReason !== undefined) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidDiscountValue, {
      reason: discountResolution.invalidReason,
    });
  }

  const discount = discountResolution.discount;
  const totalAmount = Math.max(0, subtractMoney(subtotalAmount, discount?.amount ?? 0));
  const storeWorkDateKey = createStoreWorkDateKey(attendanceInput.storeId, effectiveWorkDate);
  const createdAtTimestamp = Date.now();
  const rolledToNextWorkDate = effectiveWorkDate !== attendanceInput.workDate;

  setActiveAttendanceSpanAttributes({
    "attendance.source": "walk_in",
    "attendance.work_date": effectiveWorkDate,
    "attendance.work_date_relation": rolledToNextWorkDate
      ? "next_work_date"
      : "requested_work_date",
    "attendance.is_future": false,
    "attendance.ready_for_confirmation": true,
    "attendance.create_mode": "owner_backfill_closed",
    "attendance.closed_day_edit": true,
    "attendance.service_count": attendanceServices.length,
    "attendance.main_assignee_present": attendanceInput.mainAssigneeUserId !== undefined,
    "attendance.assistant_assignee_present": attendanceInput.assistantAssigneeUserId !== undefined,
  });

  // Ghi bù vào ngày đã chốt → chấm công tạo ra là "closed" ngay.
  const attendanceDocumentData = buildAttendanceDocumentData({
    attendanceInput,
    bookingId: attendanceInput.bookingId ?? randomUUID(),
    attendanceTiming,
    storeName: store.name,
    storeWorkDateKey,
    workDate: effectiveWorkDate,
    settlementCutoffTime,
    assignees: normalizedAssignees,
    services: attendanceServices,
    subtotalAmount,
    totalAmount,
    discount,
    settlementStatus: "closed",
    closedAtTimestamp: createdAtTimestamp,
    actorUserId: authContext.uid,
    actorRole: toAttendanceActorRole(authContext.role),
    source: "walk_in",
    bookingStatus: "confirmed",
  });

  // Tính trước kết quả chốt sổ mới (chấm công cũ của ngày + chấm công sắp ghi) để CHẶN nếu ra trạng
  // thái không hợp lệ, TRƯỚC khi ghi document.
  const candidateAttendance: ShopAttendanceType = {
    id: "__pending_owner_backfill__",
    ownerId: authContext.ownerId,
    ...attendanceDocumentData,
    createdAt: createdAtTimestamp,
    updatedAt: createdAtTimestamp,
  };
  const closingRecalculation = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.settlementRecalculate,
    {
      "app.store_id": attendanceInput.storeId,
      "attendance.work_date": effectiveWorkDate,
      "attendance.closed_day_edit": true,
    },
    () =>
      buildClosingRecalculationForBackfill(
        authContext.ownerId,
        {
          ...existingSettlement,
          status: "closed",
          closing: existingClosing,
        },
        candidateAttendance,
        activeEmployeesInStore,
      ),
  );

  if (
    isClosingInvalidAfterBackfill(
      closingRecalculation.attendances,
      closingRecalculation.settlementPreview,
    )
  ) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidSettlementState, {
      storeId: attendanceInput.storeId,
      workDate: effectiveWorkDate,
    });
  }

  if (attendanceInput.customerPhone !== undefined || attendanceInput.customerName !== undefined) {
    const customer = await withAttendanceSpan(
      ATTENDANCE_TRACE_CHILD_SPANS.customerResolve,
      {
        "app.store_id": attendanceInput.storeId,
        "attendance.customer_lookup_present": true,
      },
      () =>
        firestoreRepository.shop.customer.createShopCustomer(authContext.ownerId, {
          storeId: attendanceInput.storeId,
          ...(attendanceInput.customerPhone !== undefined && {
            phone: attendanceInput.customerPhone,
          }),
          ...(attendanceInput.customerName !== undefined && {
            name: attendanceInput.customerName,
          }),
        }),
    );
    if (customer?.blocked === true) {
      return createErrorResponse(res, SERVICE_ERRORS.customerBlocked, {
        storeId: attendanceInput.storeId,
      });
    }
    if (customer !== undefined) {
      attendanceDocumentData.customerId = customer.id;
    }
  }

  const createdAttendanceDocument = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.persist,
    {
      "app.store_id": attendanceInput.storeId,
      "attendance.persist_action": "create",
      "attendance.source": "walk_in",
      "attendance.closed_day_edit": true,
      "attendance.service_count": attendanceServices.length,
    },
    () =>
      firestoreRepository.shop.attendance.createShopAttendance(
        authContext.ownerId,
        attendanceDocumentData,
      ),
  );
  const attendanceId = createdAttendanceDocument.id;
  setActiveAttendanceSpanAttributes({ "attendance.id": attendanceId });

  addActiveAttendanceSpanEvent(ATTENDANCE_TRACE_EVENTS.writeCommitted, {
    "attendance.id": attendanceId,
    "attendance.persist_action": "create",
  });

  await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.settlementRecalculate,
    {
      "app.store_id": attendanceInput.storeId,
      "attendance.post_write_phase": "settlement_recalculate",
    },
    () =>
      applyClosingRecalculation(authContext.ownerId, closingRecalculation, {
        triggeredBy: { kind: "backfill", attendanceId },
        actorUserId: authContext.uid,
        fallbackStoreTimezone: attendanceTiming.storeTimezone,
      }),
  );
  const recalculatedSettlementDates = [closingRecalculation.settlement.workDate];

  await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.auditWrite,
    { "attendance.post_write_phase": "audit" },
    () =>
      writeShopAuditLog({
        ownerId: authContext.ownerId,
        eventType: "attendance_created",
        entityType: "attendance",
        entityId: attendanceId,
        storeId: attendanceInput.storeId,
        workDate: effectiveWorkDate,
        actor: {
          uid: authContext.uid,
          role: authContext.role,
        },
        metadata: {
          subtotalAmount,
          discountAmount: discount?.amount ?? 0,
          totalAmount,
          status: "closed",
          bookingStatus: attendanceDocumentData.bookingStatus,
          source: attendanceDocumentData.source,
          createMode: "owner_backfill_closed",
          recalculatedSettlementDates,
          serviceNames: attendanceServices.map((service) => service.name),
          serviceCount: attendanceServices.length,
          assigneeCount: normalizedAssignees.length,
          assigneeEmployeeUserIds: normalizedAssignees.map((assignee) => assignee.employeeUserId),
          rolledToNextWorkDate,
        },
      }),
  );
  const attendanceForResponse = normalizeAttendanceForResponse(createdAttendanceDocument);

  return res.status(StatusCodes.CREATED).json({
    item: toFrontendAttendanceItem(attendanceForResponse, { redactCustomerInfo: false }),
    meta: {
      storeId: attendanceInput.storeId,
      workDate: effectiveWorkDate,
      rolledToNextWorkDate,
      createMode: "owner_backfill_closed",
      recalculatedSettlementDates,
    },
  });
};
