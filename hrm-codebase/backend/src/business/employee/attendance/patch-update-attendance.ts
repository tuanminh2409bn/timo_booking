import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  ATTENDANCE_CREATE_SERVICE_ERRORS,
  resolveAttendanceDiscount,
} from "./post-create-attendance.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { can } from "../../../helpers/permissions.js";
import {
  normalizeSettlementCutoffTime,
  resolveBusinessWorkDate,
} from "../../../helpers/business-day.js";
import { createStoreWorkDateKey } from "../../../helpers/work-date-utils.js";
import { getStoreIdFromUrlPath, mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import type { ShopAttendanceType } from "../../../repository/firestore/shop/shop.types.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { subtractMoney, sumMoney } from "../../../helpers/money.js";
import {
  canManageAttendance,
  getAttendanceMainAssigneeUserId,
  isAttendanceMainAssignee,
  isAttendanceReadyForConfirmation,
  MAX_EMPLOYEE_PAST_ATTENDANCE_DAYS,
} from "../domain/attendance-rules.js";
import {
  areAttendanceServiceReferencesValid,
  parseAttendancePayload,
} from "../domain/attendance-payload.js";
import {
  countDaysWorkDateIsInThePast,
  isAttendanceStartInFuture,
  resolveAttendanceTimingForStore,
} from "../domain/attendance-timing.js";
import { mergeAttendanceAssignees, resolveAttendanceServices } from "../domain/attendance-money.js";
import {
  applyAttendanceAssigneeRoles,
  attachEmployeeNamesToServiceAssignees,
  buildAssigneesWithoutServiceShares,
  resolveAttendanceAssigneeInputs,
  toEmployeePresentationItem,
} from "../domain/attendance-employees.js";
import {
  normalizeAttendanceForResponse,
  toFrontendAttendanceItem,
} from "../domain/attendance-presentation.js";
import {
  resolveStoredAttendanceSource,
  toAttendanceActorRole,
} from "../domain/attendance-origin.js";
import {
  applyClosingRecalculation,
  getAffectedAttendanceWorkDates,
  prepareAffectedClosingRecalculations,
} from "./attendance-settlement-recalculation.js";
import { synchronizeWorkDaySettlement } from "../work-days/work-day-settlement-sync.js";
import {
  addActiveAttendanceSpanEvent,
  setActiveAttendanceSpanAttributes,
  withAttendanceSpan,
} from "./attendance-observability.js";
import {
  ATTENDANCE_TRACE_CHILD_SPANS,
  ATTENDANCE_TRACE_EVENTS,
} from "./attendance-tracing-contract.js";

const SERVICE_ERRORS = {
  forbiddenAttendance: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/forbidden-attendance",
    message: "Forbidden: attendance access denied",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/forbidden-store",
    message: "Forbidden: store access denied",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/attendances/invalid-request",
    message: "Invalid request",
  },
  attendanceLocked: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/attendances/attendance-locked",
    message: "Attendance cannot be edited after close-day confirmation",
  },
  attendanceClosed: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/attendances/attendance-closed",
    message: "Attendance cannot be edited after it has been closed",
  },
  invalidDiscountAllocation: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/attendances/invalid-discount-allocation",
    message: "Discount allocation cannot exceed assigned employee revenue",
  },
  invalidDiscountValue: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/attendances/invalid-discount-value",
    message: "Discount value is invalid for attendance subtotal",
  },
  invalidSettlementState: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/attendances/invalid-settlement-state",
    message: "Direct attendance edit would create an invalid settlement state",
  },
  workDayAlreadyClosed: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/attendances/work-day-already-closed",
    message: "The selected store work day has already been closed",
  },
  pastAttendanceWindowExceeded: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/past-window-exceeded",
    message: "Employees can only edit attendance within the recent-days window",
  },
  futureBookingStatusNotAllowed: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/attendances/future-booking-status-not-allowed",
    message: "Future attendance can only be cancelled",
  },
};

export const updateAttendance = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const attendanceId = req.params["attendanceId"];

  if (typeof attendanceId !== "string" || !attendanceId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "missing attendanceId",
    });
  }

  const storeIdFromUrl = getStoreIdFromUrlPath(req);

  if (!storeIdFromUrl) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "missing storeId",
    });
  }

  const attendancePayloadParseResult = parseAttendancePayload(mergeUrlPathStoreId(req, req.body));

  if (!attendancePayloadParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "invalid attendance payload",
    });
  }

  const existingAttendance = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.attendanceLoad,
    { "app.store_id": storeIdFromUrl },
    () =>
      firestoreRepository.shop.attendance.getShopAttendance(
        authContext.ownerId,
        storeIdFromUrl,
        attendanceId,
      ),
  );

  // URL `:storeId` phải khớp store của attendance; quyền truy cập store do canAccessStore lo bên dưới.
  if (storeIdFromUrl !== undefined && storeIdFromUrl !== existingAttendance.storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      routeStoreId: storeIdFromUrl,
      attendanceStoreId: existingAttendance.storeId,
    });
  }

  if (!canAccessStore(authContext, existingAttendance.storeId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      storeId: existingAttendance.storeId,
      role: authContext.role,
    });
  }

  const callerIsEmployee = authContext.role === "employee";
  const canEmployeeUpdateAssignedAttendance =
    callerIsEmployee && isAttendanceMainAssignee(existingAttendance, authContext.uid);
  const privilegedActorCanUpdate =
    !callerIsEmployee && canManageAttendance(authContext, existingAttendance);

  if (!privilegedActorCanUpdate && !canEmployeeUpdateAssignedAttendance) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenAttendance, {
      attendanceId,
      role: authContext.role,
    });
  }

  const currentSettlement = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.workDayCheck,
    {
      "app.store_id": existingAttendance.storeId,
      "attendance.work_date": existingAttendance.workDate,
    },
    () =>
      firestoreRepository.shop.settlement.getWorkDaySettlement(
        authContext.ownerId,
        existingAttendance.storeId,
        existingAttendance.workDate,
      ),
  );
  const currentWorkDateClosing =
    currentSettlement?.status === "closed" ? currentSettlement.closing : undefined;
  const isOwnerDirectClosedEdit =
    can(authContext.role, "attendance:editClosed") &&
    (existingAttendance.status === "closed" || Boolean(currentWorkDateClosing));

  if (currentWorkDateClosing && !isOwnerDirectClosedEdit) {
    return createErrorResponse(res, SERVICE_ERRORS.attendanceLocked, {
      storeId: existingAttendance.storeId,
      workDate: existingAttendance.workDate,
    });
  }

  // storeId của payload = route `:storeId` (mergeUrlPathStoreId đã ép), quyền do canAccessStore bên dưới
  // + store tồn tại do getStore phía sau.
  const payload = attendancePayloadParseResult.data;
  const existingMainAssigneeUserId = getAttendanceMainAssigneeUserId(existingAttendance);
  const requestedMainAssigneeUserId = payload.mainAssigneeUserId;
  const mainAssigneeUserId = requestedMainAssigneeUserId ?? existingMainAssigneeUserId;
  const mainAssigneeChanged =
    mainAssigneeUserId !== undefined && mainAssigneeUserId !== existingMainAssigneeUserId;
  if (
    authContext.role === "employee" &&
    requestedMainAssigneeUserId !== undefined &&
    requestedMainAssigneeUserId !== existingMainAssigneeUserId
  ) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenAttendance, {
      attendanceId,
      reason: "employees cannot change main assignee",
    });
  }

  if (
    callerIsEmployee &&
    payload.bookingStatus !== undefined &&
    payload.bookingStatus !== existingAttendance.bookingStatus &&
    payload.bookingStatus !== "no_show"
  ) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenAttendance, {
      attendanceId,
      reason: "employees can only mark their attendance as no-show",
    });
  }

  if (
    callerIsEmployee &&
    (payload.bookingStatus === "no_show" || payload.attendanceStatus === "completed") &&
    !isAttendanceMainAssignee(existingAttendance, authContext.uid)
  ) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenAttendance, {
      attendanceId,
      reason: "only the main assignee can complete or mark no-show",
    });
  }
  if (isOwnerDirectClosedEdit && payload.storeId !== existingAttendance.storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "cannot change store on closed edit",
      payloadStoreId: payload.storeId,
      existingStoreId: existingAttendance.storeId,
    });
  }

  if (!canAccessStore(authContext, payload.storeId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      storeId: payload.storeId,
      role: authContext.role,
    });
  }

  const [store, activeShopEmployees, serviceCatalog] = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.contextLoad,
    { "app.store_id": payload.storeId },
    () =>
      Promise.all([
        firestoreRepository.shop.store.getStore(authContext.ownerId, payload.storeId),
        firestoreRepository.user.listShopEmployees(authContext.ownerId, {
          storeId: payload.storeId,
          active: true,
        }),
        firestoreRepository.shop.service.getShopServiceFactory(
          authContext.ownerId,
          payload.storeId,
        ),
      ]),
  );
  const settlementCutoffTime = normalizeSettlementCutoffTime(store.settlementCutoffTime);
  const attendanceTiming = resolveAttendanceTimingForStore(payload, {
    storeTimezone: store.timezone,
    settlementCutoffTime,
  });
  const activeEmployeesInStore = activeShopEmployees.map(toEmployeePresentationItem);
  const activeEmployeesInStoreByUid = new Map(
    activeEmployeesInStore.map((employee) => [employee.uid, employee]),
  );
  // Chưa gán thợ thì để trống — không tự điền người tạo.
  const attendanceServiceInputs = payload.services;

  if (
    !areAttendanceServiceReferencesValid(
      attendanceServiceInputs,
      serviceCatalog,
      existingAttendance.storeId === payload.storeId ? existingAttendance.services : [],
    )
  ) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "invalid service references",
    });
  }

  // `assignees` đã là hợp của (thợ trong mọi service) ∪ (thợ chính FE khai), dedupe sẵn ở
  // normalizeFrontendPayload. Dùng nguyên danh sách này để MỌI người được nhắc tên đều bị kiểm
  // có đang làm ở store không — kể cả thợ chính chưa được gán vào service nào.
  const attendanceAssigneeInputs = payload.assignees;
  const resolvedAssigneeInputs = resolveAttendanceAssigneeInputs(
    attendanceAssigneeInputs,
    activeEmployeesInStore,
  );

  const validatedAssigneeInputs = resolvedAssigneeInputs.filter(
    (assignee): assignee is NonNullable<(typeof resolvedAssigneeInputs)[number]> =>
      assignee !== undefined,
  );

  if (validatedAssigneeInputs.length !== attendanceAssigneeInputs.length) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "unresolved assignees",
    });
  }

  // Thợ sửa thì chấm công PHẢI có phần mình — không sửa thành của người khác, cũng không gỡ sạch thợ
  // để nó thành vô chủ (chấm công trống chỉ chủ/quản lý mới giữ được).
  const callerIsAmongAssignees = validatedAssigneeInputs.some(
    (assignee) => assignee.employeeUserId === authContext.uid,
  );

  if (callerIsEmployee && !callerIsAmongAssignees) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenAttendance, {
      reason: "employee not among assignees",
      role: authContext.role,
    });
  }

  const effectiveWorkDate = attendanceTiming.workDate;

  // Thợ chỉ sửa được chấm công trong cửa sổ MAX_EMPLOYEE_PAST_ATTENDANCE_DAYS ngày. Chủ/QL không giới hạn.
  if (callerIsEmployee) {
    const currentWorkDate = resolveBusinessWorkDate(Date.now(), {
      timeZone: attendanceTiming.storeTimezone,
      settlementCutoffTime,
    });
    const daysInThePast = countDaysWorkDateIsInThePast(effectiveWorkDate, currentWorkDate);

    if (daysInThePast > MAX_EMPLOYEE_PAST_ATTENDANCE_DAYS) {
      return createErrorResponse(res, SERVICE_ERRORS.pastAttendanceWindowExceeded, {
        workDate: effectiveWorkDate,
        maxPastDays: MAX_EMPLOYEE_PAST_ATTENDANCE_DAYS,
      });
    }
  }

  const targetSettlement = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.workDayCheck,
    {
      "app.store_id": payload.storeId,
      "attendance.work_date": effectiveWorkDate,
    },
    () =>
      firestoreRepository.shop.settlement.getWorkDaySettlement(
        authContext.ownerId,
        payload.storeId,
        effectiveWorkDate,
      ),
  );
  const targetWorkDateClosing =
    targetSettlement?.status === "closed" ? targetSettlement.closing : undefined;
  setActiveAttendanceSpanAttributes({
    "attendance.work_day_closed":
      currentWorkDateClosing !== undefined || targetWorkDateClosing !== undefined,
  });

  if (targetWorkDateClosing && !isOwnerDirectClosedEdit) {
    return createErrorResponse(res, SERVICE_ERRORS.workDayAlreadyClosed, {
      storeId: payload.storeId,
      workDate: effectiveWorkDate,
    });
  }

  const resolvedAttendanceServices = resolveAttendanceServices(attendanceServiceInputs, {
    ownerId: authContext.ownerId,
    storeId: payload.storeId,
    serviceCatalog,
    existingServices: existingAttendance.services,
  }).map((service) => ({
    ...service,
    employees: attachEmployeeNamesToServiceAssignees(
      service.employees ?? [],
      activeEmployeesInStoreByUid,
    ),
  }));
  const attendanceServices = mainAssigneeChanged
    ? resolvedAttendanceServices.map((service) => ({
        ...service,
        employees: (service.employees ?? []).filter(
          (employee) => employee.employeeUserId === mainAssigneeUserId,
        ),
      }))
    : resolvedAttendanceServices;
  const derivedAssistantIds = new Set(
    attendanceServices.flatMap((service) =>
      (service.employees ?? [])
        .map((employee) => employee.employeeUserId)
        .filter((employeeUserId) => employeeUserId !== mainAssigneeUserId),
    ),
  );
  const assistantAssigneeUserId = mainAssigneeChanged
    ? undefined
    : (payload.assistantAssigneeUserId ??
      (derivedAssistantIds.size === 1 ? Array.from(derivedAssistantIds)[0] : undefined));
  const shouldClearAssistantAssignee =
    assistantAssigneeUserId === undefined &&
    derivedAssistantIds.size === 0 &&
    Boolean(existingAttendance.assistantAssigneeUserId);
  const attendanceServicesWithRoles = attendanceServices.map((service) => ({
    ...service,
    employees: applyAttendanceAssigneeRoles(
      service.employees ?? [],
      mainAssigneeUserId,
      assistantAssigneeUserId,
    ),
  }));
  const subtotalAmount = sumMoney(attendanceServicesWithRoles.map((service) => service.price));
  const serviceAssignees = mergeAttendanceAssignees(attendanceServicesWithRoles, subtotalAmount);
  const fallbackAssignees = buildAssigneesWithoutServiceShares(
    validatedAssigneeInputs,
    activeEmployeesInStoreByUid,
  );
  const resolvedAssignees = serviceAssignees.length > 0 ? serviceAssignees : fallbackAssignees;
  const normalizedAssigneesWithoutRoles = shouldClearAssistantAssignee
    ? resolvedAssignees.filter((assignee) => assignee.employeeUserId === mainAssigneeUserId)
    : resolvedAssignees;
  const normalizedAssignees = applyAttendanceAssigneeRoles(
    normalizedAssigneesWithoutRoles,
    mainAssigneeUserId,
    assistantAssigneeUserId,
  );

  // Cùng logic validate + dựng giảm giá với endpoint tạo. Khác duy nhất: PATCH giữ discount CŨ khi
  // FE không gửi gì (tạo thì để undefined).
  const discountResolution = resolveAttendanceDiscount(subtotalAmount, payload);

  if (discountResolution.invalidReason !== undefined) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidDiscountValue, {
      reason: discountResolution.invalidReason,
    });
  }

  const feProvidedDiscount = payload.discount !== undefined || payload.discountAmount !== undefined;
  const nextDiscount = feProvidedDiscount
    ? discountResolution.discount
    : existingAttendance.discount;

  const totalAmount = Math.max(0, subtractMoney(subtotalAmount, nextDiscount?.amount ?? 0));
  const nextStoreWorkDateKey = createStoreWorkDateKey(payload.storeId, effectiveWorkDate);
  const timestamp = Date.now();

  // Thợ chính = người FE khai ở màn "Thông tin", KHÔNG phải `normalizedAssignees[0]` (thứ tự đó là
  // thứ tự thợ xuất hiện trong services — lấy nhầm sẽ ghi thợ làm cùng thành thợ chính).
  // Chưa khai ai thì để TRỐNG — KHÔNG điền người sửa vào đây.
  const readyForConfirmation = isAttendanceReadyForConfirmation({
    employeeUserId: mainAssigneeUserId,
    assignees: normalizedAssignees,
    services: attendanceServicesWithRoles,
  });
  const isFutureAttendance = isAttendanceStartInFuture({
    workDate: effectiveWorkDate,
    startTimestamp: attendanceTiming.startTimestamp ?? existingAttendance.startTimestamp,
    startTime: attendanceTiming.startTime,
    storeTimezone: attendanceTiming.storeTimezone,
    settlementCutoffTime,
  });

  if (payload.bookingStatus === "confirmed" && !readyForConfirmation) {
    return createErrorResponse(res, ATTENDANCE_CREATE_SERVICE_ERRORS.confirmationIncomplete, {
      attendanceId,
      storeId: payload.storeId,
      workDate: effectiveWorkDate,
    });
  }

  if (payload.attendanceStatus === "completed" && !readyForConfirmation) {
    return createErrorResponse(res, ATTENDANCE_CREATE_SERVICE_ERRORS.confirmationIncomplete, {
      attendanceId,
      storeId: payload.storeId,
      workDate: effectiveWorkDate,
    });
  }

  if (
    isFutureAttendance &&
    ((payload.bookingStatus !== undefined && payload.bookingStatus !== "cancelled") ||
      payload.attendanceStatus === "completed")
  ) {
    return createErrorResponse(res, SERVICE_ERRORS.futureBookingStatusNotAllowed, {
      attendanceId,
      storeId: payload.storeId,
      workDate: effectiveWorkDate,
    });
  }

  // Sửa xong mà không còn thợ nào → "processing" (cần xử lý); có thợ + không đổi status → giữ nguyên.
  const currentBookingStatus = existingAttendance.bookingStatus;
  let nextBookingStatus = payload.bookingStatus;

  if (
    nextBookingStatus === undefined &&
    currentBookingStatus !== "cancelled" &&
    currentBookingStatus !== "no_show"
  ) {
    if (!readyForConfirmation) {
      nextBookingStatus = "processing";
    } else if (currentBookingStatus === "processing" || currentBookingStatus === "requested") {
      nextBookingStatus = "confirmed";
    }
  }

  if (payload.attendanceStatus === "completed") {
    nextBookingStatus = "confirmed";
  }

  // Chỉ những field thực sự đổi mới đưa vào payload ghi Firestore (partial update giữ nguyên field cũ).
  // Field optional: chỉ đưa key khi có giá trị (Firestore không nhận `undefined`).
  const attendanceUpdatePayload: Partial<ShopAttendanceType> = {
    storeId: payload.storeId,
    storeName: store.name,
    storeWorkDateKey: nextStoreWorkDateKey,
    workDate: effectiveWorkDate,
    storeTimezone: attendanceTiming.storeTimezone,
    settlementCutoffTime,
    startTime: attendanceTiming.startTime,
    endTime: attendanceTiming.endTime,
    assignees: normalizedAssignees,
    services: attendanceServicesWithRoles,
    subtotalAmount,
    totalAmount,
    status: existingAttendance.status ?? "open",
    updatedBy: authContext.uid,
    updatedByUserId: authContext.uid,
    updatedByRole: toAttendanceActorRole(authContext.role),
  };

  if (mainAssigneeUserId !== undefined) {
    attendanceUpdatePayload.employeeUserId = mainAssigneeUserId;
    attendanceUpdatePayload.mainAssigneeUserId = mainAssigneeUserId;
  }

  if (payload.bookingId !== undefined) {
    attendanceUpdatePayload.bookingId = payload.bookingId;
  }

  if (
    mainAssigneeChanged ||
    assistantAssigneeUserId !== undefined ||
    shouldClearAssistantAssignee
  ) {
    if (assistantAssigneeUserId !== undefined) {
      attendanceUpdatePayload.assistantAssigneeUserId = assistantAssigneeUserId;
    }
  }

  if (attendanceTiming.startTimestamp !== undefined) {
    attendanceUpdatePayload.startTimestamp = attendanceTiming.startTimestamp;
  }

  if (attendanceTiming.endTimestamp !== undefined) {
    attendanceUpdatePayload.endTimestamp = attendanceTiming.endTimestamp;
  }

  // Employee responses redact customer identity, so employee edits must not overwrite hidden values.
  if (!callerIsEmployee && payload.customerName !== undefined) {
    attendanceUpdatePayload.customerName = payload.customerName;
  }

  if (
    !callerIsEmployee &&
    (payload.customerPhone !== undefined || payload.customerName !== undefined)
  ) {
    if (payload.customerName !== undefined) {
      attendanceUpdatePayload.customerName = payload.customerName;
    }
    if (payload.customerPhone !== undefined) {
      attendanceUpdatePayload.customerPhone = payload.customerPhone;
    }

    const customer = await withAttendanceSpan(
      ATTENDANCE_TRACE_CHILD_SPANS.customerResolve,
      {
        "app.store_id": payload.storeId,
        "attendance.customer_lookup_present": true,
      },
      () =>
        firestoreRepository.shop.customer.createShopCustomer(authContext.ownerId, {
          storeId: payload.storeId,
          ...(payload.customerPhone !== undefined
            ? { phone: payload.customerPhone }
            : existingAttendance.customerPhone !== undefined && {
                phone: existingAttendance.customerPhone,
              }),
          ...(payload.customerName !== undefined && { name: payload.customerName }),
        }),
    );
    if (customer !== undefined) {
      attendanceUpdatePayload.customerId = customer.id;
    }
  }

  if (existingAttendance.source === undefined) {
    attendanceUpdatePayload.source = resolveStoredAttendanceSource(existingAttendance);
  }

  if (payload.note !== undefined) {
    attendanceUpdatePayload.note = payload.note;
  }

  if (payload.bookingSource !== undefined) {
    attendanceUpdatePayload.bookingSource = payload.bookingSource;
  }

  if (nextBookingStatus !== undefined) {
    attendanceUpdatePayload.bookingStatus = nextBookingStatus;
  }

  if (payload.attendanceStatus === "completed") {
    attendanceUpdatePayload.status = "closed";
    attendanceUpdatePayload.closedAt = timestamp;
    attendanceUpdatePayload.closedBy = authContext.uid;
  }

  if (nextDiscount !== undefined) {
    attendanceUpdatePayload.discount = nextDiscount;
  }

  // Bản đầy đủ (cho recalc + response) = attendance cũ đè bằng đúng các field vừa đổi. Một nguồn duy
  // nhất, không dựng lại object thứ hai (tránh 2 bản trôi lệch nhau).
  const updatedAttendanceWithOptionalAssistant: ShopAttendanceType = {
    ...existingAttendance,
    ...attendanceUpdatePayload,
    updatedAt: timestamp,
  };
  const updatedAttendance: ShopAttendanceType = shouldClearAssistantAssignee
    ? (({ assistantAssigneeUserId: _removedAssistant, ...attendance }) => attendance)(
        updatedAttendanceWithOptionalAssistant,
      )
    : updatedAttendanceWithOptionalAssistant;

  const affectedSettlementDates = isOwnerDirectClosedEdit
    ? getAffectedAttendanceWorkDates(existingAttendance, updatedAttendance.workDate)
    : [];
  const recalculationResult = isOwnerDirectClosedEdit
    ? await withAttendanceSpan(
        ATTENDANCE_TRACE_CHILD_SPANS.settlementRecalculate,
        {
          "app.store_id": payload.storeId,
          "attendance.work_date": effectiveWorkDate,
          "attendance.post_write_phase": "settlement_prepare",
          "settlement.affected_date_count": affectedSettlementDates.length,
        },
        () =>
          prepareAffectedClosingRecalculations(
            authContext,
            existingAttendance,
            updatedAttendance,
            affectedSettlementDates,
          ),
      )
    : { ok: true as const, recalculations: [] };

  if (!recalculationResult.ok) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidSettlementState, {
      storeId: payload.storeId,
      workDate: effectiveWorkDate,
    });
  }

  const recalculatedAt = isOwnerDirectClosedEdit ? Date.now() : undefined;
  const recalculatedSettlementDates = recalculationResult.recalculations.map(
    (recalculation) => recalculation.settlement.workDate,
  );

  const source =
    attendanceUpdatePayload.source ??
    existingAttendance.source ??
    resolveStoredAttendanceSource(existingAttendance);
  const assistantAssigneeChanged =
    assistantAssigneeUserId !== existingAttendance.assistantAssigneeUserId;
  const workDateChanged = existingAttendance.workDate !== updatedAttendance.workDate;
  const storeChanged = existingAttendance.storeId !== updatedAttendance.storeId;

  setActiveAttendanceSpanAttributes({
    "attendance.source": source,
    "attendance.work_date": effectiveWorkDate,
    "attendance.work_date_relation": workDateChanged ? "changed" : "unchanged",
    "attendance.rolled_work_date": effectiveWorkDate !== payload.workDate,
    "attendance.is_future": isFutureAttendance,
    "attendance.ready_for_confirmation": readyForConfirmation,
    "attendance.service_count": attendanceServices.length,
    "attendance.main_assignee_present": mainAssigneeUserId !== undefined,
    "attendance.assistant_assignee_present": assistantAssigneeUserId !== undefined,
    "attendance.booking_status.before": existingAttendance.bookingStatus,
    "attendance.booking_status.after": updatedAttendance.bookingStatus,
    "attendance.record_status.before": existingAttendance.status,
    "attendance.record_status.after": updatedAttendance.status,
    "attendance.main_assignee_changed": mainAssigneeChanged,
    "attendance.assistant_assignee_changed": assistantAssigneeChanged,
    "attendance.work_date_changed": workDateChanged,
    "attendance.store_changed": storeChanged,
    "attendance.closed_day_edit": isOwnerDirectClosedEdit,
  });

  await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.persist,
    {
      "app.store_id": updatedAttendance.storeId,
      "attendance.persist_action": "update",
    },
    () =>
      firestoreRepository.shop.attendance.updateShopAttendance(
        authContext.ownerId,
        existingAttendance.storeId,
        attendanceId,
        attendanceUpdatePayload,
        existingAttendance,
        shouldClearAssistantAssignee ? { deleteFields: ["assistantAssigneeUserId"] } : undefined,
      ),
  );
  addActiveAttendanceSpanEvent(ATTENDANCE_TRACE_EVENTS.writeCommitted, {
    "attendance.id": attendanceId,
    "attendance.persist_action": "update",
  });

  // Cancellation and no-show are booking-level decisions. Propagate them to
  // sibling attendances that share the same bookingId; completed stays per attendance.
  if (
    (nextBookingStatus === "cancelled" || nextBookingStatus === "no_show") &&
    updatedAttendance.bookingId
  ) {
    const siblingCount = await withAttendanceSpan(
      ATTENDANCE_TRACE_CHILD_SPANS.bookingPropagate,
      {
        "app.store_id": existingAttendance.storeId,
        "attendance.post_write_phase": "booking_propagation",
      },
      async () => {
        const sameDayAttendances =
          await firestoreRepository.shop.attendance.listShopAttendanceByStoreWorkDateKey(
            authContext.ownerId,
            existingAttendance.storeId,
            existingAttendance.workDate,
            { skipCache: true },
          );
        const siblings = sameDayAttendances.filter(
          (candidate) =>
            candidate.id !== attendanceId && candidate.bookingId === updatedAttendance.bookingId,
        );
        setActiveAttendanceSpanAttributes({ "booking.sibling_count": siblings.length });
        await Promise.all(
          siblings.map((sibling) =>
            firestoreRepository.shop.attendance.updateShopAttendance(
              authContext.ownerId,
              sibling.storeId,
              sibling.id,
              {
                bookingStatus: nextBookingStatus,
                updatedBy: authContext.uid,
                updatedByUserId: authContext.uid,
                updatedByRole: toAttendanceActorRole(authContext.role),
              },
              sibling,
            ),
          ),
        );

        return siblings.length;
      },
    );
    setActiveAttendanceSpanAttributes({
      "booking.id": updatedAttendance.bookingId,
      "booking.sibling_count": siblingCount,
    });
  }

  if (recalculationResult.recalculations.length > 0) {
    await withAttendanceSpan(
      ATTENDANCE_TRACE_CHILD_SPANS.settlementRecalculate,
      {
        "app.store_id": payload.storeId,
        "attendance.work_date": effectiveWorkDate,
        "attendance.post_write_phase": "settlement_recalculate",
        "settlement.affected_date_count": affectedSettlementDates.length,
        "settlement.recalculated_date_count": recalculationResult.recalculations.length,
      },
      async () => {
        for (const recalculation of recalculationResult.recalculations) {
          await applyClosingRecalculation(authContext.ownerId, recalculation, {
            triggeredBy: { kind: "edit", attendanceId },
            actorUserId: authContext.uid,
            fallbackStoreTimezone: attendanceTiming.storeTimezone,
            recalculatedAt,
          });
        }
      },
    );
  }

  const affectedSettlementScopes = new Map<string, { storeId: string; workDate: string }>();
  affectedSettlementScopes.set(`${existingAttendance.storeId}:${existingAttendance.workDate}`, {
    storeId: existingAttendance.storeId,
    workDate: existingAttendance.workDate,
  });
  affectedSettlementScopes.set(`${payload.storeId}:${effectiveWorkDate}`, {
    storeId: payload.storeId,
    workDate: effectiveWorkDate,
  });
  const recalculatedSettlementScopeKeys = new Set(
    recalculationResult.recalculations.map(
      (recalculation) => `${recalculation.settlement.storeId}:${recalculation.settlement.workDate}`,
    ),
  );
  const settlementScopesToSync = Array.from(affectedSettlementScopes.entries()).filter(
    ([settlementScopeKey]) => !recalculatedSettlementScopeKeys.has(settlementScopeKey),
  );

  if (settlementScopesToSync.length > 0) {
    await withAttendanceSpan(
      ATTENDANCE_TRACE_CHILD_SPANS.settlementSync,
      {
        "app.store_id": payload.storeId,
        "attendance.post_write_phase": "settlement_sync",
        "settlement.affected_date_count": settlementScopesToSync.length,
        "settlement.recalculated_date_count": recalculationResult.recalculations.length,
      },
      () =>
        Promise.all(
          settlementScopesToSync.map(([, settlementScope]) =>
            synchronizeWorkDaySettlement(
              authContext.ownerId,
              settlementScope.storeId,
              settlementScope.workDate,
            ),
          ),
        ),
    );
  }

  await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.auditWrite,
    { "attendance.post_write_phase": "audit" },
    () =>
      writeShopAuditLog({
        ownerId: authContext.ownerId,
        eventType: "attendance_updated",
        entityType: "attendance",
        entityId: attendanceId,
        storeId: payload.storeId,
        workDate: effectiveWorkDate,
        actor: {
          uid: authContext.uid,
          role: authContext.role,
        },
        metadata: {
          previousStoreId: existingAttendance.storeId,
          nextStoreId: payload.storeId,
          previousWorkDate: existingAttendance.workDate,
          nextWorkDate: effectiveWorkDate,
          subtotalAmount,
          discountAmount: nextDiscount?.amount ?? 0,
          totalAmount,
          status: existingAttendance.status ?? "open",
          serviceNames: attendanceServices.map((service) => service.name),
          serviceCount: attendanceServices.length,
          assigneeCount: normalizedAssignees.length,
          assigneeEmployeeUserIds: normalizedAssignees.map((assignee) => assignee.employeeUserId),
          rolledToNextWorkDate: effectiveWorkDate !== payload.workDate,
          ownerDirectClosedEdit: isOwnerDirectClosedEdit,
          affectedSettlementDates,
          recalculatedSettlementDates,
        },
      }),
  );

  const attendanceForResponse = normalizeAttendanceForResponse(updatedAttendance);
  const responseMeta: {
    storeId: string;
    workDate: string;
    rolledToNextWorkDate: boolean;
    discountAmount: number;
    subtotalAmount: number;
    totalAmount: number;
    status: ShopAttendanceType["status"];
    recalculatedSettlementDates?: string[];
  } = {
    storeId: payload.storeId,
    workDate: effectiveWorkDate,
    rolledToNextWorkDate: effectiveWorkDate !== payload.workDate,
    discountAmount: nextDiscount?.amount ?? 0,
    subtotalAmount,
    totalAmount,
    status: updatedAttendance.status ?? "open",
  };

  if (isOwnerDirectClosedEdit) {
    responseMeta.recalculatedSettlementDates = recalculatedSettlementDates;
  }

  return res.status(StatusCodes.OK).json({
    item: toFrontendAttendanceItem(attendanceForResponse, {
      redactCustomerInfo: authContext.role === "employee",
    }),
    meta: responseMeta,
  });
};
