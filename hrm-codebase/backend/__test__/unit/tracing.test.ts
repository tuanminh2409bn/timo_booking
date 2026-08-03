import { trace, type Span, type Tracer } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withAppSpan } from "../../src/modules/tracing.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const createTracer = () => {
  const recordException = vi.fn();
  const span = {
    end: vi.fn(),
    recordException,
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
  } as unknown as Span;
  const tracer = {
    startActiveSpan: (_name: string, handler: (activeSpan: Span) => unknown) => handler(span),
  } as unknown as Tracer;

  return { recordException, tracer };
};

describe("application tracing", () => {
  it("can suppress raw exception recording for protected domain spans", async () => {
    const { recordException, tracer } = createTracer();
    vi.spyOn(trace, "getTracer").mockReturnValue(tracer);

    await expect(
      withAppSpan(
        "work_day_settlement.store.close",
        {},
        async () => {
          throw new Error("attendance-secret-id");
        },
        { recordException: false },
      ),
    ).rejects.toThrow("attendance-secret-id");
    expect(recordException).not.toHaveBeenCalled();
  });

  it("keeps existing exception recording as the default", async () => {
    const { recordException, tracer } = createTracer();
    vi.spyOn(trace, "getTracer").mockReturnValue(tracer);

    await expect(
      withAppSpan("other.domain", {}, async () => {
        throw new Error("expected failure");
      }),
    ).rejects.toThrow("expected failure");
    expect(recordException).toHaveBeenCalledOnce();
  });
});
