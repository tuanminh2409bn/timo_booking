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
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import {
  observeEmployeeTimeTrackingAuditWrite,
  observeEmployeeTimeTrackingSessionUpsert,
  recordEmployeeTimeTrackingTransitionOutcome,
  setActiveEmployeeTimeTrackingSpanAttributes,
  setEmployeeTimeTrackingTraceOutcome,
  withEmployeeTimeTrackingSpan,
} from "../time-tracking/employee-time-tracking-observability.js";
import {
  EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS,
  getEmployeeTimeTrackingDurationBucket,
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
  conflict: {
    statusCode: StatusCodes.CONFLICT,
    type: "/me/time-tracking/conflict",
    message: "Time tracking state does not allow this action",
  },
};

const bodySchema = z.object({
  action: z.enum(["check_in", "check_out"]),
  workDate: z.string().refine(isValidWorkDate),
  checkedOutAt: z.number().int().positive().optional(),
});

export const updateEmployeeTimeTracking = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  setActiveEmployeeTimeTrackingSpanAttributes({
    ...(authContext.storeId !== undefined && { "app.store_id": authContext.storeId }),
  });

  if (!can(authContext.role, "employeePortal:use") || authContext.role !== "employee") {
    setEmployeeTimeTrackingTraceOutcome(res, "forbidden_role");
    return createErrorResponse(res, ERRORS.forbidden, { role: authContext.role });
  }

  const parsedBody = bodySchema.safeParse(req.body);
  if (!parsedBody.success || !authContext.storeId) {
    setEmployeeTimeTrackingTraceOutcome(res, "invalid_payload");
    return createErrorResponse(res, ERRORS.invalidRequest, {
      validation: parsedBody.success ? undefined : parsedBody.error.flatten().fieldErrors,
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
  const employeeIsOutOfScope =
    !employee ||
    employee.role !== "employee" ||
    !employee.active ||
    employee.ownerId !== authContext.ownerId ||
    employee.storeId !== storeId;

  if (employeeIsOutOfScope || employeeCompensationModel !== "hourly") {
    if (employeeIsOutOfScope) {
      setEmployeeTimeTrackingTraceOutcome(res, "employee_out_of_scope");
    } else {
      setEmployeeTimeTrackingTraceOutcome(res, "non_hourly_employee");
    }

    return createErrorResponse(res, ERRORS.forbidden, {
      reason: "only active hourly employees can use time tracking",
    });
  }

  const { existing, pendingCheckoutSessions } = await withEmployeeTimeTrackingSpan(
    EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.contextLoad,
    {
      "app.store_id": storeId,
      "time_tracking.action": parsedBody.data.action,
      "time_tracking.work_date": parsedBody.data.workDate,
    },
    async () => {
      const existing = await firestoreRepository.shop.timeTracking.getEmployeeTimeTracking(
        authContext.ownerId,
        storeId,
        authContext.uid,
        parsedBody.data.workDate,
      );
      const pendingCheckoutSessions =
        parsedBody.data.action === "check_in"
          ? await firestoreRepository.shop.timeTracking.listOpenEmployeeTimeTracking(
              authContext.ownerId,
              storeId,
              authContext.uid,
              parsedBody.data.workDate,
            )
          : [];

      return { existing, pendingCheckoutSessions };
    },
  );
  const now = Date.now();
  const currentStatus: EmployeeTimeTrackingCurrentStatus = existing?.status ?? "missing";
  setActiveEmployeeTimeTrackingSpanAttributes({
    "time_tracking.compensation_model": "hourly",
    "time_tracking.current_status": currentStatus,
    "time_tracking.status.before": currentStatus,
    "time_tracking.manual_checkout": parsedBody.data.checkedOutAt !== undefined,
  });

  if (parsedBody.data.action === "check_in") {
    setActiveEmployeeTimeTrackingSpanAttributes({
      "time_tracking.pending_checkout_count": pendingCheckoutSessions.length,
      "time_tracking.pending_checkout_present": pendingCheckoutSessions.length > 0,
    });
    recordEmployeeTimeTrackingTransitionOutcome(res, {
      action: "check_in",
      currentStatus,
      pendingCheckoutPresent: pendingCheckoutSessions.length > 0,
    });

    if (pendingCheckoutSessions.length > 0) {
      return createErrorResponse(res, ERRORS.conflict, {
        reason: "previous work day requires checkout",
        pendingWorkDate: pendingCheckoutSessions[0]?.workDate,
      });
    }

    if (existing) {
      return createErrorResponse(res, ERRORS.conflict, {
        reason: existing.status === "working" ? "already checked in" : "work day already completed",
      });
    }

    const session = await observeEmployeeTimeTrackingSessionUpsert(res, (onCommitted) =>
      firestoreRepository.shop.timeTracking.upsertEmployeeTimeTracking(
        authContext.ownerId,
        {
          storeId,
          workDate: parsedBody.data.workDate,
          employeeUserId: authContext.uid,
          status: "working",
          checkedInAt: now,
        },
        { onCommitted },
      ),
    );
    setActiveEmployeeTimeTrackingSpanAttributes({
      "time_tracking.status.after": "working",
      "time_tracking.persist_action": "create",
    });

    await observeEmployeeTimeTrackingAuditWrite(
      res,
      {
        "app.store_id": storeId,
        "time_tracking.action": "check_in",
        "time_tracking.work_date": parsedBody.data.workDate,
      },
      () =>
        writeShopAuditLog({
          ownerId: authContext.ownerId,
          eventType: "employee_time_tracking_started",
          entityType: "employee_time_tracking",
          entityId: session.id,
          storeId,
          workDate: parsedBody.data.workDate,
          actor: { uid: authContext.uid, role: authContext.role },
          metadata: { checkedInAt: now },
        }),
    );

    return res.status(StatusCodes.OK).json({ session });
  }

  setActiveEmployeeTimeTrackingSpanAttributes({
    "time_tracking.pending_checkout_count": 0,
    "time_tracking.pending_checkout_present": false,
  });

  if (!existing || existing.status !== "working") {
    recordEmployeeTimeTrackingTransitionOutcome(res, {
      action: "check_out",
      currentStatus,
    });
    return createErrorResponse(res, ERRORS.conflict, { reason: "employee is not checked in" });
  }

  const checkedOutAt = parsedBody.data.checkedOutAt ?? now;

  if (checkedOutAt < existing.checkedInAt || checkedOutAt > now) {
    recordEmployeeTimeTrackingTransitionOutcome(res, {
      action: "check_out",
      currentStatus,
      checkoutTimeValid: false,
    });
    return createErrorResponse(res, ERRORS.invalidRequest, {
      reason: "checkedOutAt must be between checkedInAt and the current time",
      checkedInAt: existing.checkedInAt,
      checkedOutAt,
    });
  }

  const workedMinutes = Math.max(0, Math.round((checkedOutAt - existing.checkedInAt) / 60_000));
  const session = await observeEmployeeTimeTrackingSessionUpsert(res, (onCommitted) =>
    firestoreRepository.shop.timeTracking.upsertEmployeeTimeTracking(
      authContext.ownerId,
      {
        storeId,
        workDate: parsedBody.data.workDate,
        employeeUserId: authContext.uid,
        status: "completed",
        checkedInAt: existing.checkedInAt,
        checkedOutAt,
        workedMinutes,
      },
      { onCommitted },
    ),
  );
  setActiveEmployeeTimeTrackingSpanAttributes({
    "time_tracking.status.after": "completed",
    "time_tracking.persist_action": "update",
    "time_tracking.duration_bucket": getEmployeeTimeTrackingDurationBucket(workedMinutes),
  });

  await observeEmployeeTimeTrackingAuditWrite(
    res,
    {
      "app.store_id": storeId,
      "time_tracking.action": "check_out",
      "time_tracking.work_date": parsedBody.data.workDate,
    },
    () =>
      writeShopAuditLog({
        ownerId: authContext.ownerId,
        eventType: "employee_time_tracking_completed",
        entityType: "employee_time_tracking",
        entityId: session.id,
        storeId,
        workDate: parsedBody.data.workDate,
        actor: { uid: authContext.uid, role: authContext.role },
        metadata: { checkedInAt: existing.checkedInAt, checkedOutAt, workedMinutes },
      }),
  );

  return res.status(StatusCodes.OK).json({ session });
};
