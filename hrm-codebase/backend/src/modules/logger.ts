import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import pino, { type LoggerOptions } from "pino";
import { redactSensitiveRecord } from "../helpers/redact-sensitive.js";
import { normalizeHttpRoute } from "./metrics.js";
import { runWithRequestContext, type RequestContext } from "./request-context.js";
import { getRequestTraceContextIds } from "./tracing.js";

const isPrettyLoggingEnabled = () =>
  process.env["LOG_PRETTY"] === "true" && process.env["NODE_ENV"] !== "production";

const loggerOptions: LoggerOptions = {
  level: process.env["LOG_LEVEL"] ?? (process.env["NODE_ENV"] === "test" ? "silent" : "info"),
  base: {
    service: process.env["OTEL_SERVICE_NAME"] ?? "nail-salon-backend",
    env: process.env["NODE_ENV"] ?? "development",
  },
  redact: {
    paths: [
      "*.authorization",
      "*.Authorization",
      "*.password",
      "*.newPassword",
      "*.otp",
      "*.resetToken",
      "*.jwtToken",
      "*.firebaseToken",
      "*.idToken",
      "*.token",
      "*.base64",
      "*.bankAccount",
      "*.taxCode",
    ],
    censor: "[REDACTED]",
  },
};

if (isPrettyLoggingEnabled()) {
  loggerOptions.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      singleLine: true,
      translateTime: "SYS:standard",
    },
  };
}

export const logger = pino(loggerOptions);

const getHeaderValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const REQUEST_ERROR_LOG_KEYS = [
  "errorType",
  "errorName",
  "statusCode",
  "errorSource",
  "errorScope",
] as const;

export const filterRequestErrorLogFields = (value: unknown): Record<string, string | number> => {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const requestError = value as Record<string, unknown>;
  const safeFields: Record<string, string | number> = {};

  for (const key of REQUEST_ERROR_LOG_KEYS) {
    const fieldValue = requestError[key];

    if (typeof fieldValue === "string" && fieldValue.length <= 200) {
      safeFields[key] = fieldValue;
      continue;
    }

    if (typeof fieldValue === "number" && Number.isFinite(fieldValue)) {
      safeFields[key] = fieldValue;
    }
  }

  return safeFields;
};

const resolveRequestId = (request: Request) => {
  const incomingRequestId = getHeaderValue(request.headers["x-request-id"]);

  if (incomingRequestId && incomingRequestId.trim().length > 0) {
    return incomingRequestId.trim().slice(0, 128);
  }

  return randomUUID();
};

export const requestContextMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const requestId = resolveRequestId(request);
  const traceContext = getRequestTraceContextIds(request.headers["traceparent"]);

  request.headers["x-request-id"] = requestId;
  response.locals["requestId"] = requestId;
  response.setHeader("X-Request-Id", requestId);

  if (traceContext.traceId) {
    response.locals["traceId"] = traceContext.traceId;
    response.setHeader("X-Trace-Id", traceContext.traceId);
  }

  if (traceContext.spanId) {
    response.locals["spanId"] = traceContext.spanId;
  }

  const requestContext: RequestContext = { requestId };

  if (traceContext.traceId !== undefined) {
    requestContext.traceId = traceContext.traceId;
  }

  if (traceContext.spanId !== undefined) {
    requestContext.spanId = traceContext.spanId;
  }

  response.locals["requestContext"] = requestContext;

  runWithRequestContext(requestContext, () => next());
};

const getRequestLogBase = (request: Request, response?: Response) => {
  const traceContext = getRequestTraceContextIds(request.headers["traceparent"]);
  const requestId =
    response?.locals["requestId"] ?? getHeaderValue(request.headers["x-request-id"]) ?? "unknown";
  const traceId = response?.locals["traceId"] ?? traceContext.traceId;
  const spanId = response?.locals["spanId"] ?? traceContext.spanId;
  const spanScope = response?.locals["spanScope"] ?? "http.request";
  const requestContext = response?.locals["requestContext"];
  const uid = typeof requestContext?.uid === "string" ? requestContext.uid : undefined;
  const role = typeof requestContext?.role === "string" ? requestContext.role : undefined;
  const dependencyFailures = requestContext?.dependencyFailures;
  // Op nghiệp vụ (do observeBusinessHandler gắn) → đưa vào ĐÚNG dòng log của request, để build alert
  // theo tên nghiệp vụ mà không cần log thêm 1 dòng riêng.
  const businessEvent = response?.locals["businessEvent"];
  const serverTiming = response?.locals["serverTiming"];
  const settlementList = response?.locals["settlementList"];
  const settlementPreview = response?.locals["settlementPreview"];
  const notificationFeedStats = response?.locals["notificationFeedStats"];
  const appCheck = response?.locals["appCheck"];
  const requestError = response?.locals["requestError"];
  const googleCloudProjectId = process.env["GOOGLE_CLOUD_PROJECT"] ?? process.env["GCP_PROJECT_ID"];

  return redactSensitiveRecord({
    requestId,
    ...(traceId !== undefined && { traceId }),
    ...(spanId !== undefined && { spanId }),
    spanScope,
    ...(traceId !== undefined &&
      googleCloudProjectId !== undefined && {
        "logging.googleapis.com/trace": `projects/${googleCloudProjectId}/traces/${traceId}`,
      }),
    ...(spanId !== undefined && {
      "logging.googleapis.com/spanId": spanId,
    }),
    ...(uid !== undefined && { uid }),
    ...(role !== undefined && { role }),
    ...(Array.isArray(dependencyFailures) &&
      dependencyFailures.length > 0 && {
        dependencyFailures,
      }),
    ...(typeof businessEvent === "string" && { businessEvent }),
    ...(typeof serverTiming === "object" && serverTiming !== null && { serverTiming }),
    ...(typeof settlementList === "object" && settlementList !== null && { settlementList }),
    ...(typeof settlementPreview === "object" &&
      settlementPreview !== null && { settlementPreview }),
    ...(typeof notificationFeedStats === "object" &&
      notificationFeedStats !== null && { notificationFeedStats }),
    ...(typeof appCheck === "object" && appCheck !== null && { appCheck }),
    ...filterRequestErrorLogFields(requestError),
    method: request.method,
    path: request.path,
    route: normalizeHttpRoute(request),
    ip: request.ip,
    userAgent: request.headers["user-agent"],
  });
};

export const structuredRequestLogger = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const startTime = process.hrtime.bigint();

  response.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    const logPayload = {
      ...getRequestLogBase(request, response),
      statusCode: response.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    };
    const hasAppCheckMonitorFailure = response.locals["appCheck"]?.result === "failed";
    const hasDependencyFailure =
      Array.isArray(response.locals["requestContext"]?.dependencyFailures) &&
      response.locals["requestContext"].dependencyFailures.length > 0;

    if (response.statusCode >= 500) {
      logger.error(logPayload, "request completed");
      return;
    }

    if (response.statusCode >= 400 || hasAppCheckMonitorFailure || hasDependencyFailure) {
      logger.warn(logPayload, "request completed");
      return;
    }

    logger.info(logPayload, "request completed");
  });

  next();
};

export const logRequestError = (
  response: Response,
  error: unknown,
  statusCode: number,
  errorType: string,
) => {
  const errorObject = error instanceof Error ? error : undefined;
  const errorCode =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const numericErrorCode =
    typeof errorCode === "number"
      ? errorCode
      : typeof errorCode === "string" && errorCode.trim().length > 0
        ? Number(errorCode)
        : undefined;
  const normalizedErrorName = errorObject?.name.toLowerCase() ?? "";
  const normalizedErrorMessage = errorObject?.message.toLowerCase() ?? String(error).toLowerCase();
  let errorSource = "other";
  let errorScope = "application";

  if (
    errorType.startsWith("/database/") ||
    normalizedErrorName.includes("firestore") ||
    normalizedErrorMessage.includes("firestore") ||
    numericErrorCode === 5 ||
    numericErrorCode === 6 ||
    numericErrorCode === 9
  ) {
    errorSource = "firestore";
    errorScope = "query";
  } else if (
    normalizedErrorName.includes("redis") ||
    normalizedErrorMessage.includes("redis") ||
    normalizedErrorMessage.includes("cache connection")
  ) {
    errorSource = "redis";
    errorScope = "cache";
  } else if (statusCode === 401 || statusCode === 403) {
    errorSource = "authorization";
    errorScope = "authorization";
  } else if (statusCode === 400) {
    errorSource = "validation";
    errorScope = "request";
  } else if (statusCode === 404 || statusCode === 409) {
    errorSource = "logic";
    errorScope = "domain";
  }

  const includeStack =
    process.env["NODE_ENV"] !== "production" ||
    process.env["LOG_LEVEL"] === "debug" ||
    process.env["LOG_LEVEL"] === "trace";
  response.locals["requestError"] = {
    statusCode,
    errorType,
    errorName: errorObject?.name ?? "UnknownError",
    errorMessage: errorObject?.message ?? String(error),
    ...(errorCode !== undefined && { errorCode }),
    errorSource,
    errorScope,
    ...(includeStack && errorObject?.stack !== undefined && { stack: errorObject.stack }),
  };
};
