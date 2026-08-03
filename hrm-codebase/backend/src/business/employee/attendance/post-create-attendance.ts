import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import {
  buildAttendanceDiscount,
  getAttendanceDiscountValidationReason,
  type AttendanceDiscountInput,
  type AttendanceDiscountValidationReason,
} from "../../../helpers/attendance-discount.js";
import {
  normalizeSettlementCutoffTime,
  resolveBusinessWorkDate,
} from "../../../helpers/business-day.js";
import { createStoreWorkDateKey } from "../../../helpers/work-date-utils.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import {
  DEFAULT_BOOKING_STATUS,
  ShopAttendanceDiscountType,
  type ShopAttendanceActorRole,
  type ShopAttendanceSource,
  type ShopAttendanceAssigneeType,
  type ShopAttendanceType,
} from "../../../repository/firestore/shop/shop.types.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { subtractMoney, sumMoney } from "../../../helpers/money.js";
import {
  areAttendanceServiceReferencesValid,
  parseAttendancePayload,
  type NormalizedAttendancePayload,
} from "../domain/attendance-payload.js";
import {
  countDaysWorkDateIsInThePast,
  isAttendanceStartInFuture,
  resolveAttendanceTimingForStore,
  type ResolvedAttendanceTiming,
} from "../domain/attendance-timing.js";
import {
  isAttendanceReadyForConfirmation,
  MAX_EMPLOYEE_PAST_ATTENDANCE_DAYS,
} from "../domain/attendance-rules.js";
import {
  buildZeroDiscount,
  mergeAttendanceAssignees,
  resolveAttendanceServices,
} from "../domain/attendance-money.js";
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
import { resolveAttendanceStoreScope } from "../domain/attendance-store-scope.js";
import {
  resolveStaffAttendanceSource,
  toAttendanceActorRole,
} from "../domain/attendance-origin.js";
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
  employeeAssigneeRequired: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/employee-assignee-required",
    message: "Employees can only create attendance assigned to themselves",
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
  invalidDiscountValue: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/attendances/invalid-discount-value",
    message: "Discount value is invalid for attendance subtotal",
  },
  workDayAlreadyClosed: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/attendances/work-day-already-closed",
    message: "The selected store work day has already been closed",
  },
  invalidSettlementState: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/attendances/invalid-settlement-state",
    message: "Backfill attendance would create an invalid settlement state",
  },
  pastAttendanceWindowExceeded: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/past-window-exceeded",
    message: "Employees can only log attendance within the recent-days window",
  },
  employeeTimeTrackingRequired: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/attendances/employee-time-tracking-required",
    message: "Employees must check in before creating attendance",
  },
  employeeFutureBookingForbidden: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/employee-future-booking-forbidden",
    message: "Employees cannot create future bookings",
  },
  customerBlocked: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/customer-blocked",
    message: "Không thể tạo lịch tại tiệm này. Vui lòng liên hệ trực tiếp với tiệm để được hỗ trợ.",
  },
  confirmationIncomplete: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/attendances/booking-confirmation-incomplete",
    message: "Attendance needs a service and an assigned worker before confirmation",
  },
  // Endpoint /backfill chỉ dành cho ngày ĐÃ chốt sổ; gặp ngày mở thì báo dùng endpoint thường.
  workDayNotClosed: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/attendances/work-day-not-closed",
    message: "This work day is not closed; use the normal create endpoint",
  },
};

// Dùng chung với endpoint /backfill (sibling, cùng module — không tạo file shared riêng).
export { SERVICE_ERRORS as ATTENDANCE_CREATE_SERVICE_ERRORS };

// employee_self_open: thợ tự tạo cho ca đang mở.
// owner_assisted_open: chủ tạo hộ cho ngày chưa chốt sổ.
// owner_backfill_closed: chủ ghi bù vào ngày ĐÃ chốt sổ → phải tính lại chốt sổ (endpoint /backfill).
export type AttendanceCreateMode =
  | "employee_self_open"
  | "owner_assisted_open"
  | "owner_backfill_closed";

// Phần giảm giá trong request FE gửi lên — đúng 2 field, không dính gì tới phần còn lại của payload.
type AttendanceDiscountRequest = {
  discount?: AttendanceDiscountInput | undefined;
  discountAmount?: number | undefined;
};

type AttendanceDiscountResolution =
  | { invalidReason: AttendanceDiscountValidationReason; discount?: undefined }
  | { invalidReason?: undefined; discount: ShopAttendanceDiscountType | undefined };

// FE gửi giảm giá bằng 1 trong 2 field:
//   `discount: { type, value }` — dạng đầy đủ, dùng được cho CẢ nút `đ` (type="amount")
//                                 lẫn nút `%` (type="percentage").
//   `discountAmount: number`    — dạng rút gọn CŨ, chỉ nói được số tiền;
//                                 tương đương `{ type: "amount", value: N }`.
// Gửi cả hai thì `discount` thắng. Quy về cùng 1 dạng rồi mới validate + dựng,
// để 2 đường nhập không bị xử lý lệch nhau.
//
// ⚠️ `discountAmount` ở RESPONSE là thứ khác: đó là số tiền giảm đã tính ra
// (`discount.amount`), không phải con số FE gõ. Trùng nhau khi type="amount", lệch khi "percentage".
export const resolveAttendanceDiscount = (
  subtotalAmount: number,
  attendanceInput: AttendanceDiscountRequest,
): AttendanceDiscountResolution => {
  let discountInput: AttendanceDiscountInput | undefined;

  if (attendanceInput.discount !== undefined) {
    discountInput = attendanceInput.discount;
  } else if (attendanceInput.discountAmount !== undefined) {
    discountInput = { type: "amount", value: attendanceInput.discountAmount };
  }

  // FE không gửi gì → chấm công không có giảm giá.
  if (discountInput === undefined) {
    return { discount: undefined };
  }

  const invalidReason = getAttendanceDiscountValidationReason(subtotalAmount, discountInput);

  if (invalidReason !== undefined) {
    return { invalidReason };
  }

  // FE gửi `discountAmount: 0` → giảm giá 0đ. KHÁC với không gửi gì ở trên.
  if (discountInput.value <= 0) {
    return { discount: buildZeroDiscount() };
  }

  return { discount: buildAttendanceDiscount(subtotalAmount, discountInput) };
};

type BuildAttendanceDocumentDataOptions = {
  attendanceInput: NormalizedAttendancePayload;
  bookingId: string;
  attendanceTiming: ResolvedAttendanceTiming;
  storeName: string;
  storeWorkDateKey: string;
  workDate: string;
  settlementCutoffTime: string;
  assignees: ShopAttendanceAssigneeType[];
  services: ShopAttendanceType["services"];
  subtotalAmount: number;
  totalAmount: number;
  discount: ShopAttendanceDiscountType | undefined;
  settlementStatus: ShopAttendanceType["status"];
  closedAtTimestamp: number | undefined;
  actorUserId: string;
  actorRole: ShopAttendanceActorRole;
  source: ShopAttendanceSource;
  bookingStatus?: ShopAttendanceType["bookingStatus"];
};

type AttendanceDocumentData = Omit<
  ShopAttendanceType,
  "id" | "ownerId" | "createdAt" | "updatedAt"
>;

export const buildAttendanceDocumentData = (
  options: BuildAttendanceDocumentDataOptions,
): AttendanceDocumentData => {
  const { attendanceInput, attendanceTiming, actorUserId } = options;

  // Thợ chính = người FE khai ở màn "Thông tin", KHÔNG phải `assignees[0]` (thứ tự đó là thứ tự
  // thợ xuất hiện trong services — lấy nhầm sẽ ghi thợ làm cùng thành thợ chính).
  // Chưa khai ai thì để TRỐNG — KHÔNG điền người tạo vào đây (sẽ khiến báo cáo/lương tính nhầm
  // cho chủ). Trạng thái "chưa có thợ" thể hiện bằng bookingStatus = "processing".
  const mainAssigneeUserId = attendanceInput.mainAssigneeUserId;
  const derivedAssistantIds = new Set(
    options.services.flatMap((service) =>
      (service.employees ?? [])
        .map((employee) => employee.employeeUserId)
        .filter((employeeUserId) => employeeUserId !== mainAssigneeUserId),
    ),
  );
  const assistantAssigneeUserId =
    attendanceInput.assistantAssigneeUserId ??
    (derivedAssistantIds.size === 1 ? Array.from(derivedAssistantIds)[0] : undefined);
  const attendanceAssignees = applyAttendanceAssigneeRoles(
    options.assignees,
    mainAssigneeUserId,
    assistantAssigneeUserId,
  );
  const attendanceServices = options.services.map((service) => ({
    ...service,
    employees: applyAttendanceAssigneeRoles(
      service.employees ?? [],
      mainAssigneeUserId,
      assistantAssigneeUserId,
    ),
  }));

  // Chưa gán thợ nào → "processing" (chủ cần xử lý/sắp thợ); có thợ → default confirmed.
  let bookingStatus = options.bookingStatus ?? attendanceInput.bookingStatus;

  if (bookingStatus === undefined) {
    if (
      isAttendanceReadyForConfirmation({
        employeeUserId: mainAssigneeUserId,
        assignees: attendanceAssignees,
        services: attendanceServices,
      })
    ) {
      bookingStatus = DEFAULT_BOOKING_STATUS;
    } else {
      bookingStatus = "processing";
    }
  }

  const attendanceDocumentData: AttendanceDocumentData = {
    bookingId: options.bookingId,
    storeId: attendanceInput.storeId,
    storeName: options.storeName,
    storeWorkDateKey: options.storeWorkDateKey,
    workDate: options.workDate,
    storeTimezone: attendanceTiming.storeTimezone,
    settlementCutoffTime: options.settlementCutoffTime,
    startTime: attendanceTiming.startTime,
    endTime: attendanceTiming.endTime,
    assignees: attendanceAssignees,
    services: attendanceServices,
    subtotalAmount: options.subtotalAmount,
    totalAmount: options.totalAmount,
    status: options.settlementStatus,
    bookingStatus,
    createdBy: actorUserId,
    updatedBy: actorUserId,
    source: options.source,
    createdByType: options.actorRole,
    createdByUserId: actorUserId,
    createdByRole: options.actorRole,
    updatedByUserId: actorUserId,
    updatedByRole: options.actorRole,
  };

  // ── Field OPTIONAL ─────────────────────────────────────────────────────────
  // Firestore KHÔNG nhận `undefined` (ném lỗi → 500), nên field nào không có giá trị thì
  // phải BỎ HẲN key, không được ghi `key: undefined`. Đây không phải validation —
  // dữ liệu đã sạch từ zod ở `parseAttendancePayload`; các khối dưới chỉ canh việc đó.
  //
  //   employeeUserId              thợ chính — chưa gán ai thì để trống
  //   startTimestamp/endTimestamp chỉ có khi FE gửi mốc thời gian tuyệt đối
  //   customerName/customerPhone  khách vãng lai có thể không khai
  //   note                        ghi chú của thợ
  //   bookingSource               nguồn đặt lịch (booking web, gọi điện...)
  //   discount                    không có giảm giá thì không có key
  //   closedAt + closedBy         ĐI CẶP, chỉ khi chủ ghi bù vào ngày đã chốt sổ
  //
  // Mọi field còn lại là BẮT BUỘC — đã nằm trong object literal ở trên.
  // ───────────────────────────────────────────────────────────────────────────

  if (mainAssigneeUserId !== undefined) {
    attendanceDocumentData.employeeUserId = mainAssigneeUserId;
    attendanceDocumentData.mainAssigneeUserId = mainAssigneeUserId;
  }

  if (assistantAssigneeUserId !== undefined) {
    attendanceDocumentData.assistantAssigneeUserId = assistantAssigneeUserId;
  }

  if (attendanceTiming.startTimestamp !== undefined) {
    attendanceDocumentData.startTimestamp = attendanceTiming.startTimestamp;
  }

  if (attendanceTiming.endTimestamp !== undefined) {
    attendanceDocumentData.endTimestamp = attendanceTiming.endTimestamp;
  }

  if (attendanceInput.customerName !== undefined) {
    attendanceDocumentData.customerName = attendanceInput.customerName;
  }

  if (attendanceInput.customerPhone !== undefined) {
    attendanceDocumentData.customerPhone = attendanceInput.customerPhone;
  }

  if (attendanceInput.note !== undefined) {
    attendanceDocumentData.note = attendanceInput.note;
  }

  if (attendanceInput.bookingSource !== undefined) {
    attendanceDocumentData.bookingSource = attendanceInput.bookingSource;
  }

  if (options.discount !== undefined) {
    attendanceDocumentData.discount = options.discount;
  }

  if (options.closedAtTimestamp !== undefined) {
    attendanceDocumentData.closedAt = options.closedAtTimestamp;
    attendanceDocumentData.closedBy = actorUserId;
  }

  return attendanceDocumentData;
};

export const createAttendance = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
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

  // Không resolve được store = không có quyền vào store đó (storeId luôn có sẵn do zod bắt buộc) → 403.
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
  const isFutureAttendance = isAttendanceStartInFuture({
    workDate: attendanceTiming.workDate,
    startTimestamp: attendanceTiming.startTimestamp,
    startTime: attendanceTiming.startTime,
    storeTimezone: attendanceTiming.storeTimezone,
    settlementCutoffTime,
  });

  if (authContext.role === "employee" && isFutureAttendance) {
    return createErrorResponse(res, SERVICE_ERRORS.employeeFutureBookingForbidden, {
      storeId: attendanceInput.storeId,
      workDate: attendanceTiming.workDate,
    });
  }
  const activeEmployeesInStoreByUid = new Map(
    activeEmployeesInStore.map((employee) => [employee.uid, employee]),
  );
  const attendanceServiceInputs = attendanceInput.services;

  if (!areAttendanceServiceReferencesValid(attendanceServiceInputs, serviceCatalog)) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "invalid service references",
    });
  }

  // `assignees` đã là hợp của (thợ trong mọi service) ∪ (thợ chính FE khai), dedupe sẵn ở
  // normalizeFrontendPayload. Dùng nguyên danh sách này để MỌI người được nhắc tên đều bị kiểm
  // có đang làm ở store không — kể cả thợ chính chưa được gán vào service nào.
  const attendanceAssigneeInputs = attendanceInput.assignees;
  const resolvedAssigneeInputs = resolveAttendanceAssigneeInputs(
    attendanceAssigneeInputs,
    activeEmployeesInStore,
  );
  const assigneeInputsFoundInStore = resolvedAssigneeInputs.filter(
    (assignee): assignee is NonNullable<(typeof resolvedAssigneeInputs)[number]> =>
      assignee !== undefined,
  );
  const everyAssigneeExistsInStore =
    assigneeInputsFoundInStore.length === attendanceAssigneeInputs.length;

  if (!everyAssigneeExistsInStore) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "unresolved assignees",
    });
  }

  const callerIsEmployee = authContext.role === "employee";
  const effectiveWorkDate = attendanceTiming.workDate;

  if (callerIsEmployee) {
    const callerEmployee = activeEmployeesInStore.find(
      (employee) => employee.uid === authContext.uid,
    );

    if (callerEmployee?.compensationModel === "hourly") {
      const timeTrackingSession = await withAttendanceSpan(
        ATTENDANCE_TRACE_CHILD_SPANS.timeTrackingCheck,
        {
          "app.store_id": attendanceInput.storeId,
          "attendance.work_date": effectiveWorkDate,
        },
        () =>
          firestoreRepository.shop.timeTracking.getEmployeeTimeTracking(
            authContext.ownerId,
            attendanceInput.storeId,
            authContext.uid,
            effectiveWorkDate,
          ),
      );

      if (!timeTrackingSession) {
        return createErrorResponse(res, SERVICE_ERRORS.employeeTimeTrackingRequired, {
          storeId: attendanceInput.storeId,
          workDate: effectiveWorkDate,
        });
      }
    }
  }

  const callerIsMainAssignee = attendanceInput.mainAssigneeUserId === authContext.uid;

  // Thợ tạo chấm công thì chấm công đó PHẢI có phần của mình — không tạo hộ người khác, và cũng
  // không tạo chấm công trống rồi để người khác gán sau. Chấm công chưa gán ai chỉ chủ/quản lý
  // mới tạo được (vd đặt lịch trước chưa biết ai làm → bookingStatus = "processing").
  if (callerIsEmployee && !callerIsMainAssignee) {
    return createErrorResponse(res, SERVICE_ERRORS.employeeAssigneeRequired, {
      reason: "employee must be the main assignee",
      role: authContext.role,
    });
  }

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
  const existingWorkDayClosing =
    existingSettlement?.status === "closed" ? existingSettlement.closing : undefined;
  setActiveAttendanceSpanAttributes({
    "attendance.work_day_closed": existingWorkDayClosing !== undefined,
  });

  // Endpoint này CHỈ lo ngày chưa chốt sổ. Ngày đã chốt → ghi bù phải qua POST .../attendances/backfill
  // (tính lại lương, chỉ chủ/quản lý). Trả 409 để FE chuyển endpoint.
  if (existingWorkDayClosing) {
    return createErrorResponse(res, SERVICE_ERRORS.workDayAlreadyClosed, {
      storeId: attendanceInput.storeId,
      workDate: effectiveWorkDate,
    });
  }

  // Thợ chỉ ghi được trong cửa sổ MAX_EMPLOYEE_PAST_ATTENDANCE_DAYS ngày. Chủ/quản lý không giới hạn.
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

  const createMode: AttendanceCreateMode = callerIsEmployee
    ? "employee_self_open"
    : "owner_assisted_open";

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

  const readyForConfirmation = isAttendanceReadyForConfirmation({
    employeeUserId: attendanceInput.mainAssigneeUserId,
    assignees: normalizedAssignees,
    services: attendanceServices,
  });

  // A quick-create draft is intentionally allowed to start without services or
  // an assignee; confirmation/completion still validates the full assignment.
  const isQuickDraftRequest =
    attendanceInput.bookingStatus === "processing" &&
    attendanceInput.bookingSource === "quick_attendance";

  if (!readyForConfirmation && !isFutureAttendance && !isQuickDraftRequest) {
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
  const source = resolveStaffAttendanceSource({
    workDate: effectiveWorkDate,
    startTimestamp: attendanceTiming.startTimestamp,
    startTime: attendanceTiming.startTime,
    storeTimezone: attendanceTiming.storeTimezone,
    settlementCutoffTime,
  });
  const actorRole = toAttendanceActorRole(authContext.role);
  const attendanceStatus = isFutureAttendance ? "open" : "closed";
  const createdAtTimestamp = Date.now();

  const rolledToNextWorkDate = effectiveWorkDate !== attendanceInput.workDate;
  setActiveAttendanceSpanAttributes({
    "attendance.source": source,
    "attendance.work_date": effectiveWorkDate,
    "attendance.work_date_relation": rolledToNextWorkDate
      ? "next_work_date"
      : "requested_work_date",
    "attendance.is_future": isFutureAttendance,
    "attendance.ready_for_confirmation": readyForConfirmation,
    "attendance.quick_draft": isQuickDraftRequest,
    "attendance.create_mode": createMode,
    "attendance.service_count": attendanceServices.length,
    "attendance.main_assignee_present": attendanceInput.mainAssigneeUserId !== undefined,
    "attendance.assistant_assignee_present": attendanceInput.assistantAssigneeUserId !== undefined,
  });

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
    settlementStatus: attendanceStatus,
    closedAtTimestamp: isFutureAttendance ? undefined : createdAtTimestamp,
    actorUserId: authContext.uid,
    actorRole,
    source,
    bookingStatus: readyForConfirmation ? "confirmed" : "processing",
  });

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
      "attendance.source": source,
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

  await Promise.all([
    withAttendanceSpan(
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
            status: attendanceStatus,
            bookingStatus: attendanceDocumentData.bookingStatus,
            createMode,
            recalculatedSettlementDates: [],
            serviceNames: attendanceServices.map((service) => service.name),
            serviceCount: attendanceServices.length,
            assigneeCount: normalizedAssignees.length,
            assigneeEmployeeUserIds: normalizedAssignees.map((assignee) => assignee.employeeUserId),
            source,
            ...(attendanceDocumentData.customerId !== undefined && {
              customerId: attendanceDocumentData.customerId,
            }),
            rolledToNextWorkDate,
          },
        }),
    ),
    withAttendanceSpan(
      ATTENDANCE_TRACE_CHILD_SPANS.settlementSync,
      {
        "app.store_id": attendanceInput.storeId,
        "attendance.work_date": effectiveWorkDate,
        "attendance.post_write_phase": "settlement_sync",
      },
      () =>
        synchronizeWorkDaySettlement(
          authContext.ownerId,
          attendanceInput.storeId,
          effectiveWorkDate,
        ),
    ),
  ]);

  const attendanceForResponse = normalizeAttendanceForResponse(createdAttendanceDocument);

  return res.status(StatusCodes.CREATED).json({
    item: toFrontendAttendanceItem(attendanceForResponse, {
      redactCustomerInfo: callerIsEmployee,
    }),
    meta: {
      storeId: attendanceInput.storeId,
      workDate: effectiveWorkDate,
      rolledToNextWorkDate,
      createMode,
      recalculatedSettlementDates: [],
    },
  });
};
