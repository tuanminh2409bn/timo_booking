import { Firestore } from "@google-cloud/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cachedValues = vi.hoisted(() => new Map<string, unknown>());
const cacheGetJsonMock = vi.hoisted(() => vi.fn());
const cacheSetJsonMock = vi.hoisted(() => vi.fn());
const cacheDeleteMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const cacheDeleteByPrefixMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const reservePublicCodeMock = vi.hoisted(() => vi.fn().mockResolvedValue("CC-1"));

vi.mock("../../src/repository/cache/cache-client.js", async (importOriginal) => {
  const cacheClientModule =
    await importOriginal<typeof import("../../src/repository/cache/cache-client.js")>();

  return {
    ...cacheClientModule,
    cacheDelete: cacheDeleteMock,
    cacheDeleteByPrefix: cacheDeleteByPrefixMock,
    cacheGetJson: cacheGetJsonMock,
    cacheSetJson: cacheSetJsonMock,
  };
});

vi.mock("../../src/repository/firestore/public-code.js", () => ({
  reservePublicCode: reservePublicCodeMock,
}));

import {
  createShopAttendanceFactory,
  invalidateAttendanceRetentionCaches,
  listShopAttendanceByStoreDateRangeFactory,
  listShopAttendanceCalendarByStoreDateRangeFactory,
} from "../../src/repository/firestore/shop/shop-attendance-factory.js";

const createFirestoreWithAttendanceCollection = () => {
  const attendanceDocumentSet = vi.fn().mockResolvedValue(undefined);
  const attendanceDocument = {
    id: "attendance-1",
    set: attendanceDocumentSet,
  };
  const attendanceData = {
    id: "attendance-1",
    ownerId: "owner-1",
    storeId: "store-1",
    storeName: "Store 1",
    storeWorkDateKey: "store-1:2026-07-23",
    workDate: "2026-07-23",
    storeTimezone: "Europe/Berlin",
    settlementCutoffTime: "23:00",
    startTimestamp: 1,
    endTimestamp: 2,
    startTime: 540,
    endTime: 600,
    customerName: "Customer",
    customerPhone: "+4912345678",
    customerId: "customer-1",
    note: "Calendar note",
    bookingSource: "walk_in",
    source: "hrm",
    assignees: [],
    services: [],
    subtotalAmount: 0,
    totalAmount: 0,
    status: "open",
    bookingStatus: "confirmed",
    createdAt: 1,
    updatedAt: 2,
    createdBy: "owner-1",
    updatedBy: "owner-1",
  };
  const attendanceSnapshot = {
    docs: [
      {
        id: "attendance-1",
        ref: { path: "stores/store-1/attendances/attendance-1" },
        data: () => attendanceData,
      },
    ],
  };
  const getAttendanceDocuments = vi.fn().mockResolvedValue(attendanceSnapshot);
  const selectAttendanceFields = vi.fn();
  const attendanceQuery = {
    where: vi.fn(),
    select: selectAttendanceFields,
    get: getAttendanceDocuments,
  };
  attendanceQuery.where.mockReturnValue(attendanceQuery);
  selectAttendanceFields.mockReturnValue(attendanceQuery);
  const attendanceCollection = {
    doc: vi.fn(() => attendanceDocument),
    select: selectAttendanceFields,
    where: vi.fn(() => attendanceQuery),
  };
  const firestoreDB = new Firestore({ projectId: "test-project" });

  Reflect.set(
    firestoreDB,
    "collection",
    vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => attendanceCollection),
      })),
    })),
  );

  return {
    firestoreDB,
    attendanceDocumentSet,
    filterAttendanceCollection: attendanceCollection.where,
    getAttendanceDocuments,
    selectAttendanceFields,
  };
};

describe("attendance calendar cache", () => {
  beforeEach(() => {
    cachedValues.clear();
    vi.clearAllMocks();
    reservePublicCodeMock.mockResolvedValue("CC-1");
    cacheDeleteMock.mockResolvedValue(undefined);
    cacheDeleteByPrefixMock.mockResolvedValue(undefined);
    cacheGetJsonMock.mockImplementation((key: string) => Promise.resolve(cachedValues.get(key)));
    cacheSetJsonMock.mockImplementation((key: string, value: unknown) => {
      cachedValues.set(key, value);
      return Promise.resolve();
    });
  });

  it("deduplicates concurrent Calendar cache misses and caches the complete projection", async () => {
    const { firestoreDB, getAttendanceDocuments, selectAttendanceFields } =
      createFirestoreWithAttendanceCollection();
    const listCalendarAttendances = listShopAttendanceCalendarByStoreDateRangeFactory(firestoreDB);

    const [firstResult, secondResult] = await Promise.all([
      listCalendarAttendances("owner-1", "store-1", "2026-07-23", "2026-07-23"),
      listCalendarAttendances("owner-1", "store-1", "2026-07-23", "2026-07-23"),
    ]);

    expect(firstResult).toEqual(secondResult);
    expect(getAttendanceDocuments).toHaveBeenCalledOnce();
    expect(selectAttendanceFields.mock.calls[0]).toEqual(
      expect.arrayContaining([
        "storeTimezone",
        "startTimestamp",
        "endTimestamp",
        "customerPhone",
        "customerId",
        "note",
        "bookingSource",
        "source",
      ]),
    );
    expect(cacheSetJsonMock).toHaveBeenCalledWith(
      "store:owner-1:attendance:calendar-range:store-1:2026-07-23:2026-07-23",
      expect.arrayContaining([
        expect.objectContaining({
          customerPhone: "+4912345678",
          source: "hrm",
          storeTimezone: "Europe/Berlin",
        }),
      ]),
      30_000,
    );
  });

  it("invalidates the store Calendar range after creating attendance", async () => {
    const { firestoreDB, attendanceDocumentSet } = createFirestoreWithAttendanceCollection();
    const createAttendance = createShopAttendanceFactory(firestoreDB);

    await createAttendance("owner-1", {
      employeeUserId: "employee-1",
      storeId: "store-1",
      storeName: "Store 1",
      storeWorkDateKey: "store-1:2026-07-23",
      workDate: "2026-07-23",
      customerId: "customer-1",
      startTime: 540,
      endTime: 600,
      assignees: [],
      services: [],
      subtotalAmount: 0,
      totalAmount: 0,
      status: "open",
      createdBy: "owner-1",
      updatedBy: "owner-1",
    });

    expect(attendanceDocumentSet).toHaveBeenCalledOnce();
    expect(cacheDeleteByPrefixMock).toHaveBeenCalledWith(
      "store:owner-1:attendance:calendar-range:store-1:",
    );
    expect(cacheDeleteByPrefixMock).toHaveBeenCalledWith(
      "store:owner-1:employee-workday-closing:range:v1:store-1:",
    );
    expect(cacheDeleteByPrefixMock).not.toHaveBeenCalledWith(
      "store:owner-1:response:customer-attendance-summary:store-1:customer-1:",
    );
  });

  it("bypasses Redis cache when a direct Firestore attendance read is requested", async () => {
    const { firestoreDB, getAttendanceDocuments } = createFirestoreWithAttendanceCollection();
    const listAttendances = listShopAttendanceByStoreDateRangeFactory(firestoreDB);

    const attendances = await listAttendances("owner-1", "store-1", "2026-07-23", "2026-07-23", {
      skipCache: true,
    });

    expect(attendances).toEqual([expect.objectContaining({ id: "attendance-1" })]);
    expect(getAttendanceDocuments).toHaveBeenCalledOnce();
    expect(cacheGetJsonMock).not.toHaveBeenCalled();
    expect(cacheSetJsonMock).not.toHaveBeenCalled();
  });

  it("invalidates retention-affected work-date lists and range caches", async () => {
    await invalidateAttendanceRetentionCaches("owner-1", "store-1", [
      "store-1__2026-05-01",
      "store-1__2026-05-01",
      "store-1__2026-05-02",
    ]);

    expect(cacheDeleteMock).toHaveBeenCalledWith(
      "store:owner-1:attendance:list:store-1__2026-05-01",
    );
    expect(cacheDeleteMock).toHaveBeenCalledWith(
      "store:owner-1:attendance:list:store-1__2026-05-02",
    );
    expect(cacheDeleteMock).toHaveBeenCalledTimes(2);
    expect(cacheDeleteByPrefixMock).toHaveBeenCalledWith(
      "store:owner-1:attendance:calendar-range:store-1:",
    );
    expect(cacheDeleteByPrefixMock).toHaveBeenCalledWith("store:owner-1:response:employee-report:");
  });

  it("reads an employee calendar directly from the employee-scoped Firestore query", async () => {
    const { firestoreDB, filterAttendanceCollection, getAttendanceDocuments } =
      createFirestoreWithAttendanceCollection();
    const listCalendarAttendances = listShopAttendanceCalendarByStoreDateRangeFactory(firestoreDB);

    const attendances = await listCalendarAttendances(
      "owner-1",
      "store-1",
      "2026-07-23",
      "2026-07-23",
      {
        employeeUserId: "employee-1",
        skipCache: true,
      },
    );

    expect(attendances).toEqual([expect.objectContaining({ id: "attendance-1" })]);
    expect(filterAttendanceCollection).toHaveBeenCalledWith(
      "assigneeUserIds",
      "array-contains",
      "employee-1",
    );
    expect(getAttendanceDocuments).toHaveBeenCalledOnce();
    expect(cacheGetJsonMock).not.toHaveBeenCalled();
    expect(cacheSetJsonMock).not.toHaveBeenCalled();
  });

  it("falls back to a full collection read when the range index is missing", async () => {
    const { firestoreDB, getAttendanceDocuments } = createFirestoreWithAttendanceCollection();
    getAttendanceDocuments
      .mockRejectedValueOnce({ code: 9, message: "The query requires an index" })
      .mockResolvedValueOnce({
        docs: [
          {
            id: "attendance-1",
            ref: { path: "stores/store-1/attendances/attendance-1" },
            data: () => ({
              id: "attendance-1",
              ownerId: "owner-1",
              storeId: "store-1",
              workDate: "2026-07-23",
              startTime: 540,
              assignees: [],
              services: [],
            }),
          },
        ],
      });
    const listCalendarAttendances = listShopAttendanceCalendarByStoreDateRangeFactory(firestoreDB);

    const attendances = await listCalendarAttendances(
      "owner-1",
      "store-1",
      "2026-07-23",
      "2026-07-23",
      { skipCache: true },
    );

    expect(attendances).toEqual([expect.objectContaining({ id: "attendance-1" })]);
    expect(getAttendanceDocuments).toHaveBeenCalledTimes(2);
  });
});
