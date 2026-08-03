import { describe, expect, it } from "vitest";
import {
  resolveStaffAttendanceSource,
  resolveStoredAttendanceSource,
  toAttendanceActorRole,
} from "../../src/business/employee/domain/attendance-origin.js";

const baseAttendance = {
  workDate: "2026-07-28",
  startTime: 9 * 60,
  storeTimezone: "Asia/Ho_Chi_Minh",
  settlementCutoffTime: "04:00",
};

describe("attendance origin", () => {
  it("classifies staff-created future records as manual bookings and elapsed records as walk-ins", () => {
    const createdAt = Date.parse("2026-07-28T01:00:00.000Z");

    expect(
      resolveStaffAttendanceSource(
        { ...baseAttendance, startTimestamp: Date.parse("2026-07-28T03:00:00.000Z") },
        createdAt,
      ),
    ).toBe("manual_booking");
    expect(
      resolveStaffAttendanceSource(
        { ...baseAttendance, startTimestamp: Date.parse("2026-07-28T00:30:00.000Z") },
        createdAt,
      ),
    ).toBe("walk_in");
  });

  it("normalizes legacy records without overwriting explicit sources", () => {
    const createdAt = Date.parse("2026-07-28T01:00:00.000Z");

    expect(
      resolveStoredAttendanceSource({
        ...baseAttendance,
        source: "walk_in",
        createdAt,
      }),
    ).toBe("walk_in");
    expect(
      resolveStoredAttendanceSource({
        ...baseAttendance,
        source: "hrm",
        bookingSource: "online_booking",
        createdAt,
      }),
    ).toBe("online_booking");
  });

  it("maps authenticated staff roles to attendance actor roles", () => {
    expect(toAttendanceActorRole("owner")).toBe("owner");
    expect(toAttendanceActorRole("manager")).toBe("manager");
    expect(toAttendanceActorRole("employee")).toBe("employee");
    expect(toAttendanceActorRole("admin")).toBe("owner");
  });
});
