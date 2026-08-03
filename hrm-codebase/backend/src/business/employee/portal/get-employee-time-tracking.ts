import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { can } from "../../../helpers/permissions.js";
import { resolveEmployeeCompensationModel } from "../employees/employee-shared.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import {
  setActiveEmployeeTimeTrackingSpanAttributes,
  setEmployeeTimeTrackingTraceOutcome,
  withEmployeeTimeTrackingSpan,
} from "../time-tracking/employee-time-tracking-observability.js";
import {
  EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS,
  type EmployeeTimeTrackingCurrentStatus,
} from "../time-tracking/employee-time-tracking-tracing-contract.js";

const ERRORS = {
  forbidden: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/me/time-tracking/forbidden",
    message: "Employee time tracking is not available for this account",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/me/time-tracking/invalid-request",
    message: "Invalid time tracking request",
  },
};

const querySchema = z.object({
  workDate: z.string().refine(isValidWorkDate),
});

export const getEmployeeTimeTracking = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  setActiveEmployeeTimeTrackingSpanAttributes({
    ...(authContext.storeId !== undefined && { "app.store_id": authContext.storeId }),
  });

  if (!can(authContext.role, "employeePortal:use") || authContext.role !== "employee") {
    setEmployeeTimeTrackingTraceOutcome(res, "forbidden_role");
    return createErrorResponse(res, ERRORS.forbidden, { role: authContext.role });
  }

  const parsedQuery = querySchema.safeParse(req.query);
  if (!parsedQuery.success || !authContext.storeId) {
    setEmployeeTimeTrackingTraceOutcome(res, "invalid_payload");
    return createErrorResponse(res, ERRORS.invalidRequest, {
      validation: parsedQuery.success ? undefined : parsedQuery.error.flatten().fieldErrors,
    });
  }
  const storeId = authContext.storeId;

  const employee = await withEmployeeTimeTrackingSpan(
    EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.scopeResolve,
    {
      "app.store_id": storeId,
      "time_tracking.scope": "self",
    },
    () =>
      firestoreRepository.user.getUser(authContext.uid).catch((error: unknown) => {
        if (error instanceof FirestoreDataNotFoundError) return null;
        throw error;
      }),
  );
  const employeeCompensationModel =
    employee?.role === "employee" ? resolveEmployeeCompensationModel(employee) : undefined;

  if (
    !employee ||
    employee.role !== "employee" ||
    !employee.active ||
    employee.ownerId !== authContext.ownerId ||
    employee.storeId !== storeId
  ) {
    setEmployeeTimeTrackingTraceOutcome(res, "employee_out_of_scope");
    return createErrorResponse(res, ERRORS.forbidden, {
      reason: "only active hourly employees can use time tracking",
    });
  }

  if (employeeCompensationModel !== "hourly") {
    setEmployeeTimeTrackingTraceOutcome(res, "non_hourly_employee");
    return createErrorResponse(res, ERRORS.forbidden, {
      reason: "only active hourly employees can use time tracking",
    });
  }

  const { session, pendingCheckoutSessions } = await withEmployeeTimeTrackingSpan(
    EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.contextLoad,
    {
      "app.store_id": storeId,
      "time_tracking.action": "read",
      "time_tracking.work_date": parsedQuery.data.workDate,
    },
    () =>
      Promise.all([
        firestoreRepository.shop.timeTracking.getEmployeeTimeTracking(
          authContext.ownerId,
          storeId,
          authContext.uid,
          parsedQuery.data.workDate,
        ),
        firestoreRepository.shop.timeTracking.listOpenEmployeeTimeTracking(
          authContext.ownerId,
          storeId,
          authContext.uid,
          parsedQuery.data.workDate,
        ),
      ]).then(([session, pendingCheckoutSessions]) => ({
        session,
        pendingCheckoutSessions,
      })),
  );
  const currentStatus: EmployeeTimeTrackingCurrentStatus = session?.status ?? "missing";
  setActiveEmployeeTimeTrackingSpanAttributes({
    "time_tracking.compensation_model": "hourly",
    "time_tracking.current_status": currentStatus,
    "time_tracking.pending_checkout_count": pendingCheckoutSessions.length,
    "time_tracking.pending_checkout_present": pendingCheckoutSessions.length > 0,
  });

  return res.status(StatusCodes.OK).json({
    session,
    pendingCheckoutSession: pendingCheckoutSessions[0] ?? null,
  });
};
