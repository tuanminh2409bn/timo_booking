import { describe, expect, it } from "vitest";
import { canCustomerCancelBooking } from "../../src/business/customer-portal/cancellation-policy.js";

describe("customer portal cancellation policy", () => {
  const now = Date.parse("2026-08-04T10:00:00.000Z");

  it("allows an unapproved Request to be cancelled inside the 12-hour cutoff", () => {
    expect(canCustomerCancelBooking({
      bookingStatus: "requested",
      appointmentEpoch: now + 60 * 60 * 1000,
      cancellationNoticeHours: 12,
      now,
    })).toBe(true);
  });

  it("keeps the 12-hour cutoff for confirmed bookings", () => {
    expect(canCustomerCancelBooking({
      bookingStatus: "confirmed",
      appointmentEpoch: now + 11 * 60 * 60 * 1000,
      cancellationNoticeHours: 12,
      now,
    })).toBe(false);
    expect(canCustomerCancelBooking({
      bookingStatus: "confirmed",
      appointmentEpoch: now + 12 * 60 * 60 * 1000,
      cancellationNoticeHours: 12,
      now,
    })).toBe(true);
  });
});
