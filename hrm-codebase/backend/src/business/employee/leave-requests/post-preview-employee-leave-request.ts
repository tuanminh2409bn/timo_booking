import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { can } from "../../../helpers/permissions.js";
import { getStoreIdFromUrlPath, mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { leaveOverlapsAttendance, leaveRequestSchema } from "./leave-request-shared.js";

const SERVICE_ERRORS = {
  forbiddenRole: { statusCode: StatusCodes.FORBIDDEN, type: "/stores/employees/leave-requests/forbidden-role", message: "Forbidden: insufficient permissions" },
  forbiddenStore: { statusCode: StatusCodes.FORBIDDEN, type: "/stores/employees/leave-requests/forbidden-store", message: "Forbidden: store access denied" },
  invalidRequest: { statusCode: StatusCodes.BAD_REQUEST, type: "/stores/employees/leave-requests/invalid-request", message: "Invalid request" },
  employeeNotFound: { statusCode: StatusCodes.NOT_FOUND, type: "/stores/employees/leave-requests/employee-not-found", message: "Employee not found" },
};

export const previewEmployeeLeaveRequest = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const employeeUserId = req.params["employeeUserId"];
  if (!can(authContext.role, "leave:manage")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }
  if (typeof employeeUserId !== "string" || !employeeUserId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, { reason: "missing employeeUserId" });
  }

  const employee = await firestoreRepository.user.getUser(employeeUserId).catch((error: unknown) => {
    if (error instanceof FirestoreDataNotFoundError) return undefined;
    throw error;
  });
  if (!employee || employee.ownerId !== authContext.ownerId || employee.role !== "employee") {
    return createErrorResponse(res, SERVICE_ERRORS.employeeNotFound, { employeeUserId });
  }
  const routeStoreId = getStoreIdFromUrlPath(req);
  if (routeStoreId !== undefined && routeStoreId !== employee.storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, { routeStoreId, employeeStoreId: employee.storeId });
  }

  const parsed = leaveRequestSchema.safeParse(mergeUrlPathStoreId(req, req.body));
  if (!parsed.success || parsed.data.startDate > parsed.data.endDate) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      ...(parsed.success ? { reason: "startDate after endDate" } : { validation: parsed.error.flatten().fieldErrors }),
    });
  }
  if (parsed.data.storeId !== employee.storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, { payloadStoreId: parsed.data.storeId, employeeStoreId: employee.storeId });
  }

  const attendances = await firestoreRepository.shop.attendance.listShopAttendanceByEmployeeDateRange(
    authContext.ownerId,
    employee.storeId,
    employee.uid,
    parsed.data.startDate,
    parsed.data.endDate,
  );
  const conflicts = attendances
    .filter((attendance) => attendance.bookingStatus !== "cancelled" && attendance.bookingStatus !== "no_show")
    .filter((attendance) => leaveOverlapsAttendance(parsed.data, attendance.workDate, attendance.startTime, attendance.endTime))
    .map((attendance) => ({
      attendanceId: attendance.id,
      ...(attendance.attendanceCode !== undefined && { attendanceCode: attendance.attendanceCode }),
      ...(attendance.bookingId !== undefined && { bookingId: attendance.bookingId }),
      workDate: attendance.workDate,
      startTime: attendance.startTime,
      endTime: attendance.endTime,
      customerName: attendance.customerName,
      services: attendance.services.map((service) => service.name),
      staffSelectionType: attendance.staffSelectionType ?? "specific",
      // Existing appointments must stay with their original employee. Leave
      // conflicts are highlighted for the owner instead of being silently
      // moved to another employee or to the Request column.
      resolution: "manual_action" as const,
    }));

  return res.status(StatusCodes.OK).json({
    conflictCount: conflicts.length,
    automaticCount: 0,
    manualCount: conflicts.filter((item) => item.resolution === "manual_action").length,
    conflicts,
  });
};
