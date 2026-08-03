import { Firestore } from "@google-cloud/firestore";
import { trace, type Span, type Tracer } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheDeleteByPrefixMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/repository/cache/cache-client.js", async (importOriginal) => {
  const cacheClientModule =
    await importOriginal<typeof import("../../src/repository/cache/cache-client.js")>();

  return {
    ...cacheClientModule,
    cacheDeleteByPrefix: cacheDeleteByPrefixMock,
  };
});

import { upsertShopEmployeeTimeTrackingFactory } from "../../src/repository/firestore/shop/shop-employee-time-tracking-factory.js";

const createFirestore = (events: string[], existingStatus?: "working" | "completed") => {
  const setDocument = vi.fn().mockImplementation(async () => {
    events.push("firestore");
  });
  const getDocument = vi.fn().mockResolvedValue({
    exists: existingStatus !== undefined,
    data: () =>
      existingStatus === undefined
        ? undefined
        : {
            status: existingStatus,
            createdAt: 50,
          },
  });
  const firestoreDB = new Firestore({ projectId: "test-project" });

  Reflect.set(
    firestoreDB,
    "collection",
    vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({ get: getDocument, set: setDocument })),
        })),
      })),
    })),
  );

  return { firestoreDB, setDocument };
};

describe("employee time-tracking repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheDeleteByPrefixMock.mockResolvedValue(undefined);
  });

  it("notifies the commit observer after Firestore and before cache invalidation", async () => {
    const events: string[] = [];
    const { firestoreDB } = createFirestore(events);
    cacheDeleteByPrefixMock.mockImplementation(async () => {
      events.push("cache");
      throw new Error("redis unavailable");
    });
    const onCommitted = vi.fn((commit: { persistAction: string }) => {
      events.push(`commit:${commit.persistAction}`);
    });
    const upsertTimeTracking = upsertShopEmployeeTimeTrackingFactory(firestoreDB);

    await expect(
      upsertTimeTracking(
        "owner-1",
        {
          storeId: "store-1",
          workDate: "2026-07-31",
          employeeUserId: "employee-1",
          status: "working",
          checkedInAt: 100,
        },
        { onCommitted },
      ),
    ).rejects.toThrow("redis unavailable");

    expect(onCommitted).toHaveBeenCalledOnce();
    expect(onCommitted).toHaveBeenCalledWith({
      action: "check_in",
      persistAction: "create",
      statusBefore: "missing",
      statusAfter: "working",
      storeId: "store-1",
      workDate: "2026-07-31",
    });
    expect(events[0]).toBe("firestore");
    expect(events[1]).toBe("commit:create");
    expect(events.slice(2)).toHaveLength(2);
  });

  it("does not let observer failures change the persisted result", async () => {
    const events: string[] = [];
    const { firestoreDB, setDocument } = createFirestore(events);
    const onCommitted = vi.fn(() => {
      throw new Error("observer failed");
    });
    const upsertTimeTracking = upsertShopEmployeeTimeTrackingFactory(firestoreDB);

    await expect(
      upsertTimeTracking(
        "owner-1",
        {
          storeId: "store-1",
          workDate: "2026-07-31",
          employeeUserId: "employee-1",
          status: "working",
          checkedInAt: 100,
        },
        { onCommitted },
      ),
    ).resolves.toMatchObject({ status: "working" });

    expect(onCommitted).toHaveBeenCalledOnce();
    expect(setDocument).toHaveBeenCalledOnce();
  });

  it("reports an update transition from the stored status", async () => {
    const events: string[] = [];
    const { firestoreDB } = createFirestore(events, "working");
    const onCommitted = vi.fn();
    const upsertTimeTracking = upsertShopEmployeeTimeTrackingFactory(firestoreDB);

    await upsertTimeTracking(
      "owner-1",
      {
        storeId: "store-1",
        workDate: "2026-07-31",
        employeeUserId: "employee-1",
        status: "completed",
        checkedInAt: 100,
        checkedOutAt: 200,
        workedMinutes: 2,
      },
      { onCommitted },
    );

    expect(onCommitted).toHaveBeenCalledWith({
      action: "check_out",
      persistAction: "update",
      statusBefore: "working",
      statusAfter: "completed",
      storeId: "store-1",
      workDate: "2026-07-31",
    });
  });

  it("groups report and home invalidation into one cache child span", async () => {
    const events: string[] = [];
    const { firestoreDB } = createFirestore(events);
    const attributes = new Map<string, unknown>();
    const spanNames: string[] = [];
    const span = {
      end: vi.fn(),
      recordException: vi.fn(),
      setAttribute: (key: string, value: unknown) => {
        attributes.set(key, value);
        return span;
      },
      setStatus: vi.fn(),
    } as unknown as Span;
    const tracer = {
      startActiveSpan: <T>(name: string, handler: (activeSpan: Span) => T): T => {
        spanNames.push(name);
        return handler(span);
      },
    } as unknown as Tracer;
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(tracer);
    const upsertTimeTracking = upsertShopEmployeeTimeTrackingFactory(firestoreDB);

    try {
      await upsertTimeTracking("owner-1", {
        storeId: "store-1",
        workDate: "2026-07-31",
        employeeUserId: "employee-1",
        status: "working",
        checkedInAt: 100,
      });

      expect(spanNames).toEqual([
        "employee_time_tracking.session.persist",
        "employee_time_tracking.cache.invalidate",
      ]);
      expect(Object.fromEntries(attributes)).toMatchObject({
        "app.store_id": "store-1",
        "time_tracking.work_date": "2026-07-31",
        "time_tracking.post_write_phase": "cache_invalidation",
        "cache.group_count": 2,
      });
      expect(cacheDeleteByPrefixMock).toHaveBeenCalledTimes(2);
    } finally {
      getTracer.mockRestore();
    }
  });
});
