import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { isOwner, type AuthorizedAppContext } from "../../../helpers/role-access.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import {
  normalizeAttendanceForResponse,
  toFrontendAttendanceItem,
} from "../domain/attendance-presentation.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { canReadAttendance, isAttendanceAssignedToUser } from "../domain/attendance-rules.js";
import { resolveAttendanceStoreScope } from "../domain/attendance-store-scope.js";
import {
  setActiveAttendanceSpanAttributes,
  setAttendanceResponseCacheStatus,
} from "./attendance-observability.js";
import {
  DEFAULT_BOOKING_STATUS,
  SHOP_ATTENDANCE_BOOKING_STATUSES,
  type ShopAttendanceBookingStatus,
  type ShopAttendanceType,
} from "../../../repository/firestore/shop/shop.types.js";

const SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/attendances/invalid-request",
    message: "Invalid request",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenFilter: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/forbidden-filter",
    message: "Forbidden: filter not allowed for this role",
  },
};

// Giá trị hợp lệ cho từng query filter.
const ALLOWED_SETTLEMENT_STATUS_FILTER_VALUES = new Set(["open", "closed"]);
const ALLOWED_BOOKING_STATUS_FILTER_VALUES = new Set<string>(SHOP_ATTENDANCE_BOOKING_STATUSES);
// Employee chỉ quan tâm việc của mình: đã xác nhận, khách không đến, đã huỷ.
const BOOKING_STATUS_FILTER_VALUES_ALLOWED_FOR_EMPLOYEE = new Set<string>([
  "confirmed",
  "no_show",
  "cancelled",
]);

type NormalizedAttendanceForResponse = ReturnType<typeof normalizeAttendanceForResponse>;

const getBookingStatusOrDefault = (
  attendance: NormalizedAttendanceForResponse,
): ShopAttendanceBookingStatus => attendance.bookingStatus ?? DEFAULT_BOOKING_STATUS;

// Lấy workDate từ query (`?workDate=` hoặc alias `?date=`); chuẩn hoá về YYYY-MM-DD, sai → undefined.
const resolveWorkDateFromQuery = (query: Request["query"]): string | undefined => {
  let rawWorkDateFromQuery: string | undefined;

  if (typeof query["workDate"] === "string") {
    rawWorkDateFromQuery = query["workDate"];
  } else if (typeof query["date"] === "string") {
    rawWorkDateFromQuery = query["date"];
  }

  if (!rawWorkDateFromQuery) {
    return undefined;
  }

  if (isValidWorkDate(rawWorkDateFromQuery)) {
    return rawWorkDateFromQuery;
  }

  const parsedWorkDate = new Date(rawWorkDateFromQuery);

  if (Number.isNaN(parsedWorkDate.getTime())) {
    return undefined;
  }

  const fullYear = parsedWorkDate.getFullYear();
  const twoDigitMonth = `${parsedWorkDate.getMonth() + 1}`.padStart(2, "0");
  const twoDigitDay = `${parsedWorkDate.getDate()}`.padStart(2, "0");

  return `${fullYear}-${twoDigitMonth}-${twoDigitDay}`;
};

// Giữ lại attendance mà caller được phép đọc (owner/manager: cả store; employee: chỉ của mình),
// và nếu có lọc theo 1 nhân viên thì phải khớp nhân viên đó.
const selectAttendancesWithinCallerScope = (
  storedAttendances: ShopAttendanceType[],
  authContext: AuthorizedAppContext,
  employeeUserIdFilter: string | undefined,
): ShopAttendanceType[] =>
  storedAttendances.filter((attendance) => {
    const callerCanReadAttendance =
      isOwner(authContext.role) || canReadAttendance(authContext, attendance);
    const attendanceMatchesEmployeeFilter =
      employeeUserIdFilter === undefined ||
      isAttendanceAssignedToUser(attendance, employeeUserIdFilter);

    return callerCanReadAttendance && attendanceMatchesEmployeeFilter;
  });

// Giữ lại attendance khớp các bộ lọc hiển thị: settlement status (open/closed) + booking status.
const selectAttendancesMatchingStatusFilters = (
  attendances: NormalizedAttendanceForResponse[],
  settlementStatusFilter: string | undefined,
  bookingStatusFilter: ShopAttendanceBookingStatus | undefined,
): NormalizedAttendanceForResponse[] =>
  attendances.filter((attendance) => {
    const attendanceMatchesSettlementStatusFilter =
      settlementStatusFilter === undefined || attendance.status === settlementStatusFilter;
    const attendanceMatchesBookingStatusFilter =
      bookingStatusFilter === undefined ||
      getBookingStatusOrDefault(attendance) === bookingStatusFilter;

    return attendanceMatchesSettlementStatusFilter && attendanceMatchesBookingStatusFilter;
  });

export const getAttendanceList = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const {
    employeeUserId: employeeUserIdFromQuery,
    status: settlementStatusFromQuery,
    bookingStatus: bookingStatusFromQuery,
  } = req.query;
  const requestedWorkDate = resolveWorkDateFromQuery(req.query);
  const storeIdFromUrl = getStoreIdFromUrlPath(req);

  const respondInvalidRequest = (reason: string) =>
    createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason,
      workDate: requestedWorkDate,
      storeId: storeIdFromUrl,
    });
  const respondForbiddenFilter = (reason: string) =>
    createErrorResponse(res, SERVICE_ERRORS.forbiddenFilter, { reason, role: authContext.role });

  // Employee: chỉ xem của mình, chỉ lọc theo ngày + booking status (confirmed/no_show/cancelled).
  // Owner/manager: lọc đầy đủ.
  const callerIsEmployee = authContext.role === "employee";

  // `resolveWorkDateFromQuery` đã đảm bảo workDate hợp lệ (YYYY-MM-DD) hoặc undefined.
  if (!requestedWorkDate) {
    return respondInvalidRequest("missing or invalid workDate");
  }
  if (isOwner(authContext.role) && (typeof storeIdFromUrl !== "string" || !storeIdFromUrl)) {
    return respondInvalidRequest("owner must provide storeId");
  }
  if (employeeUserIdFromQuery !== undefined) {
    if (callerIsEmployee) {
      return respondForbiddenFilter("employees cannot filter by employeeUserId");
    }
    if (typeof employeeUserIdFromQuery !== "string") {
      return respondInvalidRequest("invalid employeeUserId");
    }
  }
  if (settlementStatusFromQuery !== undefined) {
    if (callerIsEmployee) {
      return respondForbiddenFilter("employees cannot filter by settlement status");
    }
    if (
      typeof settlementStatusFromQuery !== "string" ||
      !ALLOWED_SETTLEMENT_STATUS_FILTER_VALUES.has(settlementStatusFromQuery)
    ) {
      return respondInvalidRequest("invalid status");
    }
  }
  if (bookingStatusFromQuery !== undefined) {
    if (
      typeof bookingStatusFromQuery !== "string" ||
      !ALLOWED_BOOKING_STATUS_FILTER_VALUES.has(bookingStatusFromQuery)
    ) {
      return respondInvalidRequest("invalid bookingStatus");
    }
    if (
      callerIsEmployee &&
      !BOOKING_STATUS_FILTER_VALUES_ALLOWED_FOR_EMPLOYEE.has(bookingStatusFromQuery)
    ) {
      return respondForbiddenFilter("bookingStatus filter not allowed for employee");
    }
  }

  const employeeUserIdFilter =
    typeof employeeUserIdFromQuery === "string" ? employeeUserIdFromQuery : undefined;
  const settlementStatusFilter =
    typeof settlementStatusFromQuery === "string" ? settlementStatusFromQuery : undefined;
  const bookingStatusFilter =
    typeof bookingStatusFromQuery === "string"
      ? (bookingStatusFromQuery as ShopAttendanceBookingStatus)
      : undefined;

  const resolvedStoreScope = await resolveAttendanceStoreScope(authContext, storeIdFromUrl);

  if (!resolvedStoreScope) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, { storeId: storeIdFromUrl });
  }

  const canonicalStoreId = resolvedStoreScope.storeId;
  const attendancesStoredForWorkDate =
    await firestoreRepository.shop.attendance.listShopAttendanceByStoreWorkDateKey(
      authContext.ownerId,
      canonicalStoreId,
      requestedWorkDate,
    );

  // Toàn bộ attendance của ngày mà caller được xem (owner/manager: cả store; employee: chỉ của mình) —
  // normalize 1 lần, dùng cho cả đếm lẫn items.
  const attendancesForDayWithinCallerScope = selectAttendancesWithinCallerScope(
    attendancesStoredForWorkDate,
    authContext,
    employeeUserIdFilter,
  ).map(normalizeAttendanceForResponse);

  const attendancesMatchingRequestedFilters = selectAttendancesMatchingStatusFilters(
    attendancesForDayWithinCallerScope,
    settlementStatusFilter,
    bookingStatusFilter,
  );
  const openCount = attendancesForDayWithinCallerScope.filter(
    (attendance) => attendance.status === "open",
  ).length;
  const closedCount = attendancesForDayWithinCallerScope.filter(
    (attendance) => attendance.status === "closed",
  ).length;

  setActiveAttendanceSpanAttributes({
    "attendance.total_count": attendancesForDayWithinCallerScope.length,
    "attendance.returned_count": attendancesMatchingRequestedFilters.length,
    "attendance.open_count": openCount,
    "attendance.closed_count": closedCount,
  });

  const response = sendCacheableJson(
    req,
    res,
    {
      items: attendancesMatchingRequestedFilters.map((attendance) =>
        toFrontendAttendanceItem(attendance, {
          redactCustomerInfo: authContext.role === "employee",
        }),
      ),
      meta: {
        storeId: canonicalStoreId,
        workDate: requestedWorkDate,
        totalCount: attendancesForDayWithinCallerScope.length,
        returnedCount: attendancesMatchingRequestedFilters.length,
        openCount,
        closedCount,
        bookingStatusCounts: {
          requested: attendancesForDayWithinCallerScope.filter(
            (attendance) => getBookingStatusOrDefault(attendance) === "requested",
          ).length,
          confirmed: attendancesForDayWithinCallerScope.filter(
            (attendance) => getBookingStatusOrDefault(attendance) === "confirmed",
          ).length,
          processing: attendancesForDayWithinCallerScope.filter(
            (attendance) => getBookingStatusOrDefault(attendance) === "processing",
          ).length,
          no_show: attendancesForDayWithinCallerScope.filter(
            (attendance) => getBookingStatusOrDefault(attendance) === "no_show",
          ).length,
          cancelled: attendancesForDayWithinCallerScope.filter(
            (attendance) => getBookingStatusOrDefault(attendance) === "cancelled",
          ).length,
        },
        // Echo filter đang bật (undefined → JSON tự bỏ key).
        employeeUserId: employeeUserIdFilter,
        status: settlementStatusFilter,
        bookingStatus: bookingStatusFilter,
      },
    },
    { cacheControl: "private, max-age=5, stale-while-revalidate=10" },
  );
  setAttendanceResponseCacheStatus(res);
  return response;
};
