import { trace, type Span, type Tracer } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runDataRetention,
  type DataRetentionRunDependencies,
} from "../../src/business/data-retention/run-data-retention.js";
import { getDataRetentionErrorFailurePhase } from "../../src/business/data-retention/data-retention-observability.js";
import { DATA_RETENTION_TRACE_CHILD_SPANS } from "../../src/business/data-retention/data-retention-tracing-contract.js";
import type { StoreType } from "../../src/repository/firestore/shop/shop.types.js";

type SpanDouble = Span & {
  name: string;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
};

const createTracingDouble = () => {
  const spans: SpanDouble[] = [];
  let activeSpan: SpanDouble | undefined;

  const tracer = {
    startActiveSpan: async (
      name: string,
      handler: (span: Span) => Promise<unknown>,
    ): Promise<unknown> => {
      const span = {
        name,
        attributes: {},
        events: [],
        setAttribute: (key: string, value: unknown) => {
          span.attributes[key] = value;
          return span;
        },
        addEvent: (eventName: string, attributes?: Record<string, unknown>) => {
          span.events.push({ name: eventName, attributes });
          return span;
        },
        setStatus: vi.fn(),
        recordException: vi.fn(),
        end: vi.fn(),
        spanContext: () => ({
          traceId: "1".repeat(32),
          spanId: "2".repeat(16),
          traceFlags: 1,
          isRemote: false,
        }),
      } as unknown as SpanDouble;
      const previousSpan = activeSpan;
      activeSpan = span;
      spans.push(span);

      try {
        return await handler(span);
      } finally {
        activeSpan = previousSpan;
      }
    },
  } as unknown as Tracer;

  vi.spyOn(trace, "getTracer").mockReturnValue(tracer);
  vi.spyOn(trace, "getActiveSpan").mockImplementation(() => activeSpan);

  return spans;
};

const createStore = (storeId: string): StoreType => ({
  id: storeId,
  ownerId: "owner-1",
  name: storeId,
  status: "active",
  timezone: "Europe/Berlin",
  settlementCutoffTime: "23:00",
});

const createDependencies = (
  overrides: Partial<DataRetentionRunDependencies> = {},
): DataRetentionRunDependencies => ({
  listOwnerDataRetentionPolicies: vi.fn().mockResolvedValue([]),
  updateOwnerDataRetentionPolicy: vi.fn().mockResolvedValue(undefined),
  getStoreListWithMetadata: vi.fn().mockResolvedValue({ stores: [], cacheStatus: "miss" }),
  runStoreDataRetention: vi.fn().mockResolvedValue({
    attendanceDetailsDeleted: 0,
    customerCountersArchived: 0,
    settlementDetailsStripped: 0,
    employeeWorkDayClosingsDeleted: 0,
  }),
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("data retention orchestration tracing", () => {
  it("records bounded owner classifications and only processes eligible Standard owners", async () => {
    const spans = createTracingDouble();
    const now = Date.parse("2026-07-31T12:00:00.000Z");
    const dependencies = createDependencies({
      listOwnerDataRetentionPolicies: vi.fn().mockResolvedValue([
        { uid: "legacy", ownerId: "owner-legacy", active: true },
        {
          uid: "premium",
          ownerId: "owner-premium",
          active: true,
          dataRetentionPlan: "premium",
          dataRetentionPlanChangedAt: 1,
        },
        {
          uid: "grace",
          ownerId: "owner-grace",
          active: true,
          dataRetentionPlan: "standard",
          dataRetentionPlanChangedAt: now - 5_000,
          dataRetentionStandardEligibleAt: now + 1_000,
        },
        {
          uid: "eligible",
          ownerId: "owner-eligible",
          active: false,
          dataRetentionPlan: "standard",
          dataRetentionPlanChangedAt: now - 5_000,
          dataRetentionStandardEligibleAt: now - 1,
        },
      ]),
      getStoreListWithMetadata: vi.fn().mockResolvedValue({
        stores: [createStore("S-1")],
        cacheStatus: "hit",
      }),
    });

    const summary = await runDataRetention({ now, dryRun: true, batchSize: 50 }, dependencies);

    expect(summary).toMatchObject({
      ownersScanned: 4,
      ownersInitialized: 1,
      ownersPremium: 1,
      ownersInGracePeriod: 1,
      standardOwnersProcessed: 1,
      storesProcessed: 1,
    });
    expect(dependencies.updateOwnerDataRetentionPolicy).not.toHaveBeenCalled();
    expect(dependencies.getStoreListWithMetadata).toHaveBeenCalledOnce();

    const ownerScan = spans.find(
      (span) => span.name === DATA_RETENTION_TRACE_CHILD_SPANS.ownerScan,
    );
    const storeList = spans.find(
      (span) => span.name === DATA_RETENTION_TRACE_CHILD_SPANS.storeList,
    );
    const storeProcess = spans.find(
      (span) => span.name === DATA_RETENTION_TRACE_CHILD_SPANS.storeProcess,
    );

    expect(ownerScan?.attributes).toMatchObject({
      "retention.owner_count": 4,
      "retention.owners_initialized": 1,
      "retention.owners_premium": 1,
      "retention.owners_in_grace_period": 1,
      "retention.standard_owners_processed": 1,
      "retention.execution_mode": "dry_run",
      "retention.outcome": "dry_run_success",
    });
    expect(storeList?.attributes).toMatchObject({
      "retention.store_count": 1,
      "cache.status": "hit",
    });
    expect(storeProcess?.attributes).toMatchObject({
      "app.store_id": "S-1",
      "retention.current_work_date": "2026-07-31",
      "retention.cutoff_work_date": "2026-05-31",
      "retention.outcome": "no_eligible_detail",
    });
  });

  it("records an empty cache-miss store list without creating store spans", async () => {
    const spans = createTracingDouble();
    const now = Date.parse("2026-07-31T12:00:00.000Z");
    const dependencies = createDependencies({
      listOwnerDataRetentionPolicies: vi.fn().mockResolvedValue([
        {
          uid: "eligible",
          ownerId: "owner-eligible",
          active: true,
          dataRetentionPlan: "standard",
          dataRetentionPlanChangedAt: now - 5_000,
          dataRetentionStandardEligibleAt: now,
        },
      ]),
    });

    const summary = await runDataRetention({ now, dryRun: true }, dependencies);

    expect(summary).toMatchObject({ standardOwnersProcessed: 1, storesProcessed: 0 });
    const storeList = spans.find(
      (span) => span.name === DATA_RETENTION_TRACE_CHILD_SPANS.storeList,
    );

    expect(storeList?.attributes).toMatchObject({
      "retention.store_count": 0,
      "cache.status": "miss",
      "retention.outcome": "no_eligible_detail",
    });
    expect(
      spans.filter((span) => span.name === DATA_RETENTION_TRACE_CHILD_SPANS.storeProcess),
    ).toHaveLength(0);
  });

  it("records the store-list failure phase without leaking owner identifiers", async () => {
    const spans = createTracingDouble();
    const now = Date.parse("2026-07-31T12:00:00.000Z");
    const failure = new Error("redis unavailable");
    const dependencies = createDependencies({
      listOwnerDataRetentionPolicies: vi.fn().mockResolvedValue([
        {
          uid: "eligible",
          ownerId: "owner-eligible",
          active: true,
          dataRetentionPlan: "standard",
          dataRetentionPlanChangedAt: now - 5_000,
          dataRetentionStandardEligibleAt: now - 1,
        },
      ]),
      getStoreListWithMetadata: vi.fn().mockRejectedValue(failure),
    });

    await expect(runDataRetention({ now, dryRun: false }, dependencies)).rejects.toBe(failure);

    expect(getDataRetentionErrorFailurePhase(failure)).toBe("store_list");
    const storeList = spans.find(
      (span) => span.name === DATA_RETENTION_TRACE_CHILD_SPANS.storeList,
    );

    expect(storeList?.attributes).toMatchObject({
      "retention.outcome": "dependency_failure",
      "retention.failure_phase": "store_list",
    });
    expect(JSON.stringify(storeList?.attributes)).not.toContain("owner-eligible");
  });

  it("initializes legacy owners in execute mode and keeps the first run out of cleanup", async () => {
    const spans = createTracingDouble();
    const now = Date.parse("2026-07-31T12:00:00.000Z");
    const dependencies = createDependencies({
      listOwnerDataRetentionPolicies: vi
        .fn()
        .mockResolvedValue([{ uid: "legacy", ownerId: "owner-legacy", active: true }]),
    });

    const summary = await runDataRetention({ now, dryRun: false }, dependencies);

    expect(summary).toMatchObject({ ownersScanned: 1, ownersInitialized: 1, storesProcessed: 0 });
    expect(dependencies.updateOwnerDataRetentionPolicy).toHaveBeenCalledWith(
      "legacy",
      expect.objectContaining({
        dataRetentionPlan: "standard",
        dataRetentionStandardEligibleAt: expect.any(Number),
      }),
    );
    expect(dependencies.getStoreListWithMetadata).not.toHaveBeenCalled();

    const policyInitialize = spans.find(
      (span) => span.name === DATA_RETENTION_TRACE_CHILD_SPANS.policyInitialize,
    );
    expect(policyInitialize?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "data_retention.policy_initialized" }),
      ]),
    );
  });

  it("marks policy-load failures for the job root to classify without changing the error", async () => {
    createTracingDouble();
    const now = Date.parse("2026-07-31T12:00:00.000Z");
    const failure = new Error("firestore unavailable");
    const dependencies = createDependencies({
      listOwnerDataRetentionPolicies: vi.fn().mockRejectedValue(failure),
    });

    await expect(runDataRetention({ now }, dependencies)).rejects.toBe(failure);
    expect(getDataRetentionErrorFailurePhase(failure)).toBe("policy_load");
  });
});
