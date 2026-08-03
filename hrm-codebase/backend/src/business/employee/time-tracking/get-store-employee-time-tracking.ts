import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { resolveEmployeeCompensationModel } from "../employees/employee-shared.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import {
  setActiveEmployeeTimeTrackingSpanAttributes,
  setEmployeeTimeTrackingTraceOutcome,
  withEmployeeTimeTrackingSpan,
} from "./employee-time-tracking-observability.js";
import { EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS } from "./employee-time-tracking-tracing-contract.js";

const ERRORS = {
  forbidden: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/employee-time-tracking/forbidden",
    message: "Forbidden: employee time tracking access denied",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/employee-time-tracking/invalid-request",
    message: "Invalid employee time tracking request",
  },
};

const querySchema = z.object({
  workDate: z.string().refine(isValidWorkDate),
});

export const getStoreEmployeeTimeTracking = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (!can(authContext.role, "employeeTimeTracking:manage")) {
    setEmployeeTimeTrackingTraceOutcome(res, "forbidden_role");
    return createErrorResponse(res, ERRORS.forbidden, { role: authContext.role });
  }

  const parsedQuery = querySchema.safeParse(req.query);
  const storeId = String(req.params["storeId"] ?? "").trim();

  if (!parsedQuery.success || !storeId || !canAccessStore(authContext, storeId)) {
    setEmployeeTimeTrackingTraceOutcome(
      res,
      parsedQuery.success ? "forbidden_store" : "invalid_payload",
    );
    return createErrorResponse(
      res,
      parsedQuery.success ? ERRORS.forbidden : ERRORS.invalidRequest,
      {
        validation: parsedQuery.success ? undefined : parsedQuery.error.flatten().fieldErrors,
        storeId,
      },
    );
  }

  const employees = await withEmployeeTimeTrackingSpan(
    EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.rosterLoad,
    {
      "app.store_id": storeId,
      "time_tracking.work_date": parsedQuery.data.workDate,
    },
    () =>
      firestoreRepository.user.listShopEmployees(authContext.ownerId, {
        storeId,
        active: true,
      }),
  );
  const hourlyEmployees = employees.filter(
    (employee) =>
      employee.role === "employee" && resolveEmployeeCompensationModel(employee) === "hourly",
  );
  setActiveEmployeeTimeTrackingSpanAttributes({
    "time_tracking.roster_employee_count": employees.length,
    "time_tracking.hourly_employee_count": hourlyEmployees.length,
  });

  const items = await withEmployeeTimeTrackingSpan(
    EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.rosterSessionsLoad,
    {
      "app.store_id": storeId,
      "time_tracking.work_date": parsedQuery.data.workDate,
      "time_tracking.hourly_employee_count": hourlyEmployees.length,
      "time_tracking.roster_session_read_count": hourlyEmployees.length * 2,
    },
    () =>
      Promise.all(
        hourlyEmployees.map(async (employee) => {
          const [session, pendingSessions] = await Promise.all([
            firestoreRepository.shop.timeTracking.getEmployeeTimeTracking(
              authContext.ownerId,
              storeId,
              employee.uid,
              parsedQuery.data.workDate,
            ),
            firestoreRepository.shop.timeTracking.listOpenEmployeeTimeTracking(
              authContext.ownerId,
              storeId,
              employee.uid,
              parsedQuery.data.workDate,
            ),
          ]);
          const pending = pendingSessions[0];
          const trackedSession = pending ?? session;

          return {
            employeeUserId: employee.uid,
            employeeName: employee.displayName ?? employee.name ?? employee.email,
            position: employee.position ?? "Nhân viên",
            compensationModel: "hourly" as const,
            workDate: parsedQuery.data.workDate,
            status: pending
              ? ("needs_checkout" as const)
              : (session?.status ?? ("not_started" as const)),
            ...(trackedSession?.checkedInAt !== undefined && {
              checkedInAt: trackedSession.checkedInAt,
            }),
            ...(trackedSession?.checkedOutAt !== undefined && {
              checkedOutAt: trackedSession.checkedOutAt,
            }),
            ...(trackedSession?.workedMinutes !== undefined && {
              workedMinutes: trackedSession.workedMinutes,
            }),
            ...(pending?.workDate !== undefined && { pendingCheckoutWorkDate: pending.workDate }),
          };
        }),
      ),
  );

  const stateCounts = {
    notStarted: 0,
    working: 0,
    completed: 0,
    needsCheckout: 0,
  };
  for (const item of items) {
    if (item.status === "not_started") stateCounts.notStarted += 1;
    if (item.status === "working") stateCounts.working += 1;
    if (item.status === "completed") stateCounts.completed += 1;
    if (item.status === "needs_checkout") stateCounts.needsCheckout += 1;
  }
  setActiveEmployeeTimeTrackingSpanAttributes({
    "time_tracking.not_started_count": stateCounts.notStarted,
    "time_tracking.working_count": stateCounts.working,
    "time_tracking.completed_count": stateCounts.completed,
    "time_tracking.needs_checkout_count": stateCounts.needsCheckout,
  });

  return res.status(StatusCodes.OK).json({
    items: items.sort((left, right) => left.employeeName.localeCompare(right.employeeName, "vi")),
    meta: { storeId, workDate: parsedQuery.data.workDate },
  });
};
