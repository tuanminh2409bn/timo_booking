import { Firestore } from "@google-cloud/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cachedValues = vi.hoisted(() => new Map<string, unknown>());
const cacheDeleteByPrefixMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const cacheGetJsonMock = vi.hoisted(() => vi.fn());
const cacheSetJsonMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/repository/cache/cache-client.js", async (importOriginal) => {
  const cacheClientModule =
    await importOriginal<typeof import("../../src/repository/cache/cache-client.js")>();

  return {
    ...cacheClientModule,
    cacheDeleteByPrefix: cacheDeleteByPrefixMock,
    cacheGetJson: cacheGetJsonMock,
    cacheSetJson: cacheSetJsonMock,
  };
});

import {
  closeShopEmployeeWorkDayFactory,
  EMPLOYEE_WORK_DAY_CLOSING_RANGE_CACHE_TTL_MS,
  listShopEmployeeWorkDayClosingsByStoreDateRangeFactory,
} from "../../src/repository/firestore/shop/shop-employee-work-day-closing-factory.js";

const createFirestoreForEmployeeClosingList = () => {
  const closingDocument = {
    id: "employee-1__2026-07-23",
    ref: { path: "stores/store-1/employee_work_day_closings/employee-1__2026-07-23" },
    data: () => ({
      id: "employee-1__2026-07-23",
      ownerId: "owner-1",
      storeId: "store-1",
      workDate: "2026-07-23",
      employeeUserId: "employee-1",
      attendanceIds: ["attendance-1"],
      attendanceVersions: { "attendance-1": 100 },
      closedAt: 200,
      closedByUserId: "employee-1",
      createdAt: 200,
      updatedAt: 200,
    }),
  };
  const getClosingDocuments = vi.fn().mockResolvedValue({ docs: [closingDocument] });
  const closingQuery = {
    get: getClosingDocuments,
    where: vi.fn(),
  };
  closingQuery.where.mockReturnValue(closingQuery);
  const firestoreDB = new Firestore({ projectId: "test-project" });

  Reflect.set(
    firestoreDB,
    "collection",
    vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => closingQuery),
      })),
    })),
  );

  return { firestoreDB, getClosingDocuments };
};

describe("employee work-day closing cache", () => {
  beforeEach(() => {
    cachedValues.clear();
    vi.clearAllMocks();
    cacheDeleteByPrefixMock.mockResolvedValue(undefined);
    cacheGetJsonMock.mockImplementation((key: string) => Promise.resolve(cachedValues.get(key)));
    cacheSetJsonMock.mockImplementation((key: string, value: unknown) => {
      cachedValues.set(key, value);
      return Promise.resolve();
    });
  });

  it("reuses the canonical employee closing range cache", async () => {
    const { firestoreDB, getClosingDocuments } = createFirestoreForEmployeeClosingList();
    const listEmployeeClosings =
      listShopEmployeeWorkDayClosingsByStoreDateRangeFactory(firestoreDB);

    const firstClosings = await listEmployeeClosings(
      "owner-1",
      "store-1",
      "2026-07-01",
      "2026-07-31",
    );
    const secondClosings = await listEmployeeClosings(
      "owner-1",
      "store-1",
      "2026-07-01",
      "2026-07-31",
    );

    expect(secondClosings).toEqual(firstClosings);
    expect(getClosingDocuments).toHaveBeenCalledOnce();
    expect(cacheSetJsonMock).toHaveBeenCalledWith(
      "store:owner-1:employee-workday-closing:range:v1:store-1:2026-07-01:2026-07-31",
      expect.arrayContaining([expect.objectContaining({ employeeUserId: "employee-1" })]),
      EMPLOYEE_WORK_DAY_CLOSING_RANGE_CACHE_TTL_MS,
    );
  });

  it("deduplicates concurrent employee closing range cache misses", async () => {
    const { firestoreDB, getClosingDocuments } = createFirestoreForEmployeeClosingList();
    const listEmployeeClosings =
      listShopEmployeeWorkDayClosingsByStoreDateRangeFactory(firestoreDB);

    await Promise.all([
      listEmployeeClosings("owner-1", "store-1", "2026-07-01", "2026-07-31"),
      listEmployeeClosings("owner-1", "store-1", "2026-07-01", "2026-07-31"),
    ]);

    expect(getClosingDocuments).toHaveBeenCalledOnce();
  });

  it("bypasses Redis cache when a direct Firestore read is requested", async () => {
    const { firestoreDB, getClosingDocuments } = createFirestoreForEmployeeClosingList();
    const listEmployeeClosings =
      listShopEmployeeWorkDayClosingsByStoreDateRangeFactory(firestoreDB);

    const closings = await listEmployeeClosings("owner-1", "store-1", "2026-07-01", "2026-07-31", {
      skipCache: true,
    });

    expect(closings).toEqual([expect.objectContaining({ employeeUserId: "employee-1" })]);
    expect(getClosingDocuments).toHaveBeenCalledOnce();
    expect(cacheGetJsonMock).not.toHaveBeenCalled();
    expect(cacheSetJsonMock).not.toHaveBeenCalled();
  });

  it("invalidates employee closing and settlement caches after closing the employee day", async () => {
    const closingDocumentSet = vi.fn().mockResolvedValue(undefined);
    const firestoreDB = new Firestore({ projectId: "test-project" });

    Reflect.set(
      firestoreDB,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            doc: vi.fn(() => ({ set: closingDocumentSet })),
          })),
        })),
      })),
    );

    const closeEmployeeWorkDay = closeShopEmployeeWorkDayFactory(firestoreDB);

    await closeEmployeeWorkDay("owner-1", {
      storeId: "store-1",
      workDate: "2026-07-23",
      employeeUserId: "employee-1",
      attendanceIds: ["attendance-1"],
      attendanceVersions: { "attendance-1": 100 },
      closedAt: 200,
      closedByUserId: "employee-1",
    });

    expect(closingDocumentSet).toHaveBeenCalledOnce();
    expect(cacheDeleteByPrefixMock).toHaveBeenCalledWith(
      "store:owner-1:employee-workday-closing:range:v1:store-1:",
    );
    expect(cacheDeleteByPrefixMock).not.toHaveBeenCalledWith(
      "store:owner-1:response:settlement-list:store-1:",
    );
    expect(cacheDeleteByPrefixMock).not.toHaveBeenCalledWith(
      "store:owner-1:response:settlement-preview:store-1:2026-07-23:",
    );
  });

  it("notifies the commit observer before cache invalidation and preserves cache failures", async () => {
    const events: string[] = [];
    const closingDocumentSet = vi.fn().mockImplementation(async () => {
      events.push("firestore");
    });
    const firestoreDB = new Firestore({ projectId: "test-project" });

    Reflect.set(
      firestoreDB,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            doc: vi.fn(() => ({ set: closingDocumentSet })),
          })),
        })),
      })),
    );
    cacheDeleteByPrefixMock.mockImplementation(async () => {
      events.push("cache");
      throw new Error("redis unavailable");
    });
    const onCommitted = vi.fn((commit) => {
      events.push(commit.stage);
    });

    const closeEmployeeWorkDay = closeShopEmployeeWorkDayFactory(firestoreDB);

    await expect(
      closeEmployeeWorkDay(
        "owner-1",
        {
          storeId: "store-1",
          workDate: "2026-07-23",
          employeeUserId: "employee-1",
          attendanceIds: ["attendance-1"],
          attendanceVersions: { "attendance-1": 100 },
          closedAt: 200,
          closedByUserId: "employee-1",
        },
        { onCommitted },
      ),
    ).rejects.toThrow("redis unavailable");

    expect(onCommitted).toHaveBeenCalledOnce();
    expect(onCommitted).toHaveBeenCalledWith({
      stage: "employee_closing",
      persistAction: "overwrite",
    });
    expect(events[0]).toBe("firestore");
    expect(events[1]).toBe("employee_closing");
    expect(events.slice(2)).toHaveLength(3);
  });
});
