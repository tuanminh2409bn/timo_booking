import { describe, expect, it } from "vitest";
import { parseAttendancePayload } from "../../src/business/employee/domain/attendance-payload.js";

const createPayload = (customerPhone: string) => ({
  date: "2026-07-22T09:00:00",
  endDate: "2026-07-22T10:00:00",
  storeId: "store-1",
  customerName: "Mai Nguyen",
  customerPhone,
  source: "hrm" as const,
  services: [],
});

describe("attendance customer payload", () => {
  it("normalizes the customer phone and keeps the HRM source", () => {
    const result = parseAttendancePayload(createPayload("+ 84 123 456"));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customerPhone).toBe("+84123456");
      expect(result.data.source).toBe("hrm");
    }
  });

  it("rejects a non-phone value", () => {
    expect(parseAttendancePayload(createPayload("Mai Nguyen 123")).success).toBe(false);
  });
});
