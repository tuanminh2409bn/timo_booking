import type { Firestore } from "@google-cloud/firestore";
import { trace, type Span, type Tracer } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cacheDeleteMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const cacheDeleteByPrefixMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/repository/cache/cache-client.js", async (importOriginal) => {
  const cacheClientModule =
    await importOriginal<typeof import("../../src/repository/cache/cache-client.js")>();

  return {
    ...cacheClientModule,
    cacheDelete: cacheDeleteMock,
    cacheDeleteByPrefix: cacheDeleteByPrefixMock,
  };
});

import { getDataRetentionErrorTraceContext } from "../../src/business/data-retention/data-retention-observability.js";
import {
  DATA_RETENTION_TRACE_CHILD_SPANS,
  DATA_RETENTION_TRACE_EVENTS,
} from "../../src/business/data-retention/data-retention-tracing-contract.js";
import { runStoreDataRetentionFactory } from "../../src/repository/firestore/data-retention/data-retention.repository.js";

type DocumentKind = "attendance" | "settlement" | "closing" | "customer";

type DocumentDouble = {
  id: string;
  ref: { kind: DocumentKind; path: string };
  updateTime?: object;
  data: () => Record<string, unknown>;
  get: (field: string) => unknown;
};

type SpanDouble = Span & {
  name: string;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
};

type BatchRecord = {
  deletes: Array<{ ref: DocumentDouble["ref"] }>;
  sets: Array<{ ref: DocumentDouble["ref"] }>;
  updates: Array<{ ref: DocumentDouble["ref"] }>;
};

const createDocument = (
  kind: DocumentKind,
  id: string,
  data: Record<string, unknown>,
  options: { updateTime?: object } = { updateTime: {} },
): DocumentDouble => ({
  id,
  ref: { kind, path: `stores/store-1/${kind}/${id}` },
  ...(options.updateTime !== undefined && { updateTime: options.updateTime }),
  data: () => data,
  get: (field) => data[field],
});

const createSnapshot = (docs: DocumentDouble[]) => ({
  docs,
  size: docs.length,
  empty: docs.length === 0,
});

const createQuery = (snapshots: Array<ReturnType<typeof createSnapshot>>, count = 0) => {
  const snapshotQueue = [...snapshots];
  const query = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    get: vi.fn(() => Promise.resolve(snapshotQueue.shift() ?? createSnapshot([]))),
    count: vi.fn(() => ({
      get: vi.fn(() => Promise.resolve({ data: () => ({ count }) })),
    })),
  };

  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.startAfter.mockReturnValue(query);
  return query;
};

const createTracingDouble = (timeline: string[]) => {
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
          timeline.push(`event:${eventName}`);
          return span;
        },
        setStatus: vi.fn(),
        recordException: vi.fn(),
        end: vi.fn(),
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

const getBatchKind = (batch: BatchRecord): Exclude<DocumentKind, "customer"> => {
  if (batch.updates.length > 0) {
    return "settlement";
  }

  return batch.deletes[0]?.ref.kind === "closing" ? "closing" : "attendance";
};

const createFirestoreDouble = (options: {
  attendanceSnapshots?: Array<ReturnType<typeof createSnapshot>>;
  settlementSnapshots?: Array<ReturnType<typeof createSnapshot>>;
  closingSnapshots?: Array<ReturnType<typeof createSnapshot>>;
  attendanceCount?: number;
  closingCount?: number;
  commit?: (kind: Exclude<DocumentKind, "customer">, attempt: number) => Promise<void>;
}) => {
  const attendanceQuery = createQuery(
    options.attendanceSnapshots ?? [createSnapshot([])],
    options.attendanceCount,
  );
  const settlementQuery = createQuery(options.settlementSnapshots ?? [createSnapshot([])]);
  const closingQuery = createQuery(
    options.closingSnapshots ?? [createSnapshot([])],
    options.closingCount,
  );
  const batches: BatchRecord[] = [];
  const commitAttempts = new Map<string, number>();

  const batch = vi.fn(() => {
    const record: BatchRecord = { deletes: [], sets: [], updates: [] };
    batches.push(record);
    return {
      delete: vi.fn((ref: DocumentDouble["ref"]) => record.deletes.push({ ref })),
      set: vi.fn((ref: DocumentDouble["ref"]) => record.sets.push({ ref })),
      update: vi.fn((ref: DocumentDouble["ref"]) => record.updates.push({ ref })),
      commit: vi.fn(async () => {
        const kind = getBatchKind(record);
        const attempt = (commitAttempts.get(kind) ?? 0) + 1;
        commitAttempts.set(kind, attempt);
        await options.commit?.(kind, attempt);
      }),
    };
  });

  const collections = new Map([
    ["attendances", attendanceQuery],
    ["work_day_settlements", settlementQuery],
    ["employee_work_day_closings", closingQuery],
  ]);
  const firestoreDB = {
    batch,
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn((name: string) => {
          if (name === "customers") {
            return {
              doc: vi.fn((id: string) =>
                createDocument("customer", id, {}, { updateTime: undefined }),
              ),
            };
          }

          return collections.get(name);
        }),
      })),
    })),
  } as unknown as Firestore;

  return { firestoreDB, batches, commitAttempts };
};

const getSpan = (spans: SpanDouble[], name: string) => spans.find((span) => span.name === name);

beforeEach(() => {
  vi.clearAllMocks();
  cacheDeleteMock.mockResolvedValue(undefined);
  cacheDeleteByPrefixMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("data retention cleanup tracing", () => {
  it("records aggregate scans, commit events, and retention-owned cache invalidation", async () => {
    const timeline: string[] = [];
    const spans = createTracingDouble(timeline);
    cacheDeleteMock.mockImplementation(async () => {
      timeline.push("cache.delete");
    });
    const eligibleAttendance = createDocument("attendance", "attendance-1", {
      ownerId: "owner-1",
      storeId: "store-1",
      workDate: "2026-05-01",
      customerId: "customer-1",
      bookingStatus: "confirmed",
      status: "closed",
    });
    const wrongScopeAttendance = createDocument("attendance", "attendance-2", {
      ownerId: "owner-2",
      storeId: "store-1",
      workDate: "2026-05-01",
    });
    const invalidAttendance = createDocument(
      "attendance",
      "attendance-3",
      { ownerId: "owner-1", storeId: "store-1", workDate: "2026-05-01" },
      { updateTime: undefined },
    );
    const settlement = createDocument("settlement", "settlement-1", {
      ownerId: "owner-1",
      storeId: "store-1",
      workDate: "2026-05-01",
      attendanceItems: [{}],
    });
    const settlementWithoutDetails = createDocument("settlement", "settlement-2", {
      ownerId: "owner-1",
      storeId: "store-1",
      workDate: "2026-05-01",
    });
    const closing = createDocument("closing", "closing-1", {
      ownerId: "owner-1",
      storeId: "store-1",
      workDate: "2026-05-01",
    });
    const { firestoreDB } = createFirestoreDouble({
      attendanceSnapshots: [
        createSnapshot([eligibleAttendance, wrongScopeAttendance, invalidAttendance]),
        createSnapshot([]),
      ],
      settlementSnapshots: [createSnapshot([settlement, settlementWithoutDetails])],
      closingSnapshots: [createSnapshot([closing]), createSnapshot([])],
      commit: async (kind) => {
        timeline.push(`commit:${kind}`);
      },
    });

    const result = await runStoreDataRetentionFactory(firestoreDB)({
      ownerId: "owner-1",
      storeId: "store-1",
      cutoffWorkDate: "2026-06-01",
      batchSize: 50,
    });

    expect(result).toEqual({
      attendanceDetailsDeleted: 1,
      customerCountersArchived: 1,
      settlementDetailsStripped: 1,
      employeeWorkDayClosingsDeleted: 1,
      lastCommittedStage: "employee_closing_batch",
    });
    expect(
      getSpan(spans, DATA_RETENTION_TRACE_CHILD_SPANS.attendanceScan)?.attributes,
    ).toMatchObject({
      "retention.candidate_count": 3,
      "retention.eligible_count": 1,
      "retention.skipped_scope_count": 1,
      "retention.invalid_document_count": 1,
      "retention.batch_count": 1,
    });
    expect(
      getSpan(spans, DATA_RETENTION_TRACE_CHILD_SPANS.cacheInvalidate)?.attributes,
    ).toMatchObject({
      "cache.status": "completed",
      "retention.cache_group_count": 10,
    });
    expect(spans.map((span) => span.name)).not.toContain("attendance.cache.invalidate");
    expect(getSpan(spans, DATA_RETENTION_TRACE_CHILD_SPANS.attendanceBatchCommit)?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: DATA_RETENTION_TRACE_EVENTS.attendanceBatchCommitted }),
      ]),
    );
    expect(getSpan(spans, DATA_RETENTION_TRACE_CHILD_SPANS.settlementBatchCommit)?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: DATA_RETENTION_TRACE_EVENTS.settlementBatchCommitted }),
      ]),
    );
    expect(
      getSpan(spans, DATA_RETENTION_TRACE_CHILD_SPANS.employeeClosingBatchCommit)?.events,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: DATA_RETENTION_TRACE_EVENTS.employeeClosingBatchCommitted,
        }),
      ]),
    );
    expect(timeline.indexOf("commit:attendance")).toBeLessThan(
      timeline.indexOf(`event:${DATA_RETENTION_TRACE_EVENTS.attendanceBatchCommitted}`),
    );
    expect(
      timeline.indexOf(`event:${DATA_RETENTION_TRACE_EVENTS.attendanceBatchCommitted}`),
    ).toBeLessThan(timeline.indexOf("cache.delete"));
  });

  it("classifies cache failure after attendance commit as a post-write failure", async () => {
    const timeline: string[] = [];
    const spans = createTracingDouble(timeline);
    const failure = new Error("redis unavailable");
    cacheDeleteByPrefixMock.mockRejectedValue(failure);
    const attendance = createDocument("attendance", "attendance-1", {
      ownerId: "owner-1",
      storeId: "store-1",
      workDate: "2026-05-01",
    });
    const { firestoreDB } = createFirestoreDouble({
      attendanceSnapshots: [createSnapshot([attendance])],
      commit: async () => undefined,
    });

    await expect(
      runStoreDataRetentionFactory(firestoreDB)({
        ownerId: "owner-1",
        storeId: "store-1",
        cutoffWorkDate: "2026-06-01",
      }),
    ).rejects.toBe(failure);

    expect(getDataRetentionErrorTraceContext(failure)).toEqual({
      outcome: "post_write_failure",
      failurePhase: "cache_invalidation",
      lastCommittedStage: "attendance_batch",
    });
    expect(
      getSpan(spans, DATA_RETENTION_TRACE_CHILD_SPANS.cacheInvalidate)?.attributes,
    ).toMatchObject({
      "cache.status": "failed",
      "retention.outcome": "post_write_failure",
      "retention.failure_phase": "cache_invalidation",
      "retention.last_committed_stage": "attendance_batch",
    });
  });

  it("preserves three precondition retries and reports exhausted attendance commits", async () => {
    const timeline: string[] = [];
    const spans = createTracingDouble(timeline);
    const failure = Object.assign(new Error("precondition failed"), { code: 9 });
    const attendance = createDocument("attendance", "attendance-1", {
      ownerId: "owner-1",
      storeId: "store-1",
      workDate: "2026-05-01",
    });
    const repeatedSnapshot = createSnapshot([attendance]);
    const { firestoreDB, commitAttempts } = createFirestoreDouble({
      attendanceSnapshots: [repeatedSnapshot, repeatedSnapshot, repeatedSnapshot, repeatedSnapshot],
      commit: async (kind) => {
        if (kind === "attendance") {
          throw failure;
        }
      },
    });

    await expect(
      runStoreDataRetentionFactory(firestoreDB)({
        ownerId: "owner-1",
        storeId: "store-1",
        cutoffWorkDate: "2026-06-01",
      }),
    ).rejects.toBe(failure);

    expect(commitAttempts.get("attendance")).toBe(4);
    expect(getDataRetentionErrorTraceContext(failure)).toEqual({
      outcome: "batch_retry_exhausted",
      failurePhase: "attendance_batch_commit",
      lastCommittedStage: "none",
    });
    expect(
      getSpan(spans, DATA_RETENTION_TRACE_CHILD_SPANS.attendanceScan)?.attributes,
    ).toMatchObject({
      "retention.candidate_count": 4,
      "retention.eligible_count": 4,
      "retention.retry_count": 3,
      "retention.outcome": "batch_retry_exhausted",
      "retention.failure_phase": "attendance_batch_commit",
    });
    expect(cacheDeleteMock).not.toHaveBeenCalled();
  });

  it("classifies settlement commit failures at the settlement boundary", async () => {
    const timeline: string[] = [];
    const spans = createTracingDouble(timeline);
    const failure = new Error("settlement commit failed");
    const settlement = createDocument("settlement", "settlement-1", {
      ownerId: "owner-1",
      storeId: "store-1",
      workDate: "2026-05-01",
      attendanceItems: [{}],
    });
    const { firestoreDB } = createFirestoreDouble({
      settlementSnapshots: [createSnapshot([settlement])],
      commit: async (kind) => {
        if (kind === "settlement") {
          throw failure;
        }
      },
    });

    await expect(
      runStoreDataRetentionFactory(firestoreDB)({
        ownerId: "owner-1",
        storeId: "store-1",
        cutoffWorkDate: "2026-06-01",
      }),
    ).rejects.toBe(failure);

    expect(getDataRetentionErrorTraceContext(failure)).toEqual({
      outcome: "dependency_failure",
      failurePhase: "settlement_batch_commit",
      lastCommittedStage: "none",
    });
    expect(
      getSpan(spans, DATA_RETENTION_TRACE_CHILD_SPANS.settlementBatchCommit)?.attributes,
    ).toMatchObject({
      "retention.outcome": "dependency_failure",
      "retention.failure_phase": "settlement_batch_commit",
      "retention.last_committed_stage": "none",
    });
  });

  it("classifies employee-closing commit failures at the closing boundary", async () => {
    const timeline: string[] = [];
    const spans = createTracingDouble(timeline);
    const failure = new Error("closing commit failed");
    const closing = createDocument("closing", "closing-1", {
      ownerId: "owner-1",
      storeId: "store-1",
      workDate: "2026-05-01",
    });
    const { firestoreDB } = createFirestoreDouble({
      closingSnapshots: [createSnapshot([closing])],
      commit: async (kind) => {
        if (kind === "closing") {
          throw failure;
        }
      },
    });

    await expect(
      runStoreDataRetentionFactory(firestoreDB)({
        ownerId: "owner-1",
        storeId: "store-1",
        cutoffWorkDate: "2026-06-01",
      }),
    ).rejects.toBe(failure);

    expect(getDataRetentionErrorTraceContext(failure)).toEqual({
      outcome: "dependency_failure",
      failurePhase: "employee_closing_batch_commit",
      lastCommittedStage: "none",
    });
    expect(
      getSpan(spans, DATA_RETENTION_TRACE_CHILD_SPANS.employeeClosingBatchCommit)?.attributes,
    ).toMatchObject({
      "retention.outcome": "dependency_failure",
      "retention.failure_phase": "employee_closing_batch_commit",
      "retention.last_committed_stage": "none",
    });
  });

  it("keeps dry-run read-only while reporting candidate counts", async () => {
    const timeline: string[] = [];
    const spans = createTracingDouble(timeline);
    const settlement = createDocument("settlement", "settlement-1", {
      ownerId: "owner-1",
      storeId: "store-1",
      workDate: "2026-05-01",
      attendanceItems: [{}],
    });
    const { firestoreDB, batches } = createFirestoreDouble({
      attendanceCount: 2,
      closingCount: 3,
      settlementSnapshots: [createSnapshot([settlement])],
    });

    const result = await runStoreDataRetentionFactory(firestoreDB)({
      ownerId: "owner-1",
      storeId: "store-1",
      cutoffWorkDate: "2026-06-01",
      dryRun: true,
    });

    expect(result).toEqual({
      attendanceDetailsDeleted: 2,
      customerCountersArchived: 0,
      settlementDetailsStripped: 1,
      employeeWorkDayClosingsDeleted: 3,
      lastCommittedStage: "none",
    });
    expect(batches.every((batch) => batch.deletes.length === 0 && batch.updates.length === 0)).toBe(
      true,
    );
    expect(spans.map((span) => span.name)).not.toEqual(
      expect.arrayContaining([
        DATA_RETENTION_TRACE_CHILD_SPANS.attendanceBatchCommit,
        DATA_RETENTION_TRACE_CHILD_SPANS.settlementBatchCommit,
        DATA_RETENTION_TRACE_CHILD_SPANS.employeeClosingBatchCommit,
        DATA_RETENTION_TRACE_CHILD_SPANS.cacheInvalidate,
      ]),
    );
    expect(cacheDeleteMock).not.toHaveBeenCalled();
    expect(cacheDeleteByPrefixMock).not.toHaveBeenCalled();
  });
});
