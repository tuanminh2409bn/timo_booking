import { describe, expect, it } from "vitest";
import {
  leaveOverlapsAttendance,
  leaveRequestSchema,
} from "../../src/business/employee/leave-requests/leave-request-shared.js";

describe("employee leave request rules", () => {
  it("requires an ordered time interval for partial-day leave", () => {
    expect(leaveRequestSchema.safeParse({
      storeId: "store-1", startDate: "2026-08-14", endDate: "2026-08-14",
      allDay: false, startTime: "09:00", endTime: "12:00", reason: "Appointment",
    }).success).toBe(true);
    expect(leaveRequestSchema.safeParse({
      storeId: "store-1", startDate: "2026-08-14", endDate: "2026-08-14",
      allDay: false, startTime: "12:00", endTime: "09:00", reason: "Appointment",
    }).success).toBe(false);
    expect(leaveRequestSchema.safeParse({
      storeId: "store-1", startDate: "2026-08-14", endDate: "2026-08-15",
      allDay: false, startTime: "09:00", endTime: "12:00", reason: "Appointment",
    }).success).toBe(false);
  });

  it("blocks only attendances that overlap the partial leave interval", () => {
    const leave = { startDate: "2026-08-14", endDate: "2026-08-14", allDay: false, startTime: "10:00", endTime: "12:00" };
    expect(leaveOverlapsAttendance(leave, "2026-08-14", 9 * 60, 10 * 60)).toBe(false);
    expect(leaveOverlapsAttendance(leave, "2026-08-14", 9 * 60 + 45, 10 * 60 + 15)).toBe(true);
    expect(leaveOverlapsAttendance(leave, "2026-08-14", 12 * 60, 13 * 60)).toBe(false);
    expect(leaveOverlapsAttendance(leave, "2026-08-15", 10 * 60, 11 * 60)).toBe(false);
  });

  it("limits a 09:00-10:00 sick leave to the two overlapping bookings", () => {
    const leave = { startDate: "2026-08-17", endDate: "2026-08-17", allDay: false, startTime: "09:00", endTime: "10:00" };

    expect(leaveOverlapsAttendance(leave, "2026-08-17", 9 * 60, 9 * 60 + 45)).toBe(true);
    expect(leaveOverlapsAttendance(leave, "2026-08-17", 9 * 60 + 45, 10 * 60 + 30)).toBe(true);
    expect(leaveOverlapsAttendance(leave, "2026-08-17", 10 * 60 + 30, 11 * 60 + 30)).toBe(false);
  });

  it("blocks the entire day for all-day leave", () => {
    expect(leaveOverlapsAttendance(
      { startDate: "2026-08-14", endDate: "2026-08-15", allDay: true },
      "2026-08-15", 8 * 60, 9 * 60,
    )).toBe(true);
  });
});
