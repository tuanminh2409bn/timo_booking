import { describe, expect, it } from "vitest";
import {
  formatPublicCode,
  isPublicCodeForType,
  normalizePublicCode,
  parsePublicCodeSequence,
} from "../../src/helpers/public-code.js";

describe("public code helpers", () => {
  it("formats fixed prefix codes with compact sequence numbers", () => {
    expect(formatPublicCode("shop", 1)).toBe("S-1");
    expect(formatPublicCode("service", 12)).toBe("DV-12");
    expect(formatPublicCode("attendance", 25)).toBe("CC-25");
    expect(formatPublicCode("customer", 3)).toBe("KH-3");
  });

  it("normalizes case and whitespace without accepting random legacy hashes", () => {
    expect(normalizePublicCode(" dv-1 ")).toBe("DV-1");
    expect(isPublicCodeForType("DV-1", "service")).toBe(true);
    expect(isPublicCodeForType("DV-ABC123", "service")).toBe(false);
    expect(isPublicCodeForType("CC-1", "service")).toBe(false);
    expect(isPublicCodeForType("CC-15", "attendance")).toBe(true);
    expect(isPublicCodeForType("KH-3", "customer")).toBe(true);
  });

  it("parses numeric sequences", () => {
    expect(parsePublicCodeSequence("DV-1", "service")).toBe(1);
    expect(parsePublicCodeSequence("DV-1000", "service")).toBe(1000);
    expect(parsePublicCodeSequence("DV-ABC", "service")).toBeUndefined();
    expect(parsePublicCodeSequence("CC-7", "attendance")).toBe(7);
    expect(parsePublicCodeSequence("KH-3", "customer")).toBe(3);
  });
});
