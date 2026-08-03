import { describe, expect, it } from "vitest";
import { isValidWorkDate } from "../../src/helpers/verify-work-date.js";

describe("isValidWorkDate", () => {
  it("accepts real ISO calendar dates", () => {
    expect(isValidWorkDate("2026-02-28")).toBe(true);
    expect(isValidWorkDate("2028-02-29")).toBe(true);
  });

  it("rejects normalized and malformed dates", () => {
    expect(isValidWorkDate("2026-02-29")).toBe(false);
    expect(isValidWorkDate("2026-02-31")).toBe(false);
    expect(isValidWorkDate("2026-2-01")).toBe(false);
  });
});
