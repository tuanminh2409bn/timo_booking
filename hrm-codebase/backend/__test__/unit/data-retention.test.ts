import { describe, expect, it } from "vitest";
import {
  addUtcCalendarMonths,
  resolveStandardRetentionCutoffWorkDate,
  subtractWorkDateCalendarMonths,
} from "../../src/helpers/data-retention.js";
import { incrementArchivedAttendanceCounter } from "../../src/repository/firestore/data-retention/data-retention.repository.js";

const emptyCounters = () => ({
  totalAppointments: 0,
  requestedAppointments: 0,
  confirmedAppointments: 0,
  processingAppointments: 0,
  cancelledAppointments: 0,
  noShowAppointments: 0,
});

describe("data retention dates", () => {
  it("subtracts two calendar months without overflowing month-end dates", () => {
    expect(subtractWorkDateCalendarMonths("2026-03-31", 2)).toBe("2026-01-31");
    expect(subtractWorkDateCalendarMonths("2026-04-30", 2)).toBe("2026-02-28");
    expect(subtractWorkDateCalendarMonths("2024-04-30", 2)).toBe("2024-02-29");
    expect(subtractWorkDateCalendarMonths("2026-01-15", 2)).toBe("2025-11-15");
  });

  it("preserves the wall-clock time when calculating downgrade grace", () => {
    const timestamp = Date.parse("2026-01-31T10:20:30.456Z");

    expect(new Date(addUtcCalendarMonths(timestamp, 2)).toISOString()).toBe(
      "2026-03-31T10:20:30.456Z",
    );
  });

  it("keeps records on or after the cutoff, including all future records", () => {
    const cutoff = resolveStandardRetentionCutoffWorkDate("2026-07-28");

    expect(cutoff).toBe("2026-05-28");
    expect("2026-05-27" < cutoff).toBe(true);
    expect("2026-05-28" < cutoff).toBe(false);
    expect("2026-08-01" < cutoff).toBe(false);
  });
});

describe("archived customer counters", () => {
  it("classifies deleted appointment details without reducing lifetime totals", () => {
    const counters = emptyCounters();

    incrementArchivedAttendanceCounter(counters, "requested");
    incrementArchivedAttendanceCounter(counters, "confirmed");
    incrementArchivedAttendanceCounter(counters, "processing");
    incrementArchivedAttendanceCounter(counters, "cancelled");
    incrementArchivedAttendanceCounter(counters, "no_show");

    expect(counters).toEqual({
      totalAppointments: 5,
      requestedAppointments: 1,
      confirmedAppointments: 1,
      processingAppointments: 1,
      cancelledAppointments: 1,
      noShowAppointments: 1,
    });
  });
});
