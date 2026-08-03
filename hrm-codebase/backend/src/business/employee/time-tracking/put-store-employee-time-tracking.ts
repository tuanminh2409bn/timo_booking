import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
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
} from "./employee-time-tracking-observability.js";
import {
  EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS,
  getEmployeeTimeTrackingDurationBucket,
  type EmployeeTimeTrackingCurrentStatus,
} from "./employee-time-tracking-tracing-contract.js";

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
  conflict: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/employee-time-tracking/conflict",
    message: "Time tracking state does not allow this action",
  },
};

const bodySchema = z.object({
  action: z.enum(["check_in", "check_out"]),
  workDate: z.string().refine(isValidWorkDate),
  checkedOutAt: z.number().int().positive().optional(),
});

export const updateStoreEmployeeTimeTracking = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (!can(authContext.role, "employeeTimeTracking:manage")) {
    setEmployeeTimeTrackingTraceOutcome(res, "forbidden_role");
    return createErrorResponse(res, ERRORS.forbidden, { role: authContext.role });
  }

  const parsedBody = bodySchema.safeParse(req.body);
  const storeId = String(req.params["storeId"] ?? "").trim();
  const employeeUserId = String(req.params["employeeUserId"] ?? "").trim();

  if (!parsedBody.success || !storeId || !employeeUserId) {
    setEmployeeTimeTrackingTraceOutcome(
      res,
      parsedBody.success ? "forbidden_store" : "invalid_payload",
    );
    return createErrorResponse(res, parsedBody.success ? ERRORS.forbidden : ERRORS.invalidRequest, {
      validation: parsedBody.success ? undefined : parsedBody.error.flatten().fieldErrors,
      storeId,
      employeeUserId,
    });
  }

  const scopeResolution = await withEmployeeTimeTrackingSpan(
    EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.scopeResolve,
    {
      "app.store_id": storeId,
      "time_tracking.scope": "store",
      "time_tracking.action": parsedBody.data.action,
      "time_tracking.work_date": parsedBody.data.workDate,
    },
    async () => {
      if (!canAccessStore(authContext, storeId)) {
        return { storeAccessible: false as const, employee: null };
      }

      const employee = await firestoreRepository.user
        .getUser(employeeUserId)
        .catch((error: unknown) => {
          if (error instanceof FirestoreDataNotFoundError) return null;
          throw error;
        });

      return { storeAccessible: true as const, employee };
    },
  );

  if (!scopeResolution.storeAccessible) {
    setEmployeeTimeTrackingTraceOutcome(res, "forbidden_store");
    return createErrorResponse(res, ERRORS.forbidden, {
      storeId,
      employeeUserId,
    });
  }

  const employee = scopeResolution.employee;
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
      reason: "target is not an active hourly employee",
    });
  }

  const { action, workDate, checkedOutAt: requestedCheckedOutAt } = parsedBody.data;
  const { existing, pendingSessions } = await withEmployeeTimeTrackingSpan(
    EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.contextLoad,
    {
      "app.store_id": storeId,
      "time_tracking.action": action,
      "time_tracking.work_date": workDate,
    },
    async () => {
      const existing = await firestoreRepository.shop.timeTracking.getEmployeeTimeTracking(
        authContext.ownerId,
        storeId,
        employeeUserId,
        workDate,
      );
      const pendingSessions =
        action === "check_in"
          ? await firestoreRepository.shop.timeTracking.listOpenEmployeeTimeTracking(
              authContext.ownerId,
              storeId,
              employeeUserId,
              workDate,
            )
          : [];

      return { existing, pendingSessions };
    },
  );
  const now = Date.now();
  const currentStatus: EmployeeTimeTrackingCurrentStatus = existing?.status ?? "missing";
  setActiveEmployeeTimeTrackingSpanAttributes({
    "time_tracking.compensation_model": "hourly",
    "time_tracking.current_status": currentStatus,
    "time_tracking.status.before": currentStatus,
    "time_tracking.manual_checkout": requestedCheckedOutAt !== undefined,
  });

  if (action === "check_in") {
    setActiveEmployeeTimeTrackingSpanAttributes({
      "time_tracking.pending_checkout_count": pendingSessions.length,
      "time_tracking.pending_checkout_present": pendingSessions.length > 0,
    });
    recordEmployeeTimeTrackingTransitionOutcome(res, {
      action: "check_in",
      currentStatus,
      pendingCheckoutPresent: pendingSessions.length > 0,
    });

    if (pendingSessions.length > 0) {
      return createErrorResponse(res, ERRORS.conflict, {
        reason: "previous work day requires checkout",
        pendingWorkDate: pendingSessions[0]?.workDate,
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
        { storeId, workDate, employeeUserId, status: "working", checkedInAt: now },
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
        "time_tracking.work_date": workDate,
      },
      () =>
        writeShopAuditLog({
          ownerId: authContext.ownerId,
          eventType: "employee_time_tracking_started",
          entityType: "employee_time_tracking",
          entityId: session.id,
          storeId,
          workDate,
          actor: { uid: authContext.uid, role: authContext.role },
          metadata: { employeeUserId, checkedInAt: now },
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

  const checkedOutAt = requestedCheckedOutAt ?? now;
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
        workDate,
        employeeUserId,
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
      "time_tracking.work_date": workDate,
    },
    () =>
      writeShopAuditLog({
        ownerId: authContext.ownerId,
        eventType: "employee_time_tracking_completed",
        entityType: "employee_time_tracking",
        entityId: session.id,
        storeId,
        workDate,
        actor: { uid: authContext.uid, role: authContext.role },
        metadata: {
          employeeUserId,
          checkedInAt: existing.checkedInAt,
          checkedOutAt,
          workedMinutes,
        },
      }),
  );

  return res.status(StatusCodes.OK).json({ session });
};
