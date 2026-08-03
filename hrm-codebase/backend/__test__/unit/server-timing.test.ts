import { describe, expect, it } from "vitest";
import { ServerTiming } from "../../src/modules/server-timing.js";

describe("ServerTiming", () => {
  it("renders marks as a Server-Timing header value", () => {
    const timing = new ServerTiming();

    timing.add("verify", 520.04);
    timing.add("db", 95);
    timing.add("jwt", 0.8);

    expect(timing.header()).toBe("verify;dur=520, db;dur=95, jwt;dur=0.8");
  });

  it("includes a description when provided and strips quotes", () => {
    const timing = new ServerTiming();

    timing.add("verify", 12.3, 'firebase "rest"');

    expect(timing.header()).toBe('verify;desc="firebase rest";dur=12.3');
  });

  it("exposes a flat object for structured logging", () => {
    const timing = new ServerTiming();

    timing.add("verify", 100.04);
    timing.add("db", 50);

    expect(timing.toObject()).toEqual({ verify: 100, db: 50 });
  });

  it("measures async work and records it in order", async () => {
    const timing = new ServerTiming();

    const result = await timing.measure("verify", async () => {
      await Promise.resolve();
      return "ok";
    });

    expect(result).toBe("ok");
    expect(Object.keys(timing.toObject())).toEqual(["verify"]);
  });

  it("records a mark even when the measured fn throws", async () => {
    const timing = new ServerTiming();

    await expect(
      timing.measure("verify", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(Object.keys(timing.toObject())).toEqual(["verify"]);
  });

  it("measures synchronous work", () => {
    const timing = new ServerTiming();

    const value = timing.measureSync("jwt", () => 42);

    expect(value).toBe(42);
    expect(Object.keys(timing.toObject())).toEqual(["jwt"]);
  });
});
