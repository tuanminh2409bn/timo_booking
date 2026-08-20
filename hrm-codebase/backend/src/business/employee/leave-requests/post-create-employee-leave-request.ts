import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { getStoreIdFromUrlPath, mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";
import { can } from "../../../helpers/permissions.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { leaveRequestSchema } from "./leave-request-shared.js";
import { processLeaveConflicts } from "./leave-conflict-processing.js";

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

export const createEmployeeLeaveRequest = async (req: Request, res: Response) => {
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
  const createLeaveRequestParseResult = leaveRequestSchema.safeParse(mergeUrlPathStoreId(req, req.body));

  if (!createLeaveRequestParseResult.success || createLeaveRequestParseResult.data.startDate > createLeaveRequestParseResult.data.endDate) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      ...(createLeaveRequestParseResult.success
        ? { reason: "startDate after endDate" }
        : { validation: createLeaveRequestParseResult.error.flatten().fieldErrors }),
    });
  }

  if (createLeaveRequestParseResult.data.storeId !== storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      payloadStoreId: createLeaveRequestParseResult.data.storeId,
      employeeStoreId: storeId,
    });
  }

  const createdLeaveRequest = await firestoreRepository.shop.employeeLeave.createEmployeeLeaveRequest(
    authContext.ownerId,
    {
      storeId,
      employeeUserId: employee.uid,
      employeeName: employee.name ?? employee.displayName ?? employee.email,
      startDate: createLeaveRequestParseResult.data.startDate,
      endDate: createLeaveRequestParseResult.data.endDate,
      allDay: createLeaveRequestParseResult.data.allDay,
      ...(createLeaveRequestParseResult.data.startTime !== undefined && { startTime: createLeaveRequestParseResult.data.startTime }),
      ...(createLeaveRequestParseResult.data.endTime !== undefined && { endTime: createLeaveRequestParseResult.data.endTime }),
      reason: createLeaveRequestParseResult.data.reason,
      createdByUserId: authContext.uid,
      updatedByUserId: authContext.uid,
    },
  );

  await writeShopAuditLog({
    ownerId: authContext.ownerId,
    eventType: "employee_leave_created",
    entityType: "employee_leave",
    entityId: createdLeaveRequest.id,
    storeId,
    actor: {
      uid: authContext.uid,
      role: authContext.role,
    },
    metadata: {
      targetUserId: employee.uid,
      employeeName: createdLeaveRequest.employeeName,
      startDate: createdLeaveRequest.startDate,
      endDate: createdLeaveRequest.endDate,
      allDay: createdLeaveRequest.allDay,
      ...(createdLeaveRequest.startTime !== undefined && { startTime: createdLeaveRequest.startTime }),
      ...(createdLeaveRequest.endTime !== undefined && { endTime: createdLeaveRequest.endTime }),
    },
  });

  const conflictResolution = await processLeaveConflicts({
    ownerId: authContext.ownerId,
    storeId,
    employeeUserId: employee.uid,
    leaveWindow: {
      startDate: createdLeaveRequest.startDate,
      endDate: createdLeaveRequest.endDate,
      allDay: createdLeaveRequest.allDay,
      ...(createdLeaveRequest.startTime !== undefined && { startTime: createdLeaveRequest.startTime }),
      ...(createdLeaveRequest.endTime !== undefined && { endTime: createdLeaveRequest.endTime }),
    },
    actorUserId: authContext.uid,
    actorRole: authContext.role,
  });

  return res.status(StatusCodes.CREATED).json({
    item: {
      id: createdLeaveRequest.id,
      storeId: createdLeaveRequest.storeId,
      employeeId: createdLeaveRequest.employeeUserId,
      employeeUserId: createdLeaveRequest.employeeUserId,
      employeeName: createdLeaveRequest.employeeName,
      startDate: createdLeaveRequest.startDate,
      endDate: createdLeaveRequest.endDate,
      allDay: createdLeaveRequest.allDay,
      ...(createdLeaveRequest.startTime !== undefined && { startTime: createdLeaveRequest.startTime }),
      ...(createdLeaveRequest.endTime !== undefined && { endTime: createdLeaveRequest.endTime }),
      reason: createdLeaveRequest.reason,
      createdAt: createdLeaveRequest.createdAt,
      updatedAt: createdLeaveRequest.updatedAt,
    },
    conflictResolution,
  });
};
