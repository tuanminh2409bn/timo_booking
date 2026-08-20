import { describe, expect, it } from "vitest";
import {
  createShopServiceSchema,
  isValidShopServiceDurationRange,
  normalizeShopServicePayload,
  updateShopServiceSchema,
} from "../../src/business/shop/services/service-shared.js";

describe("shop service shared validation", () => {
  it("normalizes the compatibility create fields into the persistence shape", () => {
    const parsedServiceInput = createShopServiceSchema.parse({
      storeId: "store-1",
      name: "  Gel manicure  ",
      displayName: "  Gel  ",
      amount: "$45.50",
      groupService: "  Gel  ",
      duration: "60 minutes",
    });

    expect(normalizeShopServicePayload(parsedServiceInput)).toEqual({
      name: "Gel manicure",
      displayName: "Gel",
      groupService: "Gel",
      price: 45.5,
      category: "other",
      durationMin: 60,
      durationMax: 60,
      bookingKind: "main",
      availableForBooking: true,
    });
  });

  it("keeps partial update fields partial", () => {
    const parsedServiceUpdate = updateShopServiceSchema.parse({
      price: "65",
      durationMin: 45,
    });

    expect(normalizeShopServicePayload(parsedServiceUpdate)).toEqual({
      price: 65,
      durationMin: 45,
    });
  });

  it("accepts only complete and ordered duration ranges", () => {
    expect(isValidShopServiceDurationRange(30, 45)).toBe(true);
    expect(isValidShopServiceDurationRange(45, 30)).toBe(false);
    expect(isValidShopServiceDurationRange(30, undefined)).toBe(false);
  });
});
