import { trace, type Span, type Tracer } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDataRetentionJob } from "../../src/jobs/data-retention-runtime.js";
import { markDataRetentionErrorFailurePhase } from "../../src/business/data-retention/data-retention-observability.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const createTracingDouble = (events: string[]) => {
  const span = {
    end: vi.fn(() => events.push("span.end")),
    recordException: vi.fn(),
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    addEvent: vi.fn(),
    spanContext: () => ({
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      traceFlags: 1,
      isRemote: false,
    }),
  } as unknown as Span;
  const tracer = {
    startActiveSpan: (_name: string, handler: (activeSpan: Span) => unknown) => {
      events.push("span.start");
      return handler(span);
    },
  } as unknown as Tracer;

  return { span, tracer };
};

describe("data retention job runtime", () => {
  it("flushes tracing after a successful sampled job root", async () => {
    const events: string[] = [];
    const { span, tracer } = createTracingDouble(events);
    const runDataRetention = vi.fn().mockImplementation(async () => {
      events.push("workflow");
      return {
        dryRun: true,
        ownersScanned: 1,
        ownersInitialized: 0,
        ownersPremium: 0,
        ownersInGracePeriod: 0,
        standardOwnersProcessed: 1,
        storesProcessed: 1,
        attendanceDetailsDeleted: 0,
        customerCountersArchived: 0,
        settlementDetailsStripped: 0,
        employeeWorkDayClosingsDeleted: 0,
      };
    });
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const shutdown = vi.fn().mockImplementation(async () => {
      events.push("shutdown");
      throw new Error("exporter shutdown failed");
    });

    vi.spyOn(trace, "getTracer").mockReturnValue(tracer);
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    await runDataRetentionJob({
      environment: { DATA_RETENTION_EXECUTE: "false", DATA_RETENTION_BATCH_SIZE: "400" },
      dependencies: {
        initTracing: () => ({ enabled: true, shutdown }),
        runDataRetention,
        logger,
      },
    });

    expect(runDataRetention).toHaveBeenCalledWith({ dryRun: true, batchSize: 200 });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ executionMode: "dry_run" }),
      "data retention job completed",
    );
    expect(events).toEqual(["span.start", "workflow", "span.end", "shutdown"]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: "Error" }),
      "OpenTelemetry tracing shutdown failed",
    );
  });

  it("preserves workflow failure and still flushes tracing", async () => {
    const events: string[] = [];
    const { span, tracer } = createTracingDouble(events);
    const failure = new Error("retention failed");
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const shutdown = vi.fn().mockImplementation(async () => {
      events.push("shutdown");
      throw new Error("exporter shutdown failed");
    });

    vi.spyOn(trace, "getTracer").mockReturnValue(tracer);
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    await expect(
      runDataRetentionJob({
        environment: { DATA_RETENTION_EXECUTE: "true", DATA_RETENTION_BATCH_SIZE: "400" },
        dependencies: {
          initTracing: () => ({ enabled: true, shutdown }),
          runDataRetention: vi.fn().mockRejectedValue(failure),
          logger,
        },
      }),
    ).rejects.toBe(failure);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: "Error" }),
      "data retention job failed",
    );
    expect(events).toEqual(["span.start", "span.end", "shutdown"]);
    expect(shutdown).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: "Error" }),
      "OpenTelemetry tracing shutdown failed",
    );
  });

  it("keeps a disabled exporter and shutdown failure out of the workflow result", async () => {
    const summary = {
      dryRun: true,
      ownersScanned: 0,
      ownersInitialized: 0,
      ownersPremium: 0,
      ownersInGracePeriod: 0,
      standardOwnersProcessed: 0,
      storesProcessed: 0,
      attendanceDetailsDeleted: 0,
      customerCountersArchived: 0,
      settlementDetailsStripped: 0,
      employeeWorkDayClosingsDeleted: 0,
    };
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

    await expect(
      runDataRetentionJob({
        environment: {},
        dependencies: {
          initTracing: () => ({
            enabled: false,
            shutdown: vi.fn().mockRejectedValue(new Error("exporter unavailable")),
          }),
          runDataRetention: vi.fn().mockResolvedValue(summary),
          logger,
        },
      }),
    ).resolves.toEqual(summary);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: "Error" }),
      "OpenTelemetry tracing shutdown failed",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("propagates orchestration skip and failure classifications to the job root", async () => {
    const events: string[] = [];
    const { span, tracer } = createTracingDouble(events);
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

    vi.spyOn(trace, "getTracer").mockReturnValue(tracer);
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(span);

    await runDataRetentionJob({
      environment: {},
      dependencies: {
        initTracing: () => ({ enabled: true, shutdown: vi.fn().mockResolvedValue(undefined) }),
        runDataRetention: vi.fn().mockResolvedValue({
          dryRun: true,
          ownersScanned: 1,
          ownersInitialized: 0,
          ownersPremium: 1,
          ownersInGracePeriod: 0,
          standardOwnersProcessed: 0,
          storesProcessed: 0,
          attendanceDetailsDeleted: 0,
          customerCountersArchived: 0,
          settlementDetailsStripped: 0,
          employeeWorkDayClosingsDeleted: 0,
        }),
        logger,
      },
    });

    expect(span.setAttribute).toHaveBeenCalledWith("retention.outcome", "skipped_premium");

    const failure = new Error("policy load failed");
    markDataRetentionErrorFailurePhase(failure, "policy_load");

    await expect(
      runDataRetentionJob({
        environment: {},
        dependencies: {
          initTracing: () => ({ enabled: true, shutdown: vi.fn().mockResolvedValue(undefined) }),
          runDataRetention: vi.fn().mockRejectedValue(failure),
          logger,
        },
      }),
    ).rejects.toBe(failure);

    expect(span.setAttribute).toHaveBeenCalledWith("retention.failure_phase", "policy_load");
  });
});
