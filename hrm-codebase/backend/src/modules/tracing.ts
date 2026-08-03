import { Span, SpanStatusCode, context, isSpanContextValid, trace } from "@opentelemetry/api";

export type AppSpanAttributeValue = string | number | boolean;

export type AppSpanAttributes = Record<string, AppSpanAttributeValue | undefined>;

type WithAppSpanOptions = {
  markSuccessfulHandlerAsOk?: boolean;
  recordException?: boolean;
};

export type TraceContextIds = {
  traceId?: string;
  spanId?: string;
};

const TRACEPARENT_PATTERN = /^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/i;

const isNonZeroHex = (value: string) => !/^0+$/i.test(value);

export const parseTraceparentHeader = (value: unknown): TraceContextIds => {
  const headerValue = Array.isArray(value) ? value[0] : value;

  if (typeof headerValue !== "string") {
    return {};
  }

  const match = TRACEPARENT_PATTERN.exec(headerValue.trim());
  const traceId = match?.[1]?.toLowerCase();
  const spanId = match?.[2]?.toLowerCase();

  if (!traceId || !spanId || !isNonZeroHex(traceId) || !isNonZeroHex(spanId)) {
    return {};
  }

  return { traceId, spanId };
};

export const getActiveTraceContextIds = (): TraceContextIds => {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();

  if (spanContext && isSpanContextValid(spanContext)) {
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };
  }

  return {};
};

export const getRequestTraceContextIds = (traceparentHeader: unknown): TraceContextIds => {
  const activeTrace = getActiveTraceContextIds();

  if (activeTrace.traceId) {
    return activeTrace;
  }

  return parseTraceparentHeader(traceparentHeader);
};

export const setAppSpanAttributes = (span: Span, attributes: AppSpanAttributes) => {
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined) {
      span.setAttribute(key, value);
    }
  });
};

export const withAppSpan = async <T>(
  name: string,
  attributes: AppSpanAttributes,
  handler: (span: Span) => Promise<T>,
  options: WithAppSpanOptions = {},
): Promise<T> => {
  const tracer = trace.getTracer(process.env["OTEL_SERVICE_NAME"] ?? "nail-salon-backend");

  return tracer.startActiveSpan(name, async (span) => {
    setAppSpanAttributes(span, attributes);

    try {
      const result = await handler(span);

      if (options.markSuccessfulHandlerAsOk !== false) {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      return result;
    } catch (error) {
      if (options.recordException !== false && error instanceof Error) {
        span.recordException(error);
      }

      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
};
