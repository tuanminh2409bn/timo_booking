import { describe, expect, it } from "vitest";
import { resolveSettlementEligibleAt } from "../../src/helpers/business-day.js";

describe("business day settlement eligibility", () => {
  it("starts a summer work date at the previous local cutoff", () => {
    const eligibleAt = resolveSettlementEligibleAt("2026-07-25", {
      timeZone: "Europe/Berlin",
      settlementCutoffTime: "23:00",
    });

    expect(new Date(eligibleAt).toISOString()).toBe("2026-07-24T21:00:00.000Z");
  });

  it("accounts for the winter timezone offset", () => {
    const eligibleAt = resolveSettlementEligibleAt("2026-01-15", {
      timeZone: "Europe/Berlin",
      settlementCutoffTime: "23:00",
    });

    expect(new Date(eligibleAt).toISOString()).toBe("2026-01-14T22:00:00.000Z");
  });
});
