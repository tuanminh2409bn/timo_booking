import { SpanStatusCode, type Span } from "@opentelemetry/api";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  completeBusinessSpan,
  resolveBusinessSpanCompletion,
} from "../../src/modules/business-observability.js";

const createResponse = (
  statusCode: number,
  requestError?: Record<string, unknown>,
): Pick<Response, "locals" | "statusCode"> => ({
  statusCode,
  locals: requestError === undefined ? {} : { requestError },
});

const createSpanRecorder = () => {
  const attributes = new Map<string, unknown>();
  const setStatus = vi.fn();
  const span = {
    setAttribute: (key: string, value: unknown) => {
      attributes.set(key, value);
      return span;
    },
    setStatus,
  } as unknown as Span;

  return { attributes, setStatus, span };
};

describe("business observability span completion", () => {
  it("marks a successful response as success", () => {
    const completion = resolveBusinessSpanCompletion(createResponse(200));

    expect(completion).toEqual({
      statusCode: 200,
      outcome: "success",
      spanStatusCode: SpanStatusCode.OK,
    });
  });

  it("marks handled 4xx responses as rejected instead of successful", () => {
    const recorder = createSpanRecorder();
    const response = createResponse(409, {
      errorType: "/stores/attendances/work-day-already-closed",
      errorSource: "logic",
      errorScope: "domain",
      errorContext: {
        customerPhone: "+4915112345678",
      },
    });

    completeBusinessSpan(recorder.span, response);

    expect(Object.fromEntries(recorder.attributes)).toEqual({
      "app.response_status_code": 409,
      "app.outcome": "rejected",
      "app.outcome_reason": "/stores/attendances/work-day-already-closed",
      "app.error_source": "logic",
      "app.error_scope": "domain",
    });
    expect(recorder.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.UNSET });
    expect(Array.from(recorder.attributes.keys())).not.toContain("customerPhone");
  });

  it("marks handled 5xx responses as failures", () => {
    const recorder = createSpanRecorder();

    completeBusinessSpan(
      recorder.span,
      createResponse(500, {
        errorType: "/internal-server-error",
        errorSource: "other",
        errorScope: "application",
      }),
    );

    expect(recorder.attributes.get("app.outcome")).toBe("failure");
    expect(recorder.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "/internal-server-error",
    });
  });

  it("does not copy request error metadata onto successful responses", () => {
    const recorder = createSpanRecorder();

    completeBusinessSpan(
      recorder.span,
      createResponse(200, {
        errorType: "/stale-request-error",
        errorSource: "logic",
        errorScope: "domain",
      }),
    );

    expect(Object.fromEntries(recorder.attributes)).toEqual({
      "app.response_status_code": 200,
      "app.outcome": "success",
    });
  });

  it("uses a safe HTTP fallback when no structured request error exists", () => {
    expect(resolveBusinessSpanCompletion(createResponse(403))).toEqual({
      statusCode: 403,
      outcome: "rejected",
      spanStatusCode: SpanStatusCode.UNSET,
      outcomeReason: "http_403",
    });
  });
});
