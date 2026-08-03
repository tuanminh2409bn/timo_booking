import { trace, type Span, type Tracer } from "@opentelemetry/api";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addActiveDataRetentionSpanEvent,
  getDataRetentionCompletionTraceAttributes,
  getDataRetentionJobRootSpanAttributes,
  getDataRetentionRootSpanAttributes,
  markDataRetentionPostWriteFailure,
  setActiveDataRetentionSpanAttributes,
  withDataRetentionSpan,
} from "../../src/business/data-retention/data-retention-observability.js";
import {
  DATA_RETENTION_TRACE_EVENTS,
  DATA_RETENTION_TRACE_CHILD_SPANS,
  DATA_RETENTION_TRACE_OPERATIONS,
  type DataRetentionTraceAttributes,
} from "../../src/business/data-retention/data-retention-tracing-contract.js";
import { logger } from "../../src/modules/logger.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("data retention observability", () => {
  it("builds safe HTTP and job root attributes", () => {
    const request = {
      params: { storeId: "S-1" },
      body: {},
      query: {},
    } as unknown as Request;

    expect(
      getDataRetentionRootSpanAttributes(request, {
        operation: DATA_RETENTION_TRACE_OPERATIONS.planUpdate,
        getAttributes: () => ({
          "retention.plan": "premium",
          "retention.plan_changed": true,
        }),
      }),
    ).toEqual({
      "app.domain": "data_retention",
      "app.operation": "plan_update",
      "app.store_id": "S-1",
      "retention.plan": "premium",
      "retention.plan_changed": true,
    });

    expect(
      getDataRetentionJobRootSpanAttributes({
        executionMode: "execute",
        batchSize: 200,
      }),
    ).toEqual({
      "app.domain": "data_retention",
      "app.operation": "job_run",
      "actor.role": "system",
      "retention.execution_mode": "execute",
      "retention.batch_size": 200,
    });

    expect(
      getDataRetentionRootSpanAttributes(
        { params: {}, body: {}, query: {} } as unknown as Request,
        {
          operation: DATA_RETENTION_TRACE_OPERATIONS.planRead,
          getAttributes: () => ({
            "app.domain": "other",
            "app.operation": "job_run",
            "app.store_id": "S-2",
          }),
        },
      ),
    ).toEqual({
      "app.domain": "data_retention",
      "app.operation": "plan_read",
    });
  });

  it("maps handled errors and preserves explicit post-write failure context", () => {
    const forbiddenResponse = {
      statusCode: 403,
      locals: {
        requestError: {
          errorType: "/account/data-retention-plan/forbidden",
          errorContext: { ownerId: "owner-secret" },
        },
      },
    } as Pick<Response, "locals" | "statusCode">;

    expect(getDataRetentionCompletionTraceAttributes(forbiddenResponse)).toEqual({
      "retention.outcome": "forbidden_role",
    });

    const postWriteResponse = {
      statusCode: 500,
      locals: {},
    } as Pick<Response, "locals" | "statusCode">;

    markDataRetentionPostWriteFailure(postWriteResponse, "audit", "policy_updated");

    expect(getDataRetentionCompletionTraceAttributes(postWriteResponse)).toEqual({
      "retention.outcome": "post_write_failure",
      "retention.failure_phase": "audit",
      "retention.last_committed_stage": "policy_updated",
    });
  });

  it("filters active span attributes and events at the trace boundary", () => {
    const attributes = new Map<string, unknown>();
    const addEvent = vi.fn();
    const span = {
      addEvent,
      setAttribute: (key: string, value: unknown) => {
        attributes.set(key, value);
        return span;
      },
    } as unknown as Span;

    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    setActiveDataRetentionSpanAttributes({
      "retention.candidate_count": 5,
      "retention.current_work_date": "2026-07-31",
      "owner.id": "owner-secret",
    } as unknown as DataRetentionTraceAttributes);
    addActiveDataRetentionSpanEvent(DATA_RETENTION_TRACE_EVENTS.attendanceBatchCommitted, {
      "retention.batch_count": 1,
      "attendance.id": "attendance-secret",
    } as unknown as DataRetentionTraceAttributes);

    expect(Object.fromEntries(attributes)).toEqual({
      "retention.candidate_count": 5,
      "retention.current_work_date": "2026-07-31",
    });
    expect(addEvent).toHaveBeenCalledWith(DATA_RETENTION_TRACE_EVENTS.attendanceBatchCommitted, {
      "retention.batch_count": 1,
    });
  });

  it("keeps active-span failures silent and non-throwing", () => {
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");
    const error = vi.spyOn(logger, "error");

    vi.spyOn(trace, "getActiveSpan").mockImplementation(() => {
      throw new Error("telemetry unavailable");
    });

    expect(() =>
      setActiveDataRetentionSpanAttributes({ "retention.outcome": "success" }),
    ).not.toThrow();
    expect(() =>
      addActiveDataRetentionSpanEvent(DATA_RETENTION_TRACE_EVENTS.policyCommitted),
    ).not.toThrow();
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("preserves child handler failures without recording raw exceptions", async () => {
    const recordException = vi.fn();
    const span = {
      end: vi.fn(),
      recordException,
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
    } as unknown as Span;
    const tracer = {
      startActiveSpan: (_name: string, handler: (activeSpan: Span) => unknown) => handler(span),
    } as unknown as Tracer;

    vi.spyOn(trace, "getTracer").mockReturnValue(tracer);

    await expect(
      withDataRetentionSpan(
        DATA_RETENTION_TRACE_CHILD_SPANS.policyLoad,
        { "retention.plan": "standard" },
        async () => {
          throw new Error("protected repository error");
        },
      ),
    ).rejects.toThrow("protected repository error");
    expect(recordException).not.toHaveBeenCalled();
  });
});
