import { describe, expect, it } from "vitest";
import {
  canMergeCustomerByName,
  getCustomerDocumentId,
  normalizeCustomerName,
  normalizeCustomerPhone,
} from "../../src/helpers/customer-phone.js";

describe("customer phone normalization", () => {
  it("canonicalizes formatted input", () => {
    expect(normalizeCustomerPhone(" + 84 123 456 ")).toBe("+84123456");
  });

  it("returns undefined for empty or invalid input", () => {
    expect(normalizeCustomerPhone("  ")).toBeUndefined();
    expect(normalizeCustomerPhone("abc123")).toBeUndefined();
  });

  it("creates a stable customer document id", () => {
    expect(getCustomerDocumentId("+84123456")).toBe(getCustomerDocumentId("+84123456"));
  });

  it("normalizes customer names and excludes the anonymous walk-in label", () => {
    expect(normalizeCustomerName("  MAI   Nguyễn  ")).toBe("mai nguyễn");
    expect(normalizeCustomerName("Khách lẻ")).toBeUndefined();
  });

  it("only enriches a name match when the existing phone is empty or identical", () => {
    expect(canMergeCustomerByName(undefined, "+84 123 456")).toBe(true);
    expect(canMergeCustomerByName("+84 123 456", "+84123456")).toBe(true);
    expect(canMergeCustomerByName("+84 111 111", "+84 222 222")).toBe(false);
    expect(canMergeCustomerByName("+84 111 111", undefined)).toBe(true);
  });
});
