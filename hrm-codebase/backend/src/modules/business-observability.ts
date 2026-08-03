import { SpanStatusCode, isSpanContextValid, type Span } from "@opentelemetry/api";
import type { Request, Response } from "express";
import { setAppSpanAttributes, type AppSpanAttributes, withAppSpan } from "./tracing.js";

type BusinessHandler = (req: Request, res: Response) => Promise<unknown>;

type BusinessObservabilityOptions = {
  eventName: string;
  route: string;
  domain?: string;
  spanName?: string;
  recordException?: boolean;
};

type BusinessSpanOutcome = "success" | "rejected" | "failure";

type BusinessSpanCompletion = {
  statusCode: number;
  outcome: BusinessSpanOutcome;
  spanStatusCode: SpanStatusCode;
  outcomeReason?: string;
  errorSource?: string;
  errorScope?: string;
};

const getOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  if (value.length === 0) {
    return undefined;
  }

  return value;
};

const getRequestError = (response: Pick<Response, "locals">) => {
  const requestError = response.locals["requestError"];

  if (typeof requestError !== "object" || requestError === null) {
    return undefined;
  }

  return requestError as Record<string, unknown>;
};

const getBusinessSpanOutcome = (statusCode: number): BusinessSpanOutcome => {
  if (statusCode >= 500) {
    return "failure";
  }

  if (statusCode >= 400) {
    return "rejected";
  }

  return "success";
};

const getBusinessSpanStatusCode = (outcome: BusinessSpanOutcome): SpanStatusCode => {
  if (outcome === "failure") {
    return SpanStatusCode.ERROR;
  }

  if (outcome === "rejected") {
    return SpanStatusCode.UNSET;
  }

  return SpanStatusCode.OK;
};

const getBusinessOutcomeReason = (
  statusCode: number,
  requestError?: Record<string, unknown>,
): string => {
  const errorType = getOptionalString(requestError?.["errorType"]);

  if (errorType !== undefined) {
    return errorType;
  }

  return `http_${statusCode}`;
};

const getBusinessSpanAttributes = (completion: BusinessSpanCompletion): AppSpanAttributes => {
  const attributes: AppSpanAttributes = {
    "app.response_status_code": completion.statusCode,
    "app.outcome": completion.outcome,
    "app.outcome_reason": completion.outcomeReason,
  };

  if (completion.outcome === "success") {
    return attributes;
  }

  attributes["app.error_source"] = completion.errorSource;
  attributes["app.error_scope"] = completion.errorScope;

  return attributes;
};

const getBusinessSpanStatus = (completion: BusinessSpanCompletion) => {
  if (completion.outcome !== "failure") {
    return { code: completion.spanStatusCode };
  }

  if (completion.outcomeReason === undefined) {
    return { code: completion.spanStatusCode };
  }

  return {
    code: completion.spanStatusCode,
    message: completion.outcomeReason,
  };
};

export const resolveBusinessSpanCompletion = (
  response: Pick<Response, "locals" | "statusCode">,
): BusinessSpanCompletion => {
  const statusCode = response.statusCode;
  const outcome = getBusinessSpanOutcome(statusCode);
  const spanStatusCode = getBusinessSpanStatusCode(outcome);

  if (outcome === "success") {
    return {
      statusCode,
      outcome,
      spanStatusCode,
    };
  }

  const requestError = getRequestError(response);
  const completion: BusinessSpanCompletion = {
    statusCode,
    outcome,
    spanStatusCode,
    outcomeReason: getBusinessOutcomeReason(statusCode, requestError),
  };

  if (requestError === undefined) {
    return completion;
  }

  const errorSource = getOptionalString(requestError["errorSource"]);
  const errorScope = getOptionalString(requestError["errorScope"]);

  if (errorSource !== undefined) {
    completion.errorSource = errorSource;
  }

  if (errorScope !== undefined) {
    completion.errorScope = errorScope;
  }

  return completion;
};

export const completeBusinessSpan = (
  span: Span,
  response: Pick<Response, "locals" | "statusCode">,
) => {
  const completion = resolveBusinessSpanCompletion(response);

  setAppSpanAttributes(span, getBusinessSpanAttributes(completion));
  span.setStatus(getBusinessSpanStatus(completion));
};

const hasStoreReference = (req: Request) =>
  typeof req.params["storeId"] === "string" ||
  typeof req.body?.storeId === "string" ||
  typeof req.query["storeId"] === "string";

// Adds one business span under the auto-instrumented HTTP span and reuses the
// same request completion log instead of producing a duplicate business log.
export const observeBusinessHandler =
  (options: BusinessObservabilityOptions, handler: BusinessHandler): BusinessHandler =>
  async (req: Request, res: Response) => {
    res.locals["businessEvent"] = options.eventName;

    return withAppSpan(
      options.spanName ?? options.eventName,
      {
        "app.route": options.route,
        "app.domain": options.domain,
        "app.store_present": hasStoreReference(req),
      },
      async (span) => {
        const spanContext = span.spanContext();

        if (isSpanContextValid(spanContext)) {
          res.locals["spanId"] = spanContext.spanId;
        }

        res.locals["spanScope"] = options.spanName ?? options.eventName;

        try {
          const result = await handler(req, res);
          completeBusinessSpan(span, res);
          return result;
        } catch (error) {
          setAppSpanAttributes(span, {
            "app.outcome": "failure",
            "app.outcome_reason": "unhandled_exception",
          });
          throw error;
        }
      },
      {
        markSuccessfulHandlerAsOk: false,
        ...(options.recordException !== undefined && {
          recordException: options.recordException,
        }),
      },
    );
  };
