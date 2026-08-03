import { trace, type Span } from "@opentelemetry/api";
import type { Request, Response } from "express";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { observeBusinessHandler } from "../../../modules/business-observability.js";
import { getRequestContext } from "../../../modules/request-context.js";
import { withAppSpan } from "../../../modules/tracing.js";
import type {
  WorkDaySettlementCommit,
  WorkDaySettlementCommitStage,
} from "../../../repository/firestore/shop/work-day-settlement-commit-observer.js";
import {
  WORK_DAY_SETTLEMENT_TRACE_DOMAIN,
  WORK_DAY_SETTLEMENT_TRACE_EVENTS,
  WORK_DAY_SETTLEMENT_TRACE_OUTCOMES,
  filterWorkDaySettlementTraceAttributes,
  setWorkDaySettlementSpanAttributes,
  type WorkDaySettlementTraceAttributes,
  type WorkDaySettlementTraceChildSpan,
  type WorkDaySettlementTraceEvent,
  type WorkDaySettlementTraceOperation,
  type WorkDaySettlementTraceOutcome,
  type WorkDaySettlementTracePostWritePhase,
  type WorkDaySettlementTraceSpan,
} from "./work-day-settlement-tracing-contract.js";

type WorkDaySettlementHandler = (req: Request, res: Response) => Promise<unknown>;

type StoreCloseInvalidStateTraceInput = {
  attendanceCount: number;
  incompleteAttendanceCount?: number;
  compensationErrorCount?: number;
  discountAllocationInvalid?: boolean;
  negativeEmployeeEarning?: boolean;
};

type EmployeeSettlementCompensationModel = "commission" | "fixed" | "hourly";
type EmployeeTimeTrackingSnapshot = {
  status: "working" | "completed";
};
type EmployeeClosingSnapshot = {
  attendanceIds: string[];
  attendanceVersions: Record<string, number>;
};

export type EmployeeTimeTrackingTraceStatus = "not_required" | "missing" | "working" | "completed";
export type EmployeeClosingTraceStatus = "missing" | "stale" | "current";

export const getEmployeeTimeTrackingTraceStatus = (
  compensationModel: EmployeeSettlementCompensationModel,
  timeTrackingSession: EmployeeTimeTrackingSnapshot | null,
): EmployeeTimeTrackingTraceStatus => {
  if (compensationModel !== "hourly") {
    return "not_required";
  }

  if (timeTrackingSession === null) {
    return "missing";
  }

  return timeTrackingSession.status;
};

export const getEmployeeClosingTraceStatus = (
  employeeClosing: EmployeeClosingSnapshot | null,
  attendanceIds: readonly string[],
  attendanceVersions: Readonly<Record<string, number>>,
): EmployeeClosingTraceStatus => {
  if (employeeClosing === null) {
    return "missing";
  }

  if (employeeClosing.attendanceIds.length !== attendanceIds.length) {
    return "stale";
  }

  const attendanceIdSet = new Set(attendanceIds);

  for (const attendanceId of employeeClosing.attendanceIds) {
    if (!attendanceIdSet.has(attendanceId)) {
      return "stale";
    }

    if (employeeClosing.attendanceVersions[attendanceId] !== attendanceVersions[attendanceId]) {
      return "stale";
    }
  }

  return "current";
};

type WorkDaySettlementObservabilityOptions = {
  spanName: WorkDaySettlementTraceSpan;
  route: string;
  operation: WorkDaySettlementTraceOperation;
  eventName?: string;
  getAttributes?: (req: Request) => WorkDaySettlementTraceAttributes;
};

const settlementOutcomeByErrorType = new Map<string, WorkDaySettlementTraceOutcome>([
  ["/me/work-day-closings/forbidden-role", "forbidden_role"],
  ["/me/work-day-closings/invalid-request", "invalid_payload"],
  ["/me/work-day-closings/work-day-already-closed", "already_closed"],
  ["/me/work-day-closings/attendance-incomplete", "attendance_incomplete"],
  ["/me/work-day-closings/no-attendance", "no_attendance"],
  ["/me/work-day-closings/time-tracking-required", "time_tracking_required"],
  ["/me/work-day-closings/checkout-required", "check_out_required"],
  ["/stores/work-day-settlements/forbidden-store", "forbidden_store"],
  ["/stores/work-day-settlements/forbidden-role", "forbidden_role"],
  ["/stores/work-day-settlements/invalid-request", "invalid_payload"],
  ["/stores/work-day-settlements/work-day-already-closed", "already_closed"],
  ["/stores/work-day-settlements/work-day-has-open-attendance", "employee_closing_pending"],
  ["/stores/work-day-settlements/no-discount-eligible-employees", "discount_allocation_invalid"],
  ["/stores/work-day-settlements/invalid-settlement-state", "invalid_settlement_state"],
]);
const settlementOutcomeSet = new Set<string>(WORK_DAY_SETTLEMENT_TRACE_OUTCOMES);
const settlementCommitEventByStage: Record<
  WorkDaySettlementCommitStage,
  WorkDaySettlementTraceEvent
> = {
  employee_closing: WORK_DAY_SETTLEMENT_TRACE_EVENTS.employeeClosingCommitted,
  aggregate_mark: WORK_DAY_SETTLEMENT_TRACE_EVENTS.aggregateEmployeeMarkCommitted,
  aggregate_prepared: WORK_DAY_SETTLEMENT_TRACE_EVENTS.aggregatePreparedCommitted,
  store_closing: WORK_DAY_SETTLEMENT_TRACE_EVENTS.storeClosingCommitted,
  closed_recalculation: WORK_DAY_SETTLEMENT_TRACE_EVENTS.closedRecalculationCommitted,
  aggregate_deleted: WORK_DAY_SETTLEMENT_TRACE_EVENTS.aggregateDeleted,
};

export const getStoreCloseInvalidStateTraceOutcome = (
  input: StoreCloseInvalidStateTraceInput,
): WorkDaySettlementTraceOutcome | undefined => {
  if (input.attendanceCount === 0) {
    return "no_attendance";
  }

  if ((input.incompleteAttendanceCount ?? 0) > 0) {
    return "attendance_incomplete";
  }

  if ((input.compensationErrorCount ?? 0) > 0) {
    return "compensation_incomplete";
  }

  if (input.discountAllocationInvalid === true) {
    return "discount_allocation_invalid";
  }

  if (input.negativeEmployeeEarning === true) {
    return "negative_employee_earning";
  }

  return undefined;
};

const isSettlementTraceOutcome = (value: unknown): value is WorkDaySettlementTraceOutcome =>
  typeof value === "string" && settlementOutcomeSet.has(value);

const getRequestErrorType = (response: Pick<Response, "locals">): string | undefined => {
  const requestError = response.locals["requestError"];

  if (typeof requestError !== "object" || requestError === null) {
    return undefined;
  }

  const errorType = (requestError as Record<string, unknown>)["errorType"];
  return typeof errorType === "string" ? errorType : undefined;
};

const getExplicitOutcome = (
  response: Pick<Response, "locals">,
): WorkDaySettlementTraceOutcome | undefined => {
  const outcome = response.locals["settlementTraceOutcome"];
  return isSettlementTraceOutcome(outcome) ? outcome : undefined;
};

export const getWorkDaySettlementCompletionTraceAttributes = (
  response: Pick<Response, "locals" | "statusCode">,
): WorkDaySettlementTraceAttributes => {
  const explicitOutcome = getExplicitOutcome(response);

  if (explicitOutcome !== undefined) {
    return { "settlement.outcome": explicitOutcome };
  }

  if (response.statusCode < 400) {
    return { "settlement.outcome": "success" };
  }

  const errorType = getRequestErrorType(response);

  if (errorType !== undefined) {
    const outcome = settlementOutcomeByErrorType.get(errorType);

    if (outcome !== undefined) {
      return { "settlement.outcome": outcome };
    }
  }

  if (response.statusCode >= 500) {
    return { "settlement.outcome": "dependency_failure" };
  }

  return {};
};

const getRequestValue = (request: Request, key: string): unknown => {
  if (typeof request.body === "object" && request.body !== null) {
    const bodyValue = (request.body as Record<string, unknown>)[key];

    if (bodyValue !== undefined) {
      return bodyValue;
    }
  }

  return request.query[key];
};

const getWorkDate = (request: Request): string | undefined => {
  const workDate = getRequestValue(request, "workDate") ?? getRequestValue(request, "date");
  return typeof workDate === "string" ? workDate : undefined;
};

export const getWorkDaySettlementRootSpanAttributes = (
  request: Request,
  options: Pick<WorkDaySettlementObservabilityOptions, "getAttributes" | "operation">,
): WorkDaySettlementTraceAttributes => {
  const attributes = options.getAttributes?.(request) ?? {};
  const storeId = getStoreIdFromUrlPath(request);

  return {
    ...attributes,
    "app.domain": WORK_DAY_SETTLEMENT_TRACE_DOMAIN,
    "app.operation": options.operation,
    "settlement.scope": options.operation === "employee_close" ? "employee" : "store",
    "settlement.work_date": getWorkDate(request),
    ...(storeId !== undefined && { "app.store_id": storeId }),
  };
};

export const setActiveWorkDaySettlementSpanAttributes = (
  attributes: WorkDaySettlementTraceAttributes,
) => {
  const span = trace.getActiveSpan();

  if (span !== undefined) {
    setWorkDaySettlementSpanAttributes(span, attributes);
  }
};

export const setWorkDaySettlementTraceOutcome = (
  response: Pick<Response, "locals">,
  outcome: WorkDaySettlementTraceOutcome,
) => {
  response.locals["settlementTraceOutcome"] = outcome;
  setActiveWorkDaySettlementSpanAttributes({ "settlement.outcome": outcome });
};

export const markWorkDaySettlementPostWriteFailure = (
  response: Pick<Response, "locals">,
  phase: WorkDaySettlementTracePostWritePhase,
) => {
  setWorkDaySettlementTraceOutcome(response, "post_write_failure");
  setActiveWorkDaySettlementSpanAttributes({ "settlement.post_write_phase": phase });
};

export const addActiveWorkDaySettlementSpanEvent = (
  eventName: WorkDaySettlementTraceEvent,
  attributes: WorkDaySettlementTraceAttributes = {},
) => {
  const span = trace.getActiveSpan();

  if (span !== undefined) {
    span.addEvent(eventName, filterWorkDaySettlementTraceAttributes(attributes));
  }
};

export const observeWorkDaySettlementCommit = (commit: WorkDaySettlementCommit) => {
  const attributes: WorkDaySettlementTraceAttributes = {
    "settlement.persist_action": commit.persistAction,
    "settlement.last_committed_stage": commit.stage,
    "settlement.status.before": commit.statusBefore,
    "settlement.status.after": commit.statusAfter,
    "settlement.revision.before": commit.revisionBefore,
    "settlement.revision.after": commit.revisionAfter,
  };

  setActiveWorkDaySettlementSpanAttributes(attributes);
  addActiveWorkDaySettlementSpanEvent(settlementCommitEventByStage[commit.stage], attributes);
};

export const withWorkDaySettlementSpan = <T>(
  spanName: WorkDaySettlementTraceChildSpan,
  attributes: WorkDaySettlementTraceAttributes,
  handler: (span: Span) => Promise<T>,
): Promise<T> =>
  withAppSpan(spanName, filterWorkDaySettlementTraceAttributes(attributes), handler, {
    recordException: false,
  });

const setSettlementActorRole = () => {
  setActiveWorkDaySettlementSpanAttributes({ "actor.role": getRequestContext()?.role });
};

export const observeWorkDaySettlementHandler = (
  options: WorkDaySettlementObservabilityOptions,
  handler: WorkDaySettlementHandler,
): WorkDaySettlementHandler =>
  observeBusinessHandler(
    {
      eventName: options.eventName ?? options.spanName,
      route: options.route,
      spanName: options.spanName,
      domain: WORK_DAY_SETTLEMENT_TRACE_DOMAIN,
      recordException: false,
    },
    async (request, response) => {
      setActiveWorkDaySettlementSpanAttributes(
        getWorkDaySettlementRootSpanAttributes(request, options),
      );

      try {
        return await handler(request, response);
      } catch (error) {
        if (getExplicitOutcome(response) === undefined) {
          setWorkDaySettlementTraceOutcome(response, "dependency_failure");
        }

        throw error;
      } finally {
        setActiveWorkDaySettlementSpanAttributes(
          getWorkDaySettlementCompletionTraceAttributes(response),
        );
        setSettlementActorRole();
      }
    },
  );
