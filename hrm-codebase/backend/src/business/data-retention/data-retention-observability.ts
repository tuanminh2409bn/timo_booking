import { trace } from "@opentelemetry/api";
import type { Request, Response } from "express";
import { getStoreIdFromUrlPath } from "../../helpers/request-store-id.js";
import { observeBusinessHandler } from "../../modules/business-observability.js";
import { getRequestContext } from "../../modules/request-context.js";
import { withAppSpan } from "../../modules/tracing.js";
import {
  DATA_RETENTION_TRACE_DOMAIN,
  DATA_RETENTION_TRACE_EVENTS,
  DATA_RETENTION_TRACE_FAILURE_PHASES,
  DATA_RETENTION_TRACE_LAST_COMMITTED_STAGES,
  DATA_RETENTION_TRACE_OPERATIONS,
  DATA_RETENTION_TRACE_OUTCOMES,
  filterDataRetentionTraceAttributes,
  setDataRetentionSpanAttributes,
  type DataRetentionTraceAttributes,
  type DataRetentionTraceChildSpan,
  type DataRetentionTraceEvent,
  type DataRetentionTraceFailurePhase,
  type DataRetentionTraceLastCommittedStage,
  type DataRetentionTraceOperation,
  type DataRetentionTraceOutcome,
  type DataRetentionTraceSpan,
} from "./data-retention-tracing-contract.js";

type DataRetentionHandler = (req: Request, res: Response) => Promise<unknown>;

type DataRetentionObservabilityOptions = {
  spanName: DataRetentionTraceSpan;
  route: string;
  operation: DataRetentionTraceOperation;
  eventName?: string;
  getAttributes?: (req: Request) => DataRetentionTraceAttributes;
};

type DataRetentionJobRootInput = {
  executionMode: "dry_run" | "execute";
  batchSize?: number;
};

const outcomeSet = new Set<string>(DATA_RETENTION_TRACE_OUTCOMES);
const failurePhaseSet = new Set<string>(DATA_RETENTION_TRACE_FAILURE_PHASES);
const lastCommittedStageSet = new Set<string>(DATA_RETENTION_TRACE_LAST_COMMITTED_STAGES);
const eventSet = new Set<string>(Object.values(DATA_RETENTION_TRACE_EVENTS));
export type DataRetentionErrorTraceContext = {
  outcome?: Extract<
    DataRetentionTraceOutcome,
    "dependency_failure" | "post_write_failure" | "batch_retry_exhausted"
  >;
  failurePhase?: DataRetentionTraceFailurePhase;
  lastCommittedStage?: DataRetentionTraceLastCommittedStage;
};

const traceContextByError = new WeakMap<object, DataRetentionErrorTraceContext>();

const dataRetentionOutcomeByErrorType = new Map<string, DataRetentionTraceOutcome>([
  ["/account/data-retention-plan/forbidden", "forbidden_role"],
  ["/account/data-retention-plan/invalid-request", "invalid_payload"],
  ["/account/data-retention-plan/payment-required", "payment_required"],
]);

const getRequestErrorType = (response: Pick<Response, "locals">): string | undefined => {
  const requestError = response.locals["requestError"];

  if (typeof requestError !== "object" || requestError === null) {
    return undefined;
  }

  const errorType = (requestError as Record<string, unknown>)["errorType"];
  return typeof errorType === "string" ? errorType : undefined;
};

const isDataRetentionOutcome = (value: unknown): value is DataRetentionTraceOutcome =>
  typeof value === "string" && outcomeSet.has(value);

const isDataRetentionFailurePhase = (value: unknown): value is DataRetentionTraceFailurePhase =>
  typeof value === "string" && failurePhaseSet.has(value);

const isDataRetentionLastCommittedStage = (
  value: unknown,
): value is DataRetentionTraceLastCommittedStage =>
  typeof value === "string" && lastCommittedStageSet.has(value);

const getExplicitCompletionAttributes = (
  response: Pick<Response, "locals">,
): DataRetentionTraceAttributes => {
  const outcome = response.locals["dataRetentionTraceOutcome"];
  const failurePhase = response.locals["dataRetentionTraceFailurePhase"];
  const lastCommittedStage = response.locals["dataRetentionTraceLastCommittedStage"];
  const attributes: DataRetentionTraceAttributes = {};

  if (isDataRetentionOutcome(outcome)) {
    attributes["retention.outcome"] = outcome;
  }

  if (isDataRetentionFailurePhase(failurePhase)) {
    attributes["retention.failure_phase"] = failurePhase;
  }

  if (isDataRetentionLastCommittedStage(lastCommittedStage)) {
    attributes["retention.last_committed_stage"] = lastCommittedStage;
  }

  return attributes;
};

export const getDataRetentionCompletionTraceAttributes = (
  response: Pick<Response, "locals" | "statusCode">,
): DataRetentionTraceAttributes => {
  const explicitAttributes = getExplicitCompletionAttributes(response);

  if (explicitAttributes["retention.outcome"] !== undefined) {
    return explicitAttributes;
  }

  if (response.statusCode < 400) {
    return { ...explicitAttributes, "retention.outcome": "success" };
  }

  const errorType = getRequestErrorType(response);
  const outcome =
    errorType === undefined ? undefined : dataRetentionOutcomeByErrorType.get(errorType);

  if (outcome !== undefined) {
    return { ...explicitAttributes, "retention.outcome": outcome };
  }

  if (response.statusCode >= 500) {
    return { ...explicitAttributes, "retention.outcome": "dependency_failure" };
  }

  return explicitAttributes;
};

export const getDataRetentionRootSpanAttributes = (
  request: Request,
  options: Pick<DataRetentionObservabilityOptions, "getAttributes" | "operation">,
): DataRetentionTraceAttributes => {
  const attributes = filterDataRetentionTraceAttributes(options.getAttributes?.(request) ?? {});
  delete attributes["app.domain"];
  delete attributes["app.operation"];
  delete attributes["app.store_id"];

  const storeId = getStoreIdFromUrlPath(request);

  return {
    ...attributes,
    "app.domain": DATA_RETENTION_TRACE_DOMAIN,
    "app.operation": options.operation,
    ...(storeId !== undefined && { "app.store_id": storeId }),
  };
};

export const getDataRetentionJobRootSpanAttributes = ({
  executionMode,
  batchSize,
}: DataRetentionJobRootInput): DataRetentionTraceAttributes =>
  filterDataRetentionTraceAttributes({
    "app.domain": DATA_RETENTION_TRACE_DOMAIN,
    "app.operation": DATA_RETENTION_TRACE_OPERATIONS.jobRun,
    "actor.role": "system",
    "retention.execution_mode": executionMode,
    ...(batchSize !== undefined && { "retention.batch_size": batchSize }),
  });

export const setActiveDataRetentionSpanAttributes = (attributes: DataRetentionTraceAttributes) => {
  try {
    const span = trace.getActiveSpan();

    if (span !== undefined) {
      setDataRetentionSpanAttributes(span, attributes);
    }
  } catch {
    // Telemetry must never change retention behavior.
  }
};

export const addActiveDataRetentionSpanEvent = (
  eventName: DataRetentionTraceEvent,
  attributes: DataRetentionTraceAttributes = {},
) => {
  if (!eventSet.has(eventName)) {
    return;
  }

  try {
    const span = trace.getActiveSpan();

    if (span !== undefined) {
      span.addEvent(eventName, filterDataRetentionTraceAttributes(attributes));
    }
  } catch {
    // Telemetry must never change retention behavior.
  }
};

export const setDataRetentionTraceOutcome = (
  response: Pick<Response, "locals">,
  outcome: DataRetentionTraceOutcome,
) => {
  response.locals["dataRetentionTraceOutcome"] = outcome;
};

export const markDataRetentionDependencyFailure = (
  response: Pick<Response, "locals">,
  failurePhase: DataRetentionTraceFailurePhase,
) => {
  response.locals["dataRetentionTraceOutcome"] = "dependency_failure";
  response.locals["dataRetentionTraceFailurePhase"] = failurePhase;
};

export const markDataRetentionErrorFailurePhase = (
  error: unknown,
  failurePhase: DataRetentionTraceFailurePhase,
) => {
  if (typeof error === "object" && error !== null) {
    const context = traceContextByError.get(error) ?? {};
    traceContextByError.set(error, { ...context, failurePhase });
  }
};

export const markDataRetentionErrorTraceContext = (
  error: unknown,
  context: DataRetentionErrorTraceContext,
) => {
  if (typeof error === "object" && error !== null) {
    traceContextByError.set(error, {
      ...traceContextByError.get(error),
      ...context,
    });
  }
};

export const getDataRetentionErrorTraceContext = (
  error: unknown,
): DataRetentionErrorTraceContext | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  return traceContextByError.get(error);
};

export const getDataRetentionErrorFailurePhase = (
  error: unknown,
): DataRetentionTraceFailurePhase | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  return traceContextByError.get(error)?.failurePhase;
};

export const setDataRetentionLastCommittedStage = (
  response: Pick<Response, "locals">,
  lastCommittedStage: DataRetentionTraceLastCommittedStage,
) => {
  response.locals["dataRetentionTraceLastCommittedStage"] = lastCommittedStage;
};

export const markDataRetentionPostWriteFailure = (
  response: Pick<Response, "locals">,
  failurePhase: DataRetentionTraceFailurePhase,
  lastCommittedStage: DataRetentionTraceLastCommittedStage,
) => {
  response.locals["dataRetentionTraceOutcome"] = "post_write_failure";
  response.locals["dataRetentionTraceFailurePhase"] = failurePhase;
  response.locals["dataRetentionTraceLastCommittedStage"] = lastCommittedStage;
};

export const withDataRetentionSpan = <T>(
  spanName: DataRetentionTraceSpan | DataRetentionTraceChildSpan,
  attributes: DataRetentionTraceAttributes,
  handler: () => Promise<T>,
): Promise<T> =>
  withAppSpan(spanName, filterDataRetentionTraceAttributes(attributes), () => handler(), {
    recordException: false,
  });

const setRetentionActorRole = () => {
  setActiveDataRetentionSpanAttributes({ "actor.role": getRequestContext()?.role });
};

export const observeDataRetentionHandler = (
  options: DataRetentionObservabilityOptions,
  handler: DataRetentionHandler,
): DataRetentionHandler =>
  observeBusinessHandler(
    {
      eventName: options.eventName ?? options.spanName,
      route: options.route,
      spanName: options.spanName,
      domain: DATA_RETENTION_TRACE_DOMAIN,
      recordException: false,
    },
    async (request, response) => {
      setActiveDataRetentionSpanAttributes(getDataRetentionRootSpanAttributes(request, options));

      try {
        return await handler(request, response);
      } catch (error) {
        if (response.locals["dataRetentionTraceOutcome"] === undefined) {
          setDataRetentionTraceOutcome(response, "dependency_failure");
        }

        throw error;
      } finally {
        setActiveDataRetentionSpanAttributes(getDataRetentionCompletionTraceAttributes(response));
        setRetentionActorRole();
      }
    },
  );
