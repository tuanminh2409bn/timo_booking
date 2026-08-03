import { describe, expect, it, vi } from "vitest";
import { runSingleFlight } from "../../src/repository/cache/cache-client.js";

describe("runSingleFlight", () => {
  it("reports the producer as leader and concurrent callers as waiters", async () => {
    let releaseProducer: ((value: string) => void) | undefined;
    const producer = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseProducer = resolve;
        }),
    );
    const firstRole = vi.fn();
    const secondRole = vi.fn();

    const firstResult = runSingleFlight("attendance-calendar", producer, {
      onRole: firstRole,
    });
    const secondResult = runSingleFlight("attendance-calendar", producer, {
      onRole: secondRole,
    });

    expect(firstRole).toHaveBeenCalledWith("leader");
    expect(secondRole).toHaveBeenCalledWith("waiter");
    expect(producer).toHaveBeenCalledOnce();

    releaseProducer?.("done");

    await expect(firstResult).resolves.toBe("done");
    await expect(secondResult).resolves.toBe("done");
  });
});
