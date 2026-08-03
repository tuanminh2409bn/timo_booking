import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_TRACE_ATTRIBUTE_KEYS,
  ATTENDANCE_TRACE_CHILD_SPANS,
  ATTENDANCE_TRACE_EVENTS,
  ATTENDANCE_TRACE_OPERATIONS,
  ATTENDANCE_TRACE_SPANS,
  filterAttendanceTraceAttributes,
} from "../../src/business/employee/attendance/attendance-tracing-contract.js";

describe("attendance tracing contract", () => {
  it("keeps span names stable and scoped to attendance", () => {
    expect(new Set(Object.values(ATTENDANCE_TRACE_SPANS)).size).toBe(
      Object.values(ATTENDANCE_TRACE_SPANS).length,
    );
    expect(Object.values(ATTENDANCE_TRACE_SPANS)).toEqual(
      expect.arrayContaining([
        "attendance.create",
        "attendance.update",
        "attendance.backfill",
        "attendance.delete",
        "attendance.calendar.read",
      ]),
    );
  });

  it("defines one stable operation for every root span", () => {
    expect(Object.keys(ATTENDANCE_TRACE_OPERATIONS)).toEqual(Object.keys(ATTENDANCE_TRACE_SPANS));
    expect(new Set(Object.values(ATTENDANCE_TRACE_OPERATIONS)).size).toBe(
      Object.values(ATTENDANCE_TRACE_OPERATIONS).length,
    );
  });

  it("defines stable Phase 2 child spans and commit events", () => {
    expect(Object.values(ATTENDANCE_TRACE_CHILD_SPANS)).toEqual(
      expect.arrayContaining([
        "attendance.load",
        "attendance.context.load",
        "attendance.persist",
        "attendance.settlement.sync",
        "attendance.audit.write",
        "attendance.read.source",
        "attendance.cache.read",
        "attendance.query",
        "attendance.cache.invalidate.detached",
      ]),
    );
    expect(ATTENDANCE_TRACE_EVENTS.writeCommitted).toBe("attendance.write_committed");
    expect(ATTENDANCE_TRACE_EVENTS.cacheInvalidationScheduled).toBe(
      "attendance.cache_invalidation_scheduled",
    );
  });

  it("filters attributes through the attendance allowlist", () => {
    expect(
      filterAttendanceTraceAttributes({
        "attendance.service_count": 2,
        "attendance.quick_draft": true,
        "attendance.calendar.view": "week",
        "attendance.date_range.start": "2026-07-27",
        "attendance.date_range.end": "2026-08-02",
        "attendance.returned_count": 3,
        "cache.status": "hit",
        "cache.single_flight_role": "leader",
        "query.strategy": "full_scan_fallback",
        "customer.phone": "+4915112345678",
        "customer.name": "Private customer",
        "attendance.note": "Private note",
        "attendance.total_amount": 100,
        "auth.token": "secret",
      }),
    ).toEqual({
      "attendance.service_count": 2,
      "attendance.quick_draft": true,
      "attendance.calendar.view": "week",
      "attendance.date_range.start": "2026-07-27",
      "attendance.date_range.end": "2026-08-02",
      "attendance.returned_count": 3,
      "cache.status": "hit",
      "cache.single_flight_role": "leader",
      "query.strategy": "full_scan_fallback",
    });
  });

  it("rejects unsupported and non-finite attribute values", () => {
    expect(
      filterAttendanceTraceAttributes({
        "attendance.service_count": Number.NaN,
        "booking.sibling_count": Number.POSITIVE_INFINITY,
        "attendance.quick_draft": [true],
        "attendance.source": { value: "walk_in" },
      }),
    ).toEqual({});
  });

  it("does not allow PII, credentials, notes, or money keys", () => {
    for (const attributeKey of ATTENDANCE_TRACE_ATTRIBUTE_KEYS) {
      const normalizedKey = attributeKey.toLowerCase();

      expect(normalizedKey).not.toMatch(/customer.*(name|phone|email)/);
      expect(normalizedKey).not.toMatch(/token|password|authorization/);
      expect(normalizedKey).not.toMatch(/note|amount|revenue|salary|discount/);
      expect(normalizedKey).not.toMatch(/employee.*id/);
    }
  });
});
