import { trace, type Span, type Tracer } from "@opentelemetry/api";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addActiveEmployeeTimeTrackingSpanEvent,
  getEmployeeTimeTrackingCompletionTraceAttributes,
  getEmployeeTimeTrackingRootSpanAttributes,
  markEmployeeTimeTrackingPostWriteFailure,
  observeEmployeeTimeTrackingHandler,
  observeEmployeeTimeTrackingCommit,
  setEmployeeTimeTrackingTraceOutcome,
  withEmployeeTimeTrackingSpan,
} from "../../src/business/employee/time-tracking/employee-time-tracking-observability.js";
import {
  EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS,
  EMPLOYEE_TIME_TRACKING_TRACE_EVENTS,
  EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS,
  EMPLOYEE_TIME_TRACKING_TRACE_SPANS,
  type EmployeeTimeTrackingTraceAttributes,
} from "../../src/business/employee/time-tracking/employee-time-tracking-tracing-contract.js";
import { logger } from "../../src/modules/logger.js";
import { runWithRequestContext } from "../../src/modules/request-context.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const createResponse = (
  statusCode: number,
  requestError?: Record<string, unknown>,
): Pick<Response, "locals" | "statusCode"> => ({
  statusCode,
  locals: requestError === undefined ? {} : { requestError },
});

describe("employee time-tracking observability", () => {
  it("keeps stable root attributes authoritative", () => {
    const request = {
      body: { action: "check_out", workDate: "2026-07-31" },
      params: { storeId: "S-1" },
      query: {},
    } as unknown as Request;

    expect(
      getEmployeeTimeTrackingRootSpanAttributes(request, {
        operation: EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS.storeUpdate,
        getAttributes: () => ({
          "app.domain": "other",
          "app.operation": "self_read",
          "app.store_id": "S-2",
          "time_tracking.scope": "self",
        }),
      }),
    ).toEqual({
      "app.domain": "employee_time_tracking",
      "app.operation": "store_update",
      "app.store_id": "S-1",
      "time_tracking.scope": "store",
      "time_tracking.action": "check_out",
      "time_tracking.work_date": "2026-07-31",
      "time_tracking.manual_checkout": false,
    });
  });

  it("maps handled request errors without copying their context", () => {
    expect(
      getEmployeeTimeTrackingCompletionTraceAttributes(
        createResponse(400, {
          errorType: "/me/time-tracking/invalid-request",
          errorContext: {
            employeeUserId: "employee-secret",
            checkedOutAt: 1_785_000_000_000,
          },
        }),
      ),
    ).toEqual({ "time_tracking.outcome": "invalid_payload" });
  });

  it("preserves an explicit conflict outcome over the shared conflict error type", () => {
    const response = createResponse(409, {
      errorType: "/me/time-tracking/conflict",
    });

    setEmployeeTimeTrackingTraceOutcome(response, "already_checked_in");

    expect(getEmployeeTimeTrackingCompletionTraceAttributes(response)).toEqual({
      "time_tracking.outcome": "already_checked_in",
    });
  });

  it("does not invent a domain outcome for an unknown client error", () => {
    expect(
      getEmployeeTimeTrackingCompletionTraceAttributes(
        createResponse(409, { errorType: "/me/time-tracking/conflict" }),
      ),
    ).toEqual({});
  });

  it("does not invent a reason for the shared forbidden error", () => {
    expect(
      getEmployeeTimeTrackingCompletionTraceAttributes(
        createResponse(403, { errorType: "/me/time-tracking/forbidden" }),
      ),
    ).toEqual({});
  });

  it("classifies server failures as dependency failures", () => {
    expect(getEmployeeTimeTrackingCompletionTraceAttributes(createResponse(503))).toEqual({
      "time_tracking.outcome": "dependency_failure",
    });
  });

  it("preserves an explicit post-write failure over the HTTP status", () => {
    const response = createResponse(200);

    setEmployeeTimeTrackingTraceOutcome(response, "success");
    markEmployeeTimeTrackingPostWriteFailure(response, "audit");

    expect(response.locals["timeTrackingTraceOutcome"]).toBe("post_write_failure");
    expect(getEmployeeTimeTrackingCompletionTraceAttributes(response)).toEqual({
      "time_tracking.outcome": "post_write_failure",
      "time_tracking.post_write_phase": "audit",
    });
  });

  it("marks unhandled exceptions without recording protected error details", async () => {
    const attributes = new Map<string, unknown>();
    const recordException = vi.fn();
    const span = {
      end: vi.fn(),
      recordException,
      setAttribute: (key: string, value: unknown) => {
        attributes.set(key, value);
        return span;
      },
      setStatus: vi.fn(),
      spanContext: () => ({
        traceId: "1".repeat(32),
        spanId: "2".repeat(16),
        traceFlags: 1,
      }),
    } as unknown as Span;
    const tracer = {
      startActiveSpan: (_name: string, handler: (activeSpan: Span) => unknown) => handler(span),
    } as unknown as Tracer;

    vi.spyOn(trace, "getTracer").mockReturnValue(tracer);
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    const handler = observeEmployeeTimeTrackingHandler(
      {
        eventName: "employee.time_tracking.update",
        operation: EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS.storeUpdate,
        route: "/api/v1/stores/:storeId/employee-time-tracking/:employeeUserId",
        spanName: EMPLOYEE_TIME_TRACKING_TRACE_SPANS.storeUpdate,
      },
      async () => {
        throw new Error("protected-internal-message");
      },
    );
    const request = {
      body: { action: "check_in", workDate: "2026-07-31" },
      params: { storeId: "S-1" },
      query: {},
    } as unknown as Request;
    const response = createResponse(200);

    await expect(
      runWithRequestContext({ role: "owner" }, () => handler(request, response as Response)),
    ).rejects.toThrow("protected-internal-message");

    expect(attributes.get("time_tracking.outcome")).toBe("dependency_failure");
    expect(attributes.get("actor.role")).toBe("owner");
    expect(recordException).not.toHaveBeenCalled();
    expect(JSON.stringify(Object.fromEntries(attributes))).not.toContain(
      "protected-internal-message",
    );
  });

  it("keeps raw exceptions out of time-tracking child spans", async () => {
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
      withEmployeeTimeTrackingSpan(
        EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.contextLoad,
        { "time_tracking.current_status": "working" },
        async () => {
          throw new Error("protected-child-error");
        },
      ),
    ).rejects.toThrow("protected-child-error");

    expect(recordException).not.toHaveBeenCalled();
  });

  it("filters commit event attributes before adding them to the active span", () => {
    const addEvent = vi.fn();
    const span = { addEvent } as unknown as Span;

    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    addActiveEmployeeTimeTrackingSpanEvent(EMPLOYEE_TIME_TRACKING_TRACE_EVENTS.sessionCommitted, {
      "time_tracking.persist_action": "create",
      "employee.id": "protected-employee-id",
    } as unknown as EmployeeTimeTrackingTraceAttributes);

    expect(addEvent).toHaveBeenCalledWith(EMPLOYEE_TIME_TRACKING_TRACE_EVENTS.sessionCommitted, {
      "time_tracking.persist_action": "create",
    });
  });

  it("records the committed transition as safe attributes and one event", () => {
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

    observeEmployeeTimeTrackingCommit({
      action: "check_out",
      persistAction: "update",
      statusBefore: "working",
      statusAfter: "completed",
      storeId: "store-1",
      workDate: "2026-07-31",
    });

    expect(Object.fromEntries(attributes)).toEqual({
      "app.store_id": "store-1",
      "time_tracking.action": "check_out",
      "time_tracking.work_date": "2026-07-31",
      "time_tracking.status.before": "working",
      "time_tracking.status.after": "completed",
      "time_tracking.persist_action": "update",
      "time_tracking.last_committed_stage": "session",
    });
    expect(addEvent).toHaveBeenCalledWith(
      "employee_time_tracking.session_committed",
      expect.objectContaining({
        "time_tracking.action": "check_out",
        "time_tracking.status.before": "working",
        "time_tracking.status.after": "completed",
      }),
    );
  });

  it("reuses request completion logging instead of emitting domain logs", async () => {
    const span = {
      end: vi.fn(),
      recordException: vi.fn(),
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      spanContext: () => ({
        traceId: "1".repeat(32),
        spanId: "2".repeat(16),
        traceFlags: 1,
      }),
    } as unknown as Span;
    const tracer = {
      startActiveSpan: (_name: string, handler: (activeSpan: Span) => unknown) => handler(span),
    } as unknown as Tracer;
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");
    const error = vi.spyOn(logger, "error");

    vi.spyOn(trace, "getTracer").mockReturnValue(tracer);
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    const handler = observeEmployeeTimeTrackingHandler(
      {
        eventName: "employee.time_tracking.read",
        operation: EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS.selfRead,
        route: "/api/v1/me/time-tracking",
        spanName: EMPLOYEE_TIME_TRACKING_TRACE_SPANS.selfRead,
      },
      async () => undefined,
    );
    const request = {
      body: {},
      params: {},
      query: { workDate: "2026-07-31" },
    } as unknown as Request;
    const response = createResponse(200);

    await handler(request, response as Response);

    expect(response.locals["businessEvent"]).toBe("employee.time_tracking.read");
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
