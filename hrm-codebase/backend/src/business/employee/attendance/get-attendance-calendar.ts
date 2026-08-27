import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { firestoreAuth, firestoreRepository } from "../../../repository/firestore/index.js";
import type {
  ShopAttendanceCalendarType,
  ShopAttendanceType,
  StoreType,
} from "../../../repository/firestore/shop/shop.types.js";
import type {
  EmployeeCompensationModel,
  EmployeeWeeklyWorkingHours,
} from "../../../repository/firestore/user/user.types.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { normalizeSettlementCutoffTime } from "../../../helpers/business-day.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { toFrontendAttendanceItem } from "../domain/attendance-presentation.js";
import { isAttendanceAssignedToUser } from "../domain/attendance-rules.js";
import {
  setActiveAttendanceSpanAttributes,
  setAttendanceResponseCacheStatus,
} from "./attendance-observability.js";

const SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/attendances/calendar/invalid-request",
    message: "Invalid request",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/calendar/forbidden-store",
    message: "Forbidden: store access denied",
  },
};

const getWorkDateFromQueryParam = (req: Request, queryParamName: string) => {
  const workDateQueryValue = req.query[queryParamName];
  return typeof workDateQueryValue === "string" && isValidWorkDate(workDateQueryValue)
    ? workDateQueryValue
    : undefined;
};

const resolveDateRange = (req: Request) => {
  const workDate =
    getWorkDateFromQueryParam(req, "workDate") ?? getWorkDateFromQueryParam(req, "date");
  const fromWorkDate = getWorkDateFromQueryParam(req, "fromWorkDate") ?? workDate;
  const toWorkDate = getWorkDateFromQueryParam(req, "toWorkDate") ?? workDate;

  if (!fromWorkDate || !toWorkDate || fromWorkDate > toWorkDate) {
    return null;
  }

  return { fromWorkDate, toWorkDate, workDate };
};

// View lịch FE yêu cầu; quyết số ngày hợp lệ của [fromWorkDate, toWorkDate].
type CalendarView = "day" | "week" | "month";
const CALENDAR_VIEW_VALUES = new Set<string>(["day", "week", "month"]);
const CALENDAR_WEEK_DAY_COUNT = 7;

// Số ngày thật của 1 tháng (monthOneBased: 1..12) — tự xử lý 28/29/30/31.
const getDaysInMonth = (year: number, monthOneBased: number): number =>
  new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();

// Đếm số ngày bao gồm cả 2 đầu mút.
const getInclusiveDayCount = (fromWorkDate: string, toWorkDate: string): number =>
  Math.floor(
    (Date.parse(`${toWorkDate}T00:00:00.000Z`) - Date.parse(`${fromWorkDate}T00:00:00.000Z`)) /
      86_400_000,
  ) + 1;

// Range có đúng là trọn 1 tháng lịch không: from = ngày 01, to = ngày cuối cùng của cùng tháng đó.
const isFullCalendarMonth = (fromWorkDate: string, toWorkDate: string): boolean => {
  const [year, monthOneBased, dayOfMonth] = fromWorkDate.split("-").map(Number);

  if (
    year === undefined ||
    monthOneBased === undefined ||
    monthOneBased < 1 ||
    monthOneBased > 12 ||
    dayOfMonth !== 1
  ) {
    return false;
  }

  const lastDayOfMonth = `${fromWorkDate.slice(0, 8)}${String(getDaysInMonth(year, monthOneBased)).padStart(2, "0")}`;
  return toWorkDate === lastDayOfMonth;
};

// Range có khớp granularity của view không: day = 1 ngày, week = 7 ngày, month = trọn tháng.
const isDateRangeValidForView = (
  view: CalendarView,
  fromWorkDate: string,
  toWorkDate: string,
): boolean => {
  if (view === "day") {
    return fromWorkDate === toWorkDate;
  }

  if (view === "week") {
    return getInclusiveDayCount(fromWorkDate, toWorkDate) === CALENDAR_WEEK_DAY_COUNT;
  }

  return isFullCalendarMonth(fromWorkDate, toWorkDate);
};

const toCalendarStore = (store: StoreType) => ({
  id: store.id,
  name: store.name,
  status: store.status,
  ...(store.timezone !== undefined && { timezone: store.timezone }),
  settlementCutoffTime: normalizeSettlementCutoffTime(store.settlementCutoffTime),
  ...(store.openTime !== undefined && { openTime: store.openTime }),
  ...(store.closeTime !== undefined && { closeTime: store.closeTime }),
});

const toCalendarEmployee = (employee: {
  uid: string;
  email: string;
  active: boolean;
  name?: string | undefined;
  displayName?: string | undefined;
  storeId?: string | undefined;
  compensationModel?: EmployeeCompensationModel | undefined;
  ownerCommissionRate?: number | undefined;
  fixedSalary?: number | undefined;
  hourlyRate?: number | undefined;
  weeklyWorkingHours?: EmployeeWeeklyWorkingHours | undefined;
}) => {
  const name = employee.name?.trim() || employee.displayName?.trim() || employee.email;
  const compensationModel =
    employee.compensationModel ?? (employee.hourlyRate !== undefined ? "hourly" : "commission");

  return {
    id: employee.uid,
    uid: employee.uid,
    name,
    active: employee.active,
    status: employee.active ? "active" : "inactive",
    ...(employee.storeId !== undefined && { storeId: employee.storeId }),
    compensationModel,
    ...(compensationModel === "commission" &&
      employee.ownerCommissionRate !== undefined && {
        ownerCommissionRate: employee.ownerCommissionRate,
      }),
    ...(compensationModel === "fixed" &&
      employee.fixedSalary !== undefined && { fixedSalary: employee.fixedSalary }),
    ...(compensationModel === "hourly" &&
      employee.hourlyRate !== undefined && { hourlyRate: employee.hourlyRate }),
    ...(compensationModel === "hourly" &&
      employee.weeklyWorkingHours !== undefined && {
        weeklyWorkingHours: employee.weeklyWorkingHours,
      }),
  };
};

const toCalendarAttendanceItem = (
  attendance: ShopAttendanceCalendarType,
  options?: { redactCustomerInfo?: boolean },
) => {
  const attendanceForPresentation: ShopAttendanceType = {
    ...attendance,
    assignees: attendance.assignees ?? [],
    services: attendance.services ?? [],
  };
  const { raw: _raw, ...calendarAttendanceItem } = toFrontendAttendanceItem(
    attendanceForPresentation,
    options,
  );

  return calendarAttendanceItem;
};

const countByStatus = (calendarItems: ReturnType<typeof toCalendarAttendanceItem>[]) =>
  calendarItems.reduce(
    (statusCounts, calendarItem) => {
      if (calendarItem.status === "closed") {
        statusCounts.closedCount += 1;
      } else {
        statusCounts.openCount += 1;
      }

      return statusCounts;
    },
    { openCount: 0, closedCount: 0 },
  );

export const getAttendanceCalendar = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const dateRange = resolveDateRange(req);
  const viewFromQuery = req.query["view"];
  const requestedStoreId = getStoreIdFromUrlPath(req)?.trim();

  if (!dateRange) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "invalid date range",
    });
  }

  if (typeof viewFromQuery !== "string" || !CALENDAR_VIEW_VALUES.has(viewFromQuery)) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "missing or invalid view",
      view: viewFromQuery,
    });
  }

  const view = viewFromQuery as CalendarView;

  if (!isDateRangeValidForView(view, dateRange.fromWorkDate, dateRange.toWorkDate)) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "date range does not match view",
      view,
      fromWorkDate: dateRange.fromWorkDate,
      toWorkDate: dateRange.toWorkDate,
    });
  }

  // storeId lấy từ URL path (route nested `/stores/:storeId/...`). Owner: mọi store của mình;
  // non-owner: chỉ store mình thuộc về. storeId lạ/không thuộc owner → getStore không thấy → 403.
  if (!requestedStoreId || !canAccessStore(authContext, requestedStoreId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      requestedStoreId,
      role: authContext.role,
    });
  }

  const store = await firestoreRepository.shop.store
    .getStore(authContext.ownerId, requestedStoreId)
    .catch((error: unknown) => {
      if (error instanceof FirestoreDataNotFoundError) {
        return null;
      }

      throw error;
    });

  if (!store) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      requestedStoreId,
      role: authContext.role,
    });
  }

  const loadCalendarEmployees = async () => {
    if (authContext.role === "employee") {
      const user = await firestoreRepository.user.getUser(authContext.uid);
      return [user];
    }

    return firestoreRepository.user.listShopEmployees(authContext.ownerId, {
      storeId: store.id,
      active: true,
    });
  };

  // Employees need their own schedule plus unclaimed store Requests and
  // leave-conflict bookings, so their read must start from the store range.
  const attendanceCalendarReadOptions: {
    employeeUserId?: string;
    skipCache: boolean;
  } = {
    skipCache: true,
  };

  const [employees, attendances, employeeWorkDayClosings] = await Promise.all([
    loadCalendarEmployees(),
    firestoreRepository.shop.attendance.listShopAttendanceCalendarByStoreDateRange(
      authContext.ownerId,
      store.id,
      dateRange.fromWorkDate,
      dateRange.toWorkDate,
      attendanceCalendarReadOptions,
    ),
    authContext.role === "employee"
      ? firestoreRepository.shop.session.listEmployeeWorkDayClosingsByStoreDateRange(
          authContext.ownerId,
          store.id,
          dateRange.fromWorkDate,
          dateRange.toWorkDate,
        )
      : Promise.resolve([]),
  ]);

  // Owner/manager see the store. Employees see their own appointments and the
  // shared yellow workflow column. A Request remains in that shared column
  // after approval/assignment so every employee can see which segment is still
  // free and who already claimed another segment from the same booking.
  let attendancesWithinCallerScope = attendances;

  if (authContext.role === "employee") {
    attendancesWithinCallerScope = attendances.filter((attendance) => {
      if (isAttendanceAssignedToUser(attendance, authContext.uid)) return true;
      const assignedEmployeeUserId = attendance.mainAssigneeUserId ?? attendance.employeeUserId;
      const isVisibleRequest =
        attendance.originatedAsRequest === true &&
        !["cancelled", "no_show"].includes(attendance.bookingStatus ?? "");
      const isAnyStaffLeaveConflict =
        attendance.bookingStatus === "processing" &&
        attendance.staffSelectionType !== "specific";
      const isClaimedByCaller = attendance.proposedAssigneeUserId === authContext.uid;
      return isVisibleRequest || isAnyStaffLeaveConflict || isClaimedByCaller ||
        (attendance.bookingStatus === "requested" && assignedEmployeeUserId === undefined);
    });
  }
  const bookingIds = [...new Set(
    attendancesWithinCallerScope.flatMap((attendance) =>
      attendance.bookingId ? [attendance.bookingId] : [],
    ),
  )];
  const bookingAddOns = new Map<string, unknown[]>();
  await Promise.all(bookingIds.map(async (bookingId) => {
    const bookingDocument = await firestoreAuth
      .collection("stores")
      .doc(store.id)
      .collection("bookings")
      .doc(bookingId)
      .get();
    const addOns = bookingDocument.data()?.["addOns"];
    if (Array.isArray(addOns)) bookingAddOns.set(bookingId, addOns);
  }));
  const calendarAttendanceItems = attendancesWithinCallerScope.map((attendance) => ({
    ...toCalendarAttendanceItem(attendance, {
      redactCustomerInfo: authContext.role === "employee",
    }),
    ...(attendance.bookingId && bookingAddOns.has(attendance.bookingId) && {
      addOns: bookingAddOns.get(attendance.bookingId),
    }),
  }));
  const statusCounts = countByStatus(calendarAttendanceItems);

  setActiveAttendanceSpanAttributes({
    "attendance.total_count": calendarAttendanceItems.length,
    "attendance.returned_count": calendarAttendanceItems.length,
    "attendance.open_count": statusCounts.openCount,
    "attendance.closed_count": statusCounts.closedCount,
  });

  const responsePayload = {
    store: toCalendarStore(store),
    employees: employees.map(toCalendarEmployee),
    items: calendarAttendanceItems,
    ...(authContext.role === "employee" && {
      employeeWorkDayClosings: employeeWorkDayClosings
        .filter((closing) => closing.employeeUserId === authContext.uid)
        .map((closing) => ({
          workDate: closing.workDate,
          closedAt: closing.closedAt,
        })),
    }),
    meta: {
      storeId: store.id,
      fromWorkDate: dateRange.fromWorkDate,
      toWorkDate: dateRange.toWorkDate,
      totalCount: calendarAttendanceItems.length,
      returnedCount: calendarAttendanceItems.length,
      latestUpdatedAt: attendancesWithinCallerScope.reduce(
        (latest, attendance) => Math.max(latest, attendance.updatedAt ?? attendance.createdAt ?? 0),
        0,
      ),
      ...(dateRange.workDate !== undefined && { workDate: dateRange.workDate }),
      ...statusCounts,
    },
  };

  const response = sendCacheableJson(req, res, responsePayload, {
    cacheControl: "private, no-cache, max-age=0, must-revalidate",
  });
  setAttendanceResponseCacheStatus(res);
  return response;
};
