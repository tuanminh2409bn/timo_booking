import { trace, type Span } from "@opentelemetry/api";
import type { Request, Response } from "express";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { observeBusinessHandler } from "../../../modules/business-observability.js";
import { getRequestContext } from "../../../modules/request-context.js";
import { withAppSpan } from "../../../modules/tracing.js";
import type {
  EmployeeTimeTrackingCommit,
  EmployeeTimeTrackingCommitObserver,
} from "../../../repository/firestore/shop/employee-time-tracking-commit-observer.js";
import type {
  EmployeeTimeTrackingTraceChildSpan,
  EmployeeTimeTrackingTraceEvent,
  EmployeeTimeTrackingTracePostWritePhase,
  EmployeeTimeTrackingTraceAttributes,
  EmployeeTimeTrackingAction,
  EmployeeTimeTrackingCurrentStatus,
  EmployeeTimeTrackingTraceOperation,
  EmployeeTimeTrackingTraceOutcome,
  EmployeeTimeTrackingTraceSpan,
} from "./employee-time-tracking-tracing-contract.js";
import {
  EMPLOYEE_TIME_TRACKING_TRACE_DOMAIN,
  EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS,
  EMPLOYEE_TIME_TRACKING_TRACE_EVENTS,
  EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS,
  EMPLOYEE_TIME_TRACKING_TRACE_OUTCOMES,
  EMPLOYEE_TIME_TRACKING_TRACE_POST_WRITE_PHASES,
  filterEmployeeTimeTrackingTraceAttributes,
  getEmployeeTimeTrackingTransitionOutcome,
  setEmployeeTimeTrackingSpanAttributes,
} from "./employee-time-tracking-tracing-contract.js";

type EmployeeTimeTrackingRootSpanOptions = {
  operation: EmployeeTimeTrackingTraceOperation;
  getAttributes?: (request: Request) => EmployeeTimeTrackingTraceAttributes;
};

type EmployeeTimeTrackingObservabilityOptions = EmployeeTimeTrackingRootSpanOptions & {
  spanName: EmployeeTimeTrackingTraceSpan;
  route: string;
  eventName?: string;
};

type EmployeeTimeTrackingHandler = (request: Request, response: Response) => Promise<unknown>;

const outcomeByErrorType = new Map<string, EmployeeTimeTrackingTraceOutcome>([
  ["/me/time-tracking/invalid-request", "invalid_payload"],
  ["/stores/employee-time-tracking/invalid-request", "invalid_payload"],
]);
const outcomeSet = new Set<string>(EMPLOYEE_TIME_TRACKING_TRACE_OUTCOMES);
const postWritePhaseSet = new Set<string>(EMPLOYEE_TIME_TRACKING_TRACE_POST_WRITE_PHASES);

const isTraceOutcome = (value: unknown): value is EmployeeTimeTrackingTraceOutcome =>
  typeof value === "string" && outcomeSet.has(value);

const isPostWritePhase = (value: unknown): value is EmployeeTimeTrackingTracePostWritePhase =>
  typeof value === "string" && postWritePhaseSet.has(value);

const getExplicitOutcome = (
  response: Pick<Response, "locals">,
): EmployeeTimeTrackingTraceOutcome | undefined => {
  const outcome = response.locals["timeTrackingTraceOutcome"];
  return isTraceOutcome(outcome) ? outcome : undefined;
};

const getExplicitPostWritePhase = (
  response: Pick<Response, "locals">,
): EmployeeTimeTrackingTracePostWritePhase | undefined => {
  const phase = response.locals["timeTrackingTracePostWritePhase"];
  return isPostWritePhase(phase) ? phase : undefined;
};

const getRequestErrorType = (response: Pick<Response, "locals">): string | undefined => {
  const requestError = response.locals["requestError"];

  if (typeof requestError !== "object" || requestError === null) {
    return undefined;
  }

  const errorType = (requestError as Record<string, unknown>)["errorType"];
  return typeof errorType === "string" ? errorType : undefined;
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

const getRequestedWorkDate = (request: Request): unknown => {
  const workDate = getRequestValue(request, "workDate");

  if (workDate !== undefined) {
    return workDate;
  }

  return getRequestValue(request, "date");
};

const isReadOperation = (operation: EmployeeTimeTrackingTraceOperation): boolean =>
  operation === EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS.selfRead ||
  operation === EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS.storeRead;

const getRequestedAction = (
  request: Request,
  operation: EmployeeTimeTrackingTraceOperation,
): unknown => (isReadOperation(operation) ? "read" : getRequestValue(request, "action"));

const getRequestScope = (operation: EmployeeTimeTrackingTraceOperation): "self" | "store" => {
  if (
    operation === EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS.selfRead ||
    operation === EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS.selfUpdate
  ) {
    return "self";
  }

  return "store";
};

export const getEmployeeTimeTrackingRootSpanAttributes = (
  request: Request,
  options: EmployeeTimeTrackingRootSpanOptions,
): EmployeeTimeTrackingTraceAttributes => {
  const suppliedAttributes = options.getAttributes?.(request) ?? {};
  const storeId = getStoreIdFromUrlPath(request);

  return filterEmployeeTimeTrackingTraceAttributes({
    ...suppliedAttributes,
    "app.domain": EMPLOYEE_TIME_TRACKING_TRACE_DOMAIN,
    "app.operation": options.operation,
    "time_tracking.scope": getRequestScope(options.operation),
    "time_tracking.action": getRequestedAction(request, options.operation),
    "time_tracking.work_date": getRequestedWorkDate(request),
    "time_tracking.manual_checkout": getRequestValue(request, "checkedOutAt") !== undefined,
    ...(storeId !== undefined && { "app.store_id": storeId }),
  });
};

export const getEmployeeTimeTrackingCompletionTraceAttributes = (
  response: Pick<Response, "locals" | "statusCode">,
): EmployeeTimeTrackingTraceAttributes => {
  const explicitOutcome = getExplicitOutcome(response);

  if (explicitOutcome !== undefined) {
    const postWritePhase = getExplicitPostWritePhase(response);
    const attributes: EmployeeTimeTrackingTraceAttributes = {
      "time_tracking.outcome": explicitOutcome,
    };

    if (explicitOutcome === "post_write_failure" && postWritePhase !== undefined) {
      attributes["time_tracking.post_write_phase"] = postWritePhase;
    }

    return attributes;
  }

  if (response.statusCode < 400) {
    return { "time_tracking.outcome": "success" };
  }

  const errorType = getRequestErrorType(response);
  const outcome = errorType === undefined ? undefined : outcomeByErrorType.get(errorType);

  if (outcome !== undefined) {
    return { "time_tracking.outcome": outcome };
  }

  if (response.statusCode >= 500) {
    return { "time_tracking.outcome": "dependency_failure" };
  }

  return {};
};

export const setActiveEmployeeTimeTrackingSpanAttributes = (
  attributes: EmployeeTimeTrackingTraceAttributes,
) => {
  const span = trace.getActiveSpan();

  if (span !== undefined) {
    setEmployeeTimeTrackingSpanAttributes(span, attributes);
  }
};

export const setEmployeeTimeTrackingTraceOutcome = (
  response: Pick<Response, "locals">,
  outcome: EmployeeTimeTrackingTraceOutcome,
) => {
  response.locals["timeTrackingTraceOutcome"] = outcome;
  setActiveEmployeeTimeTrackingSpanAttributes({ "time_tracking.outcome": outcome });
};

export const recordEmployeeTimeTrackingTransitionOutcome = (
  response: Pick<Response, "locals">,
  input: {
    action: EmployeeTimeTrackingAction;
    currentStatus: EmployeeTimeTrackingCurrentStatus;
    pendingCheckoutPresent?: boolean;
    checkoutTimeValid?: boolean;
  },
) => {
  const outcome = getEmployeeTimeTrackingTransitionOutcome(input);

  if (outcome !== undefined) {
    setEmployeeTimeTrackingTraceOutcome(response, outcome);
  }

  return outcome;
};

export const markEmployeeTimeTrackingPostWriteFailure = (
  response: Pick<Response, "locals">,
  phase: EmployeeTimeTrackingTracePostWritePhase,
) => {
  response.locals["timeTrackingTracePostWritePhase"] = phase;
  setEmployeeTimeTrackingTraceOutcome(response, "post_write_failure");
  setActiveEmployeeTimeTrackingSpanAttributes({ "time_tracking.post_write_phase": phase });
};

export const withEmployeeTimeTrackingSpan = <T>(
  spanName: EmployeeTimeTrackingTraceChildSpan,
  attributes: EmployeeTimeTrackingTraceAttributes,
  handler: (span: Span) => Promise<T>,
): Promise<T> =>
  withAppSpan(spanName, filterEmployeeTimeTrackingTraceAttributes(attributes), handler, {
    recordException: false,
  });

export const addActiveEmployeeTimeTrackingSpanEvent = (
  eventName: EmployeeTimeTrackingTraceEvent,
  attributes: EmployeeTimeTrackingTraceAttributes = {},
) => {
  const span = trace.getActiveSpan();

  if (span !== undefined) {
    span.addEvent(eventName, filterEmployeeTimeTrackingTraceAttributes(attributes));
  }
};

export const observeEmployeeTimeTrackingCommit = (commit: EmployeeTimeTrackingCommit) => {
  const attributes: EmployeeTimeTrackingTraceAttributes = {
    "app.store_id": commit.storeId,
    "time_tracking.action": commit.action,
    "time_tracking.work_date": commit.workDate,
    "time_tracking.status.before": commit.statusBefore,
    "time_tracking.status.after": commit.statusAfter,
    "time_tracking.persist_action": commit.persistAction,
    "time_tracking.last_committed_stage": "session",
  };

  setActiveEmployeeTimeTrackingSpanAttributes(attributes);
  addActiveEmployeeTimeTrackingSpanEvent(
    EMPLOYEE_TIME_TRACKING_TRACE_EVENTS.sessionCommitted,
    attributes,
  );
};

export const observeEmployeeTimeTrackingSessionUpsert = async <T>(
  response: Pick<Response, "locals">,
  persist: (onCommitted: EmployeeTimeTrackingCommitObserver) => Promise<T>,
): Promise<T> => {
  let committed = false;
  const onCommitted: EmployeeTimeTrackingCommitObserver = (commit) => {
    committed = true;
    observeEmployeeTimeTrackingCommit(commit);
  };

  try {
    return await persist(onCommitted);
  } catch (error) {
    if (committed) {
      markEmployeeTimeTrackingPostWriteFailure(response, "cache_invalidation");
    }

    throw error;
  }
};

export const observeEmployeeTimeTrackingAuditWrite = async <T>(
  response: Pick<Response, "locals">,
  attributes: EmployeeTimeTrackingTraceAttributes,
  writeAudit: () => Promise<T>,
): Promise<T> => {
  try {
    return await withEmployeeTimeTrackingSpan(
      EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.auditWrite,
      {
        ...attributes,
        "time_tracking.post_write_phase": "audit",
      },
      writeAudit,
    );
  } catch (error) {
    markEmployeeTimeTrackingPostWriteFailure(response, "audit");
    throw error;
  }
};

const setActorRole = () => {
  setActiveEmployeeTimeTrackingSpanAttributes({ "actor.role": getRequestContext()?.role });
};

export const observeEmployeeTimeTrackingHandler = (
  options: EmployeeTimeTrackingObservabilityOptions,
  handler: EmployeeTimeTrackingHandler,
): EmployeeTimeTrackingHandler =>
  observeBusinessHandler(
    {
      eventName: options.eventName ?? options.spanName,
      route: options.route,
      spanName: options.spanName,
      domain: EMPLOYEE_TIME_TRACKING_TRACE_DOMAIN,
      recordException: false,
    },
    async (request, response) => {
      setActiveEmployeeTimeTrackingSpanAttributes(
        getEmployeeTimeTrackingRootSpanAttributes(request, options),
      );

      try {
        return await handler(request, response);
      } catch (error) {
        if (getExplicitOutcome(response) === undefined) {
          setEmployeeTimeTrackingTraceOutcome(response, "dependency_failure");
        }

        throw error;
      } finally {
        setActiveEmployeeTimeTrackingSpanAttributes(
          getEmployeeTimeTrackingCompletionTraceAttributes(response),
        );
        setActorRole();
      }
    },
  );
