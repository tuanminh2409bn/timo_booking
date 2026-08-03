import { describe, expect, it } from "vitest";
import { createStoreSchema, updateStoreSchema } from "../../src/business/shop/stores/store-shared.js";

describe("shop branch time validation", () => {
  it("accepts valid branch hours and settlement cutoff", () => {
    const result = createStoreSchema.safeParse({
      name: "Main branch",
      openTime: "09:30",
      closeTime: "21:30",
      settlementCutoffTime: "23:00",
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid branch hours", () => {
    const result = updateStoreSchema.safeParse({
      openTime: "9:30",
      closeTime: "25:00",
    });

    expect(result.success).toBe(false);
  });

  it("treats empty time strings as omitted when creating a branch", () => {
    const result = createStoreSchema.safeParse({
      name: "Main branch",
      openTime: "",
      closeTime: " ",
      settlementCutoffTime: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openTime).toBeUndefined();
      expect(result.data.closeTime).toBeUndefined();
      expect(result.data.settlementCutoffTime).toBeUndefined();
    }
  });
});
