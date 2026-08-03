import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { can } from "../../../helpers/permissions.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";

const SERVICE_ERRORS = {
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/employees/leave-requests/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/employees/leave-requests/forbidden-store",
    message: "Forbidden: store access denied",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/employees/leave-requests/invalid-request",
    message: "Invalid request",
  },
  employeeNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/employees/leave-requests/employee-not-found",
    message: "Employee not found",
  },
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// `?limit=` (1..100, mặc định 20). Sai → mặc định.
const parseLimit = (value: unknown) =>
  typeof value === "string" && /^\d+$/.test(value)
    ? Math.min(Math.max(Number.parseInt(value, 10), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

// `?before=` cursor = createdAt của item cuối trang trước. Sai/thiếu → undefined (trang đầu).
const parseCursor = (value: unknown) =>
  typeof value === "string" && /^\d+$/.test(value) ? Number.parseInt(value, 10) : undefined;

export const getEmployeeLeaveRequests = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const employeeUserId = req.params["employeeUserId"];

  if (!can(authContext.role, "leave:manage")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  if (typeof employeeUserId !== "string" || !employeeUserId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "missing employeeUserId",
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

  const storeIdFromUrl = getStoreIdFromUrlPath(req);

  if (storeIdFromUrl !== undefined && storeIdFromUrl !== employee.storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      routeStoreId: storeIdFromUrl,
      employeeStoreId: employee.storeId,
    });
  }

  const storeId = employee.storeId;
  const limit = parseLimit(req.query["limit"]);
  const beforeCreatedAt = parseCursor(req.query["before"]);

  // Lấy dư 1 để biết còn trang sau.
  const fetchedLeaveRequests = await firestoreRepository.shop.employeeLeave.listEmployeeLeaveRequests(
    authContext.ownerId,
    {
      storeId,
      employeeUserId: employee.uid,
      limit: limit + 1,
      ...(beforeCreatedAt !== undefined && { beforeCreatedAt }),
    },
  );

  const hasMore = fetchedLeaveRequests.length > limit;
  const items = hasMore ? fetchedLeaveRequests.slice(0, limit) : fetchedLeaveRequests;
  const nextCursor = hasMore ? items[items.length - 1]?.createdAt : undefined;

  return sendCacheableJson(
    req,
    res,
    {
      items: items.map((leaveRequest) => ({
        id: leaveRequest.id,
        storeId: leaveRequest.storeId,
        employeeId: leaveRequest.employeeUserId,
        employeeUserId: leaveRequest.employeeUserId,
        employeeName: leaveRequest.employeeName,
        startDate: leaveRequest.startDate,
        endDate: leaveRequest.endDate,
        allDay: leaveRequest.allDay,
        reason: leaveRequest.reason,
        createdAt: leaveRequest.createdAt,
        updatedAt: leaveRequest.updatedAt,
      })),
      meta: {
        storeId,
        employeeId: employee.uid,
        limit,
        hasMore,
        ...(nextCursor !== undefined && { nextCursor }),
      },
    },
    {
      cacheControl: "private, max-age=30, stale-while-revalidate=60",
    },
  );
};
