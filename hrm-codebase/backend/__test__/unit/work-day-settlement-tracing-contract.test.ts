import { describe, expect, it } from "vitest";
import {
  WORK_DAY_SETTLEMENT_TRACE_ATTRIBUTE_KEYS,
  WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS,
  WORK_DAY_SETTLEMENT_TRACE_EVENTS,
  WORK_DAY_SETTLEMENT_TRACE_OUTCOMES,
  WORK_DAY_SETTLEMENT_TRACE_SPANS,
  filterWorkDaySettlementTraceAttributes,
} from "../../src/business/employee/work-days/work-day-settlement-tracing-contract.js";

describe("work-day settlement tracing contract", () => {
  it("keeps root, child, and event names unique and domain-scoped", () => {
    const allNames = [
      ...Object.values(WORK_DAY_SETTLEMENT_TRACE_SPANS),
      ...Object.values(WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS),
      ...Object.values(WORK_DAY_SETTLEMENT_TRACE_EVENTS),
    ];

    expect(new Set(allNames).size).toBe(allNames.length);
    expect(allNames.every((name) => name.startsWith("work_day_settlement."))).toBe(true);
  });

  it("allows safe categorical values and aggregate counts", () => {
    expect(
      filterWorkDaySettlementTraceAttributes({
        "app.domain": "work_day_settlement",
        "app.operation": "store_close",
        "app.store_id": "S-1",
        "actor.role": "owner",
        "settlement.work_date": "2026-07-30",
        "settlement.scope": "store",
        "settlement.outcome": "success",
        "settlement.attendance_count": 3,
        "settlement.pending_employee_count": 0,
        "settlement.cache_group_count": 5,
        "settlement.employee_compensation_model": "hourly",
        "settlement.aggregate_present": true,
        "settlement.attendance_snapshot_changed": false,
      }),
    ).toEqual({
      "app.domain": "work_day_settlement",
      "app.operation": "store_close",
      "app.store_id": "S-1",
      "actor.role": "owner",
      "settlement.work_date": "2026-07-30",
      "settlement.scope": "store",
      "settlement.outcome": "success",
      "settlement.attendance_count": 3,
      "settlement.pending_employee_count": 0,
      "settlement.cache_group_count": 5,
      "settlement.employee_compensation_model": "hourly",
      "settlement.aggregate_present": true,
      "settlement.attendance_snapshot_changed": false,
    });
  });

  it("rejects protected values, invalid enums, malformed dates, and non-finite counts", () => {
    const filtered = filterWorkDaySettlementTraceAttributes({
      "employee.id": "employee-secret",
      "settlement.attendance_ids": ["attendance-secret"],
      "settlement.outcome": "raw-error-message",
      "settlement.work_date": "30-07-2026",
      "settlement.attendance_count": Number.POSITIVE_INFINITY,
      "settlement.pending_employee_count": -1,
      "settlement.employee_compensation_model": "monthly",
      "settlement.compensation_config_snapshot_changed": "yes",
      "settlement.persist_action": "replace",
      "customer.phone": "+4915112345678",
    });

    expect(filtered).toEqual({});
    expect(JSON.stringify(filtered)).not.toContain("secret");
  });

  it("keeps the outcome contract free of raw messages", () => {
    expect(WORK_DAY_SETTLEMENT_TRACE_OUTCOMES).not.toContain("internal error");
    expect(WORK_DAY_SETTLEMENT_TRACE_OUTCOMES).toContain("post_write_failure");
  });

  it("does not allow PII, credentials, raw IDs, money, or payload keys", () => {
    for (const attributeKey of WORK_DAY_SETTLEMENT_TRACE_ATTRIBUTE_KEYS) {
      const normalizedKey = attributeKey.toLowerCase();

      expect(normalizedKey).not.toMatch(/customer.*(name|phone|email)/);
      expect(normalizedKey).not.toMatch(/employee.*id/);
      expect(normalizedKey).not.toMatch(/attendance.*id/);
      expect(normalizedKey).not.toMatch(/booking.*id/);
      expect(normalizedKey).not.toMatch(/token|password|authorization/);
      expect(normalizedKey).not.toMatch(/amount|revenue|salary/);
    }
  });
});
