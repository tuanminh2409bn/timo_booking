import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { can } from "../../../helpers/permissions.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
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
  leaveRequestNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/employees/leave-requests/not-found",
    message: "Leave request not found",
  },
  internalError: {
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    type: "/stores/employees/leave-requests/internal-error",
    message: "Internal Server Error",
  },
};

export const deleteEmployeeLeaveRequest = async (req: Request, res: Response) => {
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
  const leaveRequestId = req.params["leaveRequestId"];

  if (typeof leaveRequestId !== "string" || !leaveRequestId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "missing leaveRequestId",
    });
  }

  let deletedLeaveRequest;

  try {
    deletedLeaveRequest = await firestoreRepository.shop.employeeLeave.deleteEmployeeLeaveRequest(
      authContext.ownerId,
      {
        storeId,
        employeeUserId: employee.uid,
        leaveRequestId,
      },
    );
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_ERRORS.leaveRequestNotFound, { leaveRequestId });
    }

    return createErrorResponse(res, SERVICE_ERRORS.internalError, {
      leaveRequestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  await writeShopAuditLog({
    ownerId: authContext.ownerId,
    eventType: "employee_leave_deleted",
    entityType: "employee_leave",
    entityId: deletedLeaveRequest.id,
    storeId,
    actor: {
      uid: authContext.uid,
      role: authContext.role,
    },
    metadata: {
      targetUserId: employee.uid,
      employeeName: deletedLeaveRequest.employeeName,
      startDate: deletedLeaveRequest.startDate,
      endDate: deletedLeaveRequest.endDate,
    },
  });

  return res.status(StatusCodes.OK).json({
    id: deletedLeaveRequest.id,
    deleted: true,
    storeId: deletedLeaveRequest.storeId,
    employeeUserId: deletedLeaveRequest.employeeUserId,
  });
};
