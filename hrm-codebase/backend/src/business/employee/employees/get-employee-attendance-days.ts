import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { canAccessStore, canReadEmployeeRecord } from "../../../helpers/role-access.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { getOrSetCacheableResponse } from "../../../modules/cacheable-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import type { ShopAttendanceType } from "../../../repository/firestore/shop/shop.types.js";
import { addMoney, sumMoney } from "../../../helpers/money.js";

const PAGE_SIZE_DAYS = 10;
const DAY_MS = 86_400_000;

const SERVICE_ERRORS = {
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/employees/attendance-days/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/employees/attendance-days/forbidden-store",
    message: "Forbidden: store access denied",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/employees/attendance-days/invalid-request",
    message: "Invalid request",
  },
  employeeNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/employees/attendance-days/not-found",
    message: "Employee not found",
  },
  noStore: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/employees/attendance-days/store-not-found",
    message: "Store not found",
  },
};

type AttendanceDaySummary = {
  workDate: string;
  worked: boolean;
  attendanceCount: number;
  totalRevenue: number;
};

// Coi mỗi ngày là "số ngày kể từ epoch" (UTC) để mọi số học là cộng/trừ số nguyên. Chỉ đổi sang
// chuỗi "YYYY-MM-DD" đúng ở đây.
const toWorkDate = (dayNumber: number) => new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);

const isEmployeeAssignedToAttendance = (attendance: ShopAttendanceType, employeeUserId: string) =>
  attendance.employeeUserId === employeeUserId ||
  attendance.createdBy === employeeUserId ||
  attendance.assigneeUserIds?.includes(employeeUserId) === true ||
  attendance.assignees.some((assignee) => assignee.employeeUserId === employeeUserId) ||
  attendance.services.some((service) =>
    service.employees?.some((employee) => employee.employeeUserId === employeeUserId),
  );

const getEmployeeRevenueInAttendance = (attendance: ShopAttendanceType, employeeUserId: string) => {
  let hasServiceShare = false;
  const serviceShareRevenue = attendance.services.reduce((attendanceTotal, service) => {
    const serviceTotal =
      service.employees?.reduce((employeeTotal, employee) => {
        if (employee.employeeUserId !== employeeUserId) {
          return employeeTotal;
        }

        hasServiceShare = true;
        return employeeTotal + (employee.shareAmount ?? 0);
      }, 0) ?? 0;

    return attendanceTotal + serviceTotal;
  }, 0);

  if (hasServiceShare) {
    return serviceShareRevenue;
  }

  const assignee = attendance.assignees.find(
    (candidate) => candidate.employeeUserId === employeeUserId,
  );

  if (assignee?.shareAmount !== undefined) {
    return assignee.shareAmount;
  }

  return isEmployeeAssignedToAttendance(attendance, employeeUserId) ? attendance.totalAmount : 0;
};

const buildAttendanceDays = (
  attendances: ShopAttendanceType[],
  employeeUserId: string,
  workDates: string[],
): AttendanceDaySummary[] => {
  const byWorkDate = new Map<string, { attendanceCount: number; totalRevenue: number }>();

  attendances.forEach((attendance) => {
    const existing = byWorkDate.get(attendance.workDate) ?? { attendanceCount: 0, totalRevenue: 0 };

    existing.attendanceCount += 1;
    existing.totalRevenue = addMoney(
      existing.totalRevenue,
      getEmployeeRevenueInAttendance(attendance, employeeUserId),
    );
    byWorkDate.set(attendance.workDate, existing);
  });

  // Điền đủ mọi ngày trong trang (đã sort mới-nhất-trước); ngày không có chấm công → "không đi làm".
  return workDates.map((workDate) => {
    const summary = byWorkDate.get(workDate);

    return {
      workDate,
      worked: summary !== undefined,
      attendanceCount: summary?.attendanceCount ?? 0,
      totalRevenue: summary?.totalRevenue ?? 0,
    };
  });
};

export const getEmployeeAttendanceDays = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const employeeUserId = req.params["employeeUserId"];
  // `?before=` cursor = workDate ngày đầu của trang trước (YYYY-MM-DD). Thiếu → trang mới nhất.
  const before = typeof req.query["before"] === "string" ? req.query["before"] : undefined;
  const beforeMs = before !== undefined ? Date.parse(`${before}T00:00:00.000Z`) : undefined;
  const hasValidCursor =
    before === undefined ||
    (/^\d{4}-\d{2}-\d{2}$/.test(before) && Number.isFinite(beforeMs));

  if (typeof employeeUserId !== "string" || !employeeUserId || !hasValidCursor) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      employeeUserId,
      reason: hasValidCursor ? "missing employeeUserId" : "invalid before cursor",
    });
  }

  const employee = await firestoreRepository.user.getUser(employeeUserId).catch((error: unknown) => {
    if (error instanceof FirestoreDataNotFoundError) {
      return undefined;
    }

    throw error;
  });

  if (!employee || employee.ownerId !== authContext.ownerId || employee.role !== "employee") {
    return createErrorResponse(res, SERVICE_ERRORS.employeeNotFound, { employeeUserId });
  }

  if (!canReadEmployeeRecord(authContext, employee)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  const requestedStoreId = getStoreIdFromUrlPath(req)?.trim() || undefined;
  const employeeStoreId = employee.storeId?.trim();
  const effectiveStoreId = requestedStoreId ?? employeeStoreId ?? authContext.storeId;

  if (!effectiveStoreId) {
    return createErrorResponse(res, SERVICE_ERRORS.noStore, {
      reason: "no store resolved",
      employeeUserId,
    });
  }

  if (employeeStoreId && effectiveStoreId !== employeeStoreId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      effectiveStoreId,
      employeeStoreId,
    });
  }

  if (!canAccessStore(authContext, effectiveStoreId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      role: authContext.role,
      effectiveStoreId,
    });
  }

  const store = await firestoreRepository.shop.store
    .getStore(authContext.ownerId, effectiveStoreId)
    .catch((error: unknown) => {
      if (error instanceof FirestoreDataNotFoundError) {
        return null;
      }

      throw error;
    });

  if (!store) {
    return createErrorResponse(res, SERVICE_ERRORS.noStore, { effectiveStoreId });
  }

  // Cửa sổ 10 ngày: mặc định [today-9 … today]; có cursor thì 10 ngày kết thúc ngay TRƯỚC `before`.
  const endDay =
    beforeMs !== undefined ? Math.round(beforeMs / DAY_MS) - 1 : Math.floor(Date.now() / DAY_MS);
  const fromWorkDate = toWorkDate(endDay - (PAGE_SIZE_DAYS - 1));
  const toWorkDateValue = toWorkDate(endDay);
  const workDates = Array.from({ length: PAGE_SIZE_DAYS }, (_, index) => toWorkDate(endDay - index));

  // Hết trang khi cửa sổ lùi tới trước ngày nhân viên vào làm (createdAt). `nextCursor` = ngày đầu
  // cửa sổ hiện tại → FE truyền lại vào `?before=` để lấy 10 ngày cũ hơn.
  const hireWorkDate =
    typeof employee.createdAt === "number"
      ? toWorkDate(Math.floor(employee.createdAt / DAY_MS))
      : undefined;
  const hasMore = hireWorkDate !== undefined && fromWorkDate > hireWorkDate;
  const nextCursor = hasMore ? fromWorkDate : undefined;

  const cacheKey = [
    "store",
    authContext.ownerId,
    "response:employee-attendance-days",
    authContext.role,
    authContext.uid,
    store.id,
    employee.uid,
    fromWorkDate,
    toWorkDateValue,
  ].join(":");

  return getOrSetCacheableResponse({
    request: req,
    response: res,
    cacheKey,
    ttlMs: 30_000,
    cacheControl: "private, max-age=30, stale-while-revalidate=60",
    producer: async () => {
      const attendances =
        await firestoreRepository.shop.attendance.listShopAttendanceByEmployeeDateRange(
          authContext.ownerId,
          store.id,
          employee.uid,
          fromWorkDate,
          toWorkDateValue,
        );
      const items = buildAttendanceDays(attendances, employee.uid, workDates);
      const totalAttendanceCount = items.reduce(
        (total, attendanceDay) => total + attendanceDay.attendanceCount,
        0,
      );
      const totalRevenue = sumMoney(items.map((attendanceDay) => attendanceDay.totalRevenue));
      const workedDayCount = items.filter((attendanceDay) => attendanceDay.worked).length;

      return {
        items,
        meta: {
          storeId: store.id,
          employeeUserId: employee.uid,
          pageSize: PAGE_SIZE_DAYS,
          fromWorkDate,
          toWorkDate: toWorkDateValue,
          hasMore,
          ...(nextCursor !== undefined && { nextCursor }),
          totalAttendanceCount,
          workedDayCount,
          totalRevenue,
        },
      };
    },
  });
};
