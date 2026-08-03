import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  FirestoreDataExistingError,
  FirestoreDataNotFoundError,
} from "../../../constants/firestore-error.js";
import { can } from "../../../helpers/permissions.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import {
  getIncompleteAttendanceIds,
  getResponsibleEmployeeUserIdsForAttendance,
  isSettlementAttendance,
} from "../../../helpers/work-day-settlement.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import type { ShopEmployeeWorkDayClosingType } from "../../../repository/firestore/shop/shop.types.js";
import { normalizeAttendanceForResponse } from "../domain/attendance-presentation.js";
import { resolveEmployeeCompensationModel } from "../employees/employee-shared.js";
import {
  getEmployeeClosingTraceStatus,
  getEmployeeTimeTrackingTraceStatus,
  markWorkDaySettlementPostWriteFailure,
  observeWorkDaySettlementCommit,
  setActiveWorkDaySettlementSpanAttributes,
  setWorkDaySettlementTraceOutcome,
  withWorkDaySettlementSpan,
} from "../work-days/work-day-settlement-observability.js";
import { WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS } from "../work-days/work-day-settlement-tracing-contract.js";

const EMPLOYEE_WORK_DAY_CLOSING_ERRORS = {
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/me/work-day-closings/forbidden-role",
    message: "Forbidden: employee close-day is not available for this role",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/me/work-day-closings/invalid-request",
    message: "Invalid request",
  },
  workDayAlreadyClosed: {
    statusCode: StatusCodes.CONFLICT,
    type: "/me/work-day-closings/work-day-already-closed",
    message: "The selected store work day has already been closed",
  },
  attendanceIncomplete: {
    statusCode: StatusCodes.CONFLICT,
    type: "/me/work-day-closings/attendance-incomplete",
    message: "Some attendance entries are missing services, assignees, or full allocation",
  },
  noAttendance: {
    statusCode: StatusCodes.CONFLICT,
    type: "/me/work-day-closings/no-attendance",
    message: "There are no attendance entries for the selected work day",
  },
  timeTrackingRequired: {
    statusCode: StatusCodes.CONFLICT,
    type: "/me/work-day-closings/time-tracking-required",
    message: "Employee must check in before closing the work day",
  },
  checkoutRequired: {
    statusCode: StatusCodes.CONFLICT,
    type: "/me/work-day-closings/checkout-required",
    message: "Employee must check out before closing the work day",
  },
} as const;

const resolveWorkDateFromInput = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !isValidWorkDate(value)) {
    return undefined;
  }

  return value;
};

const getInvalidAttendanceIds = (
  attendances: ReturnType<typeof normalizeAttendanceForResponse>[],
): string[] => {
  const invalidAttendanceIds = new Set(getIncompleteAttendanceIds(attendances));

  attendances.forEach((attendance) => {
    if (attendance.services.length === 0) {
      invalidAttendanceIds.add(attendance.id);
    }
  });

  return Array.from(invalidAttendanceIds);
};

export const closeEmployeeWorkDay = async (req: Request, res: Response) => {
  const timing = new ServerTiming();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(req.headers["authorization"]),
  );

  if (!can(authContext.role, "employeeWorkDay:close") || !authContext.storeId) {
    return createErrorResponse(res, EMPLOYEE_WORK_DAY_CLOSING_ERRORS.forbiddenRole, {
      role: authContext.role,
    });
  }

  const storeId = authContext.storeId;
  setActiveWorkDaySettlementSpanAttributes({ "app.store_id": storeId });

  const workDate = resolveWorkDateFromInput(req.body?.workDate ?? req.body?.date);

  if (!workDate) {
    return createErrorResponse(res, EMPLOYEE_WORK_DAY_CLOSING_ERRORS.invalidRequest, {
      reason: "workDate must use YYYY-MM-DD format",
    });
  }

  setActiveWorkDaySettlementSpanAttributes({ "settlement.work_date": workDate });
  // Scope check bằng document của chính caller (direct doc get + cache) thay vì tải danh sách
  // nhân viên của store; attendance query đã scope theo employee (array-contains assigneeUserIds).
  const [
    employeeResult,
    existingSettlement,
    employeeWorkDayClosing,
    attendances,
    timeTrackingSession,
  ] = await withWorkDaySettlementSpan(
    WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.contextLoad,
    {
      "app.store_id": storeId,
      "settlement.work_date": workDate,
    },
    async () =>
      timing.measure("query", () =>
        Promise.all([
          firestoreRepository.user.getUser(authContext.uid).catch((error: unknown) => {
            if (error instanceof FirestoreDataNotFoundError) return null;
            throw error;
          }),
          firestoreRepository.shop.settlement.getWorkDaySettlement(
            authContext.ownerId,
            storeId,
            workDate,
          ),
          firestoreRepository.shop.session.getEmployeeWorkDayClosing(
            authContext.ownerId,
            storeId,
            workDate,
            authContext.uid,
          ),
          firestoreRepository.shop.attendance.listShopAttendanceByEmployeeDateRange(
            authContext.ownerId,
            storeId,
            authContext.uid,
            workDate,
            workDate,
          ),
          firestoreRepository.shop.timeTracking.getEmployeeTimeTracking(
            authContext.ownerId,
            storeId,
            authContext.uid,
            workDate,
          ),
        ]),
      ),
  );

  const employeeCompensationModel = employeeResult
    ? resolveEmployeeCompensationModel({
        compensationModel:
          "compensationModel" in employeeResult ? employeeResult.compensationModel : undefined,
        hourlyRate: "hourlyRate" in employeeResult ? employeeResult.hourlyRate : undefined,
      })
    : undefined;

  setActiveWorkDaySettlementSpanAttributes({
    "settlement.existing_status": existingSettlement?.status ?? "missing",
    "settlement.aggregate_present": Boolean(existingSettlement),
    "settlement.attendance_count": attendances.length,
    "settlement.employee_compensation_model": employeeCompensationModel,
    ...(employeeCompensationModel !== undefined && {
      "settlement.time_tracking_status": getEmployeeTimeTrackingTraceStatus(
        employeeCompensationModel,
        timeTrackingSession,
      ),
    }),
  });

  const employeeInScope =
    employeeResult !== null &&
    employeeResult.active &&
    employeeResult.ownerId === authContext.ownerId &&
    "storeId" in employeeResult &&
    employeeResult.storeId === storeId;

  if (!employeeInScope) {
    setWorkDaySettlementTraceOutcome(res, "employee_out_of_scope");
    return createErrorResponse(res, EMPLOYEE_WORK_DAY_CLOSING_ERRORS.forbiddenRole, {
      reason: "employee is not active in the authenticated store",
      storeId,
    });
  }

  if (employeeCompensationModel === "hourly") {
    if (!timeTrackingSession) {
      return createErrorResponse(res, EMPLOYEE_WORK_DAY_CLOSING_ERRORS.timeTrackingRequired, {
        storeId,
        workDate,
      });
    }

    if (timeTrackingSession.status === "working") {
      return createErrorResponse(res, EMPLOYEE_WORK_DAY_CLOSING_ERRORS.checkoutRequired, {
        storeId,
        workDate,
        checkedInAt: timeTrackingSession.checkedInAt,
      });
    }
  }

  if (existingSettlement?.status === "closed") {
    return createErrorResponse(res, EMPLOYEE_WORK_DAY_CLOSING_ERRORS.workDayAlreadyClosed, {
      storeId,
      workDate,
    });
  }

  const employeeAttendances = attendances
    .filter(
      (attendance) =>
        isSettlementAttendance(attendance) &&
        getResponsibleEmployeeUserIdsForAttendance(attendance).includes(authContext.uid),
    )
    .map(normalizeAttendanceForResponse);

  setActiveWorkDaySettlementSpanAttributes({
    "settlement.eligible_attendance_count": employeeAttendances.length,
  });

  if (employeeAttendances.length === 0) {
    return createErrorResponse(res, EMPLOYEE_WORK_DAY_CLOSING_ERRORS.noAttendance, {
      storeId,
      workDate,
    });
  }

  const invalidAttendanceIds = getInvalidAttendanceIds(employeeAttendances);

  setActiveWorkDaySettlementSpanAttributes({
    "settlement.incomplete_attendance_count": invalidAttendanceIds.length,
  });

  if (invalidAttendanceIds.length > 0) {
    res.locals["requestError"] = {
      statusCode: EMPLOYEE_WORK_DAY_CLOSING_ERRORS.attendanceIncomplete.statusCode,
      errorType: EMPLOYEE_WORK_DAY_CLOSING_ERRORS.attendanceIncomplete.type,
      errorName: "ServiceError",
      errorMessage: EMPLOYEE_WORK_DAY_CLOSING_ERRORS.attendanceIncomplete.message,
      errorSource: "logic",
      errorScope: "domain",
      errorContext: { storeId, workDate, invalidAttendanceIds },
    };
    return res.status(EMPLOYEE_WORK_DAY_CLOSING_ERRORS.attendanceIncomplete.statusCode).json({
      type: EMPLOYEE_WORK_DAY_CLOSING_ERRORS.attendanceIncomplete.type,
      message: EMPLOYEE_WORK_DAY_CLOSING_ERRORS.attendanceIncomplete.message,
      invalidAttendanceIds,
    });
  }

  const attendanceIds = employeeAttendances.map((attendance) => attendance.id).sort();
  const attendanceVersions = Object.fromEntries(
    employeeAttendances.map((attendance) => [attendance.id, attendance.updatedAt]),
  );
  const employeeClosingStatus = getEmployeeClosingTraceStatus(
    employeeWorkDayClosing,
    attendanceIds,
    attendanceVersions,
  );
  const hasCurrentEmployeeWorkDayClosing = employeeClosingStatus === "current";
  const isEmployeeMarkedOnSettlement = Boolean(
    existingSettlement?.preview.submittedEmployeeUserIds?.includes(authContext.uid),
  );
  const aggregateMarkRequired = !isEmployeeMarkedOnSettlement;

  setActiveWorkDaySettlementSpanAttributes({
    "settlement.employee_closing_status": employeeClosingStatus,
    "settlement.employee_closing_snapshot_changed": employeeClosingStatus === "stale",
    "settlement.idempotent_replay": hasCurrentEmployeeWorkDayClosing,
    "settlement.aggregate_mark_required": aggregateMarkRequired,
  });

  const closedAt =
    hasCurrentEmployeeWorkDayClosing && employeeWorkDayClosing
      ? employeeWorkDayClosing.closedAt
      : Date.now();

  let employeeClosingIsDurable = hasCurrentEmployeeWorkDayClosing;
  const onSettlementCommit = (commit: Parameters<typeof observeWorkDaySettlementCommit>[0]) => {
    if (commit.stage === "employee_closing") {
      employeeClosingIsDurable = true;
    }

    observeWorkDaySettlementCommit(commit);
  };

  let closing: ShopEmployeeWorkDayClosingType;
  let closingPersistedByRequest = false;

  if (hasCurrentEmployeeWorkDayClosing && employeeWorkDayClosing) {
    closing = employeeWorkDayClosing;
  } else {
    try {
      closing = await timing.measure("write_closing", () =>
        firestoreRepository.shop.session.closeEmployeeWorkDay(
          authContext.ownerId,
          {
            storeId,
            workDate,
            employeeUserId: authContext.uid,
            attendanceIds,
            attendanceVersions,
            closedAt,
            closedByUserId: authContext.uid,
          },
          {
            onCommitted: onSettlementCommit,
            persistAction: employeeClosingStatus === "missing" ? "create" : "overwrite",
          },
        ),
      );
      closingPersistedByRequest = true;
    } catch (error) {
      if (error instanceof FirestoreDataExistingError && employeeClosingStatus === "missing") {
        const concurrentClosing = await firestoreRepository.shop.session.getEmployeeWorkDayClosing(
          authContext.ownerId,
          storeId,
          workDate,
          authContext.uid,
        );
        const concurrentClosingStatus = getEmployeeClosingTraceStatus(
          concurrentClosing,
          attendanceIds,
          attendanceVersions,
        );

        if (concurrentClosingStatus === "current" && concurrentClosing !== null) {
          closing = concurrentClosing;
          employeeClosingIsDurable = true;
          setActiveWorkDaySettlementSpanAttributes({
            "settlement.idempotent_replay": true,
            "settlement.employee_closing_status": "current",
          });
        } else {
          throw error;
        }
      } else {
        if (employeeClosingIsDurable) {
          markWorkDaySettlementPostWriteFailure(res, "cache_invalidation");
        }

        throw error;
      }
    }
  }

  if (closingPersistedByRequest) {
    try {
      await withWorkDaySettlementSpan(
        WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.auditWrite,
        {
          "app.store_id": storeId,
          "settlement.work_date": workDate,
        },
        async () =>
          writeShopAuditLog({
            ownerId: authContext.ownerId,
            eventType: "employee_work_day_closed",
            entityType: "work_day",
            entityId: closing.id,
            storeId,
            workDate,
            actor: {
              uid: authContext.uid,
              role: authContext.role,
            },
            metadata: {
              closeScope: "employee_work_day",
              attendanceCount: employeeAttendances.length,
              closedAt,
            },
          }),
      );
    } catch (error) {
      if (employeeClosingIsDurable) {
        markWorkDaySettlementPostWriteFailure(res, "audit");
      }

      throw error;
    }
  }

  // Bỏ qua transaction đánh dấu khi replay idempotent và settlement đã ghi nhận employee này;
  // vẫn chạy khi settlement chưa ghi nhận (phòng lần trước ghi closing xong nhưng mark bị lỗi).
  if (!hasCurrentEmployeeWorkDayClosing || aggregateMarkRequired) {
    try {
      await timing.measure("mark_settlement", () =>
        firestoreRepository.shop.settlement.markWorkDaySettlementEmployeeClosed(
          authContext.ownerId,
          storeId,
          workDate,
          authContext.uid,
          { onCommitted: onSettlementCommit },
        ),
      );
    } catch (error) {
      if (employeeClosingIsDurable) {
        markWorkDaySettlementPostWriteFailure(res, "aggregate_mark");
      }

      throw error;
    }
  }

  if (!closingPersistedByRequest && !aggregateMarkRequired) {
    setWorkDaySettlementTraceOutcome(res, "idempotent_replay");
  }

  res.setHeader("Server-Timing", timing.header());
  res.locals["serverTiming"] = timing.toObject();
  return res.status(200).json({
    id: closing.id,
    workDate,
    storeId,
    employeeUserId: authContext.uid,
    attendanceCount: employeeAttendances.length,
    closedAt,
  });
};
