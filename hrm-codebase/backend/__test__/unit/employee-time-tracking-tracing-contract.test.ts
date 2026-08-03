import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_TIME_TRACKING_TRACE_ATTRIBUTE_KEYS,
  EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS,
  EMPLOYEE_TIME_TRACKING_TRACE_EVENTS,
  EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS,
  EMPLOYEE_TIME_TRACKING_TRACE_OUTCOMES,
  EMPLOYEE_TIME_TRACKING_TRACE_SPANS,
  filterEmployeeTimeTrackingTraceAttributes,
  getEmployeeTimeTrackingDurationBucket,
  getEmployeeTimeTrackingTransitionOutcome,
} from "../../src/business/employee/time-tracking/employee-time-tracking-tracing-contract.js";

describe("employee time-tracking tracing contract", () => {
  it("keeps root, child, and event names unique and domain-scoped", () => {
    const names = [
      ...Object.values(EMPLOYEE_TIME_TRACKING_TRACE_SPANS),
      ...Object.values(EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS),
      ...Object.values(EMPLOYEE_TIME_TRACKING_TRACE_EVENTS),
    ];

    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith("employee_time_tracking."))).toBe(true);
    expect(Object.keys(EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS)).toEqual(
      Object.keys(EMPLOYEE_TIME_TRACKING_TRACE_SPANS),
    );
  });

  it("keeps only safe categorical state, booleans, and aggregate counts", () => {
    expect(
      filterEmployeeTimeTrackingTraceAttributes({
        "app.domain": "employee_time_tracking",
        "app.operation": "store_update",
        "app.store_id": "S-1",
        "actor.role": "owner",
        "time_tracking.scope": "store",
        "time_tracking.action": "check_out",
        "time_tracking.work_date": "2026-07-31",
        "time_tracking.current_status": "working",
        "time_tracking.status.after": "completed",
        "time_tracking.pending_checkout_present": false,
        "time_tracking.pending_checkout_count": 0,
        "time_tracking.manual_checkout": true,
        "time_tracking.duration_bucket": "2h_to_8h",
        "time_tracking.roster_employee_count": 8,
        "time_tracking.needs_checkout_count": 2,
        "cache.group_count": 2,
      }),
    ).toEqual({
      "app.domain": "employee_time_tracking",
      "app.operation": "store_update",
      "app.store_id": "S-1",
      "actor.role": "owner",
      "time_tracking.scope": "store",
      "time_tracking.action": "check_out",
      "time_tracking.work_date": "2026-07-31",
      "time_tracking.current_status": "working",
      "time_tracking.status.after": "completed",
      "time_tracking.pending_checkout_present": false,
      "time_tracking.pending_checkout_count": 0,
      "time_tracking.manual_checkout": true,
      "time_tracking.duration_bucket": "2h_to_8h",
      "time_tracking.roster_employee_count": 8,
      "time_tracking.needs_checkout_count": 2,
      "cache.group_count": 2,
    });
  });

  it.each([
    [0, "zero"],
    [119, "under_2h"],
    [120, "2h_to_8h"],
    [480, "2h_to_8h"],
    [481, "8h_to_12h"],
    [720, "8h_to_12h"],
    [721, "over_12h"],
    [-1, undefined],
    [Number.NaN, undefined],
  ] as const)("buckets %s worked minutes safely", (workedMinutes, expectedBucket) => {
    expect(getEmployeeTimeTrackingDurationBucket(workedMinutes)).toBe(expectedBucket);
  });

  it.each([
    [
      { action: "check_in", currentStatus: "missing", pendingCheckoutPresent: true },
      "pending_checkout_required",
    ],
    [{ action: "check_in", currentStatus: "working" }, "already_checked_in"],
    [{ action: "check_in", currentStatus: "completed" }, "already_completed"],
    [{ action: "check_out", currentStatus: "missing" }, "not_checked_in"],
    [{ action: "check_out", currentStatus: "completed" }, "not_checked_in"],
    [
      { action: "check_out", currentStatus: "working", checkoutTimeValid: false },
      "invalid_checkout_time",
    ],
    [{ action: "check_in", currentStatus: "missing" }, undefined],
    [{ action: "check_out", currentStatus: "working", checkoutTimeValid: true }, undefined],
  ] as const)("classifies transition %#", (input, expectedOutcome) => {
    expect(getEmployeeTimeTrackingTransitionOutcome(input)).toBe(expectedOutcome);
  });

  it("rejects protected values, malformed categories, dates, and counts", () => {
    const filtered = filterEmployeeTimeTrackingTraceAttributes({
      "employee.id": "employee-secret",
      "time_tracking.employee_user_id": "employee-secret",
      "time_tracking.checked_in_at": 1_785_000_000_000,
      "time_tracking.checked_out_at": 1_785_000_000_001,
      "time_tracking.worked_minutes": 480,
      "time_tracking.hourly_rate": 20,
      "time_tracking.action": "clock_in",
      "time_tracking.work_date": "31-07-2026",
      "time_tracking.outcome": "raw internal message",
      "time_tracking.pending_checkout_count": -1,
      "time_tracking.roster_employee_count": Number.POSITIVE_INFINITY,
      "time_tracking.manual_checkout": "yes",
      "cache.key": "private-cache-key",
    });

    expect(filtered).toEqual({});
    expect(JSON.stringify(filtered)).not.toContain("secret");
  });

  it("keeps the attribute and outcome contracts free of protected data", () => {
    expect(EMPLOYEE_TIME_TRACKING_TRACE_OUTCOMES).toContain("post_write_failure");

    for (const attributeKey of EMPLOYEE_TIME_TRACKING_TRACE_ATTRIBUTE_KEYS) {
      const normalizedKey = attributeKey.toLowerCase();

      expect(normalizedKey).not.toMatch(/employee.*id/);
      expect(normalizedKey).not.toMatch(/checked.*at|timestamp|worked_minutes|hourly_rate/);
      expect(normalizedKey).not.toMatch(/token|password|authorization/);
      expect(normalizedKey).not.toMatch(/cache.*key/);
      expect(normalizedKey).not.toMatch(/amount|revenue|salary/);
    }
  });
});
