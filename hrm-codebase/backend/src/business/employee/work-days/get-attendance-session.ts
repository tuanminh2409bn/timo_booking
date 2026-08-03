import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { canAccessStore, isOwner } from "../../../helpers/role-access.js";
import {
  normalizeAttendanceForResponse,
  toFrontendAttendanceItem,
} from "../domain/attendance-presentation.js";
import { isAttendanceAssignedToEmployee } from "../domain/employee-portal-shared.js";
import { sumMoney } from "../../../helpers/money.js";

const ATTENDANCE_SESSION_SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/work-days/invalid-request",
    message: "Invalid attendance session request",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/work-days/forbidden-store",
    message: "Forbidden: store access denied",
  },
};

const resolveWorkDate = (query: Request["query"]) => {
  let rawWorkDate: string | undefined;

  if (typeof query["workDate"] === "string") {
    rawWorkDate = query["workDate"];
  } else if (typeof query["date"] === "string") {
    rawWorkDate = query["date"];
  }

  if (!rawWorkDate) {
    return undefined;
  }

  if (isValidWorkDate(rawWorkDate)) {
    return rawWorkDate;
  }

  const parsedDate = new Date(rawWorkDate);

  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }

  const year = parsedDate.getFullYear();
  const month = `${parsedDate.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsedDate.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
};

export const getAttendanceSession = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const workDate = resolveWorkDate(req.query);
  const requestedStoreId = getStoreIdFromUrlPath(req);

  if (!workDate || !isValidWorkDate(workDate)) {
    return createErrorResponse(res, ATTENDANCE_SESSION_SERVICE_ERRORS.invalidRequest, {
      reason: "missing or invalid workDate",
    });
  }

  const storeId = !isOwner(authContext.role) ? authContext.storeId : requestedStoreId;

  if (!storeId || !canAccessStore(authContext, storeId)) {
    return createErrorResponse(res, ATTENDANCE_SESSION_SERVICE_ERRORS.forbiddenStore, {
      storeId,
      role: authContext.role,
    });
  }

  if (
    requestedStoreId !== undefined &&
    !isOwner(authContext.role) &&
    requestedStoreId !== storeId
  ) {
    return createErrorResponse(res, ATTENDANCE_SESSION_SERVICE_ERRORS.forbiddenStore, {
      requestedStoreId,
      storeId,
    });
  }

  const attendances =
    await firestoreRepository.shop.attendance.listShopAttendanceByStoreWorkDateKey(
      authContext.ownerId,
      storeId,
      workDate,
    );
  // Manager thấy mọi attendance trong session (như owner); employee chỉ thấy của mình.
  const attendancesWithinCallerScope =
    authContext.role === "employee"
      ? attendances.filter((attendance) =>
          isAttendanceAssignedToEmployee(attendance, authContext.uid),
        )
      : attendances;
  const normalizedAttendances = attendancesWithinCallerScope.map(normalizeAttendanceForResponse);
  const totalAmount = sumMoney(normalizedAttendances.map((attendance) => attendance.totalAmount));
  const serviceCount = normalizedAttendances.reduce(
    (sum, attendance) => sum + attendance.services.length,
    0,
  );
  const openCount = normalizedAttendances.filter(
    (attendance) => attendance.status === "open",
  ).length;
  const closedCount = normalizedAttendances.length - openCount;

  return sendCacheableJson(
    req,
    res,
    {
      session: {
        id: `${storeId}__${workDate}__${authContext.uid}`,
        ownerId: authContext.ownerId,
        employeeUserId: authContext.uid,
        storeId,
        workDate,
        status: openCount > 0 ? "open" : "completed",
        summary: {
          totalEntries: normalizedAttendances.length,
          serviceCount,
          openCount,
          closedCount,
          totalAmount,
        },
        attendances: normalizedAttendances,
        items: normalizedAttendances.map((attendance) =>
          toFrontendAttendanceItem(attendance, {
            redactCustomerInfo: authContext.role === "employee",
          }),
        ),
      },
    },
    {
      cacheControl: "private, max-age=10, stale-while-revalidate=20",
    },
  );
};
