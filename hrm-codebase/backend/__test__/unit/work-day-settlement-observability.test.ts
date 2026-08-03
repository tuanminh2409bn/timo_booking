import { trace, type Span, type Tracer } from "@opentelemetry/api";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getEmployeeClosingTraceStatus,
  getEmployeeTimeTrackingTraceStatus,
  getStoreCloseInvalidStateTraceOutcome,
  getWorkDaySettlementCompletionTraceAttributes,
  getWorkDaySettlementRootSpanAttributes,
  markWorkDaySettlementPostWriteFailure,
  observeWorkDaySettlementHandler,
  setWorkDaySettlementTraceOutcome,
} from "../../src/business/employee/work-days/work-day-settlement-observability.js";
import {
  WORK_DAY_SETTLEMENT_TRACE_OPERATIONS,
  WORK_DAY_SETTLEMENT_TRACE_SPANS,
} from "../../src/business/employee/work-days/work-day-settlement-tracing-contract.js";
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

describe("work-day settlement observability", () => {
  it.each([
    ["commission", null, "not_required"],
    ["fixed", { status: "working" }, "not_required"],
    ["hourly", null, "missing"],
    ["hourly", { status: "working" }, "working"],
    ["hourly", { status: "completed" }, "completed"],
  ] as const)(
    "classifies employee time tracking for %s compensation",
    (compensationModel, timeTrackingSession, expectedStatus) => {
      expect(getEmployeeTimeTrackingTraceStatus(compensationModel, timeTrackingSession)).toBe(
        expectedStatus,
      );
    },
  );

  it("classifies employee closing snapshots without exporting their identifiers", () => {
    const attendanceIds = ["attendance-1", "attendance-2"];
    const attendanceVersions = { "attendance-1": 10, "attendance-2": 20 };

    expect(getEmployeeClosingTraceStatus(null, attendanceIds, attendanceVersions)).toBe("missing");
    expect(
      getEmployeeClosingTraceStatus(
        {
          attendanceIds: ["attendance-2", "attendance-1"],
          attendanceVersions,
        },
        attendanceIds,
        attendanceVersions,
      ),
    ).toBe("current");
    expect(
      getEmployeeClosingTraceStatus(
        {
          attendanceIds,
          attendanceVersions: { ...attendanceVersions, "attendance-2": 19 },
        },
        attendanceIds,
        attendanceVersions,
      ),
    ).toBe("stale");
    expect(
      getEmployeeClosingTraceStatus(
        {
          attendanceIds: ["attendance-1"],
          attendanceVersions: { "attendance-1": 10 },
        },
        attendanceIds,
        attendanceVersions,
      ),
    ).toBe("stale");
  });

  it("keeps stable root attributes authoritative", () => {
    const request = {
      params: { storeId: "S-1" },
      query: {},
      body: { workDate: "2026-07-30" },
    } as unknown as Request;

    expect(
      getWorkDaySettlementRootSpanAttributes(request, {
        operation: "store_close",
        getAttributes: () => ({
          "app.domain": "other",
          "app.operation": "employee_close",
          "app.store_id": "S-2",
        }),
      }),
    ).toEqual({
      "app.domain": "work_day_settlement",
      "app.operation": "store_close",
      "app.store_id": "S-1",
      "settlement.scope": "store",
      "settlement.work_date": "2026-07-30",
    });
  });

  it("maps handled employee close errors to categorical outcomes", () => {
    expect(
      getWorkDaySettlementCompletionTraceAttributes(
        createResponse(409, {
          errorType: "/me/work-day-closings/checkout-required",
        }),
      ),
    ).toEqual({ "settlement.outcome": "check_out_required" });
  });

  it("maps store close conflicts without copying error context", () => {
    expect(
      getWorkDaySettlementCompletionTraceAttributes(
        createResponse(409, {
          errorType: "/stores/work-day-settlements/work-day-has-open-attendance",
          errorContext: { pendingEmployeeUserIds: ["employee-secret"] },
        }),
      ),
    ).toEqual({ "settlement.outcome": "employee_closing_pending" });
  });

  it("preserves an explicit post-write failure over the HTTP status", () => {
    const response = createResponse(200);

    setWorkDaySettlementTraceOutcome(response, "success");
    markWorkDaySettlementPostWriteFailure(response, "audit");

    expect(response.locals["settlementTraceOutcome"]).toBe("post_write_failure");
    expect(getWorkDaySettlementCompletionTraceAttributes(response)).toEqual({
      "settlement.outcome": "post_write_failure",
    });
  });

  it("does not invent a domain outcome for an unknown error", () => {
    expect(
      getWorkDaySettlementCompletionTraceAttributes(
        createResponse(409, { errorType: "/stores/unknown-conflict" }),
      ),
    ).toEqual({});
  });

  it("classifies handled server failures as dependency failures", () => {
    expect(
      getWorkDaySettlementCompletionTraceAttributes(
        createResponse(500, { errorType: "/internal-server-error" }),
      ),
    ).toEqual({ "settlement.outcome": "dependency_failure" });
    expect(getWorkDaySettlementCompletionTraceAttributes(createResponse(503))).toEqual({
      "settlement.outcome": "dependency_failure",
    });
  });

  it.each([
    [{ attendanceCount: 0 }, "no_attendance"],
    [{ attendanceCount: 1, incompleteAttendanceCount: 1 }, "attendance_incomplete"],
    [{ attendanceCount: 1, compensationErrorCount: 1 }, "compensation_incomplete"],
    [{ attendanceCount: 1, discountAllocationInvalid: true }, "discount_allocation_invalid"],
    [{ attendanceCount: 1, negativeEmployeeEarning: true }, "negative_employee_earning"],
  ] as const)("classifies store close invalid state %#", (input, expectedOutcome) => {
    expect(getStoreCloseInvalidStateTraceOutcome(input)).toBe(expectedOutcome);
  });

  it("does not classify a ready store close as invalid", () => {
    expect(getStoreCloseInvalidStateTraceOutcome({ attendanceCount: 1 })).toBeUndefined();
  });

  it("marks unhandled exceptions as dependency failures without recording raw exceptions", async () => {
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

    const handler = observeWorkDaySettlementHandler(
      {
        eventName: "work_day.close",
        operation: WORK_DAY_SETTLEMENT_TRACE_OPERATIONS.storeClose,
        route: "/api/v1/stores/:storeId/work-day-settlements",
        spanName: WORK_DAY_SETTLEMENT_TRACE_SPANS.storeClose,
      },
      async () => {
        throw new Error("protected-internal-message");
      },
    );
    const request = {
      body: { workDate: "2026-07-31" },
      params: { storeId: "S-1" },
      query: {},
    } as unknown as Request;
    const response = createResponse(200);

    await expect(
      runWithRequestContext({ role: "owner" }, () => handler(request, response as Response)),
    ).rejects.toThrow("protected-internal-message");

    expect(attributes.get("settlement.outcome")).toBe("dependency_failure");
    expect(attributes.get("actor.role")).toBe("owner");
    expect(recordException).not.toHaveBeenCalled();
  });
});
