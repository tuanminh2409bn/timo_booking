import { Firestore } from "@google-cloud/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheDeleteByPrefixMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const invalidateWeeklyReportMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const deleteWeeklyReportsByWeekMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/repository/cache/cache-client.js", async (importOriginal) => {
  const cacheClientModule =
    await importOriginal<typeof import("../../src/repository/cache/cache-client.js")>();

  return {
    ...cacheClientModule,
    cacheDeleteByPrefix: cacheDeleteByPrefixMock,
  };
});

vi.mock("../../src/helpers/weekly-report-cache.js", async (importOriginal) => {
  const weeklyReportCacheModule =
    await importOriginal<typeof import("../../src/helpers/weekly-report-cache.js")>();

  return {
    ...weeklyReportCacheModule,
    invalidateWeeklyReport: invalidateWeeklyReportMock,
  };
});

vi.mock("../../src/repository/firestore/shop/weekly-report.repository.js", async (importOriginal) => {
  const weeklyReportRepositoryModule =
    await importOriginal<typeof import("../../src/repository/firestore/shop/weekly-report.repository.js")>();

  return {
    ...weeklyReportRepositoryModule,
    deleteWeeklyReportsByWeekFactory: vi.fn(() => deleteWeeklyReportsByWeekMock),
  };
});
import {
  getShopWorkDaySettlementFactory,
  listClosedShopWorkDaySettlementFinancialProjectionByStoreDateRangeFactory,
  listShopWorkDaySettlementsByStatusPaginatedFactory,
  markShopWorkDaySettlementEmployeeClosedFactory,
  upsertShopWorkDaySettlementFactory,
} from "../../src/repository/firestore/shop/shop-work-day-settlement-factory.js";
import type { ShopWorkDaySettlementType } from "../../src/repository/firestore/shop/shop.types.js";
import { notifyWorkDaySettlementCommit } from "../../src/repository/firestore/shop/work-day-settlement-commit-observer.js";

const createSettlement = (workDate: string): ShopWorkDaySettlementType => ({
  id: workDate,
  ownerId: "owner-1",
  storeId: "store-1",
  workDate,
  settlementEligibleAt: Date.parse(`${workDate}T00:00:00.000Z`),
  status: "open",
  attendance: {
    totalCount: 1,
    openCount: 1,
    closedCount: 0,
    incompleteCount: 0,
    employeeTotalCount: 1,
    employeeClosedCount: 0,
  },
  employees: [],
  totalRevenue: 100,
  totalDiscount: 0,
  totalNetAmount: 100,
  totalOwnerNetAfterDiscount: 0,
  attendanceVersion: `version-${workDate}`,
  previewOwnerDiscountCoverageRate: 50,
  preview: {
    employeeSummaries: [],
    compensationConfigurationErrors: [],
    totalRevenue: 100,
    totalDiscount: 0,
    totalEmployeeDiscount: 0,
    totalOwnerDiscount: 0,
    totalOwnerDiscountAbsorbed: 0,
    totalEmployeeDiscountAllocated: 0,
    totalUnallocatedDiscount: 0,
    totalNetAmount: 100,
    totalOwnerCommission: 0,
    totalOwnerNetAfterDiscount: 0,
    totalEmployeeEarning: 0,
    allocationSource: "workday",
    discountTargetEmployeeUserIds: [],
    discountEligibleEmployeeUserIds: [],
    submittedEmployeeUserIds: [],
    incompleteAttendanceIds: [],
  },
  pendingEmployees: [],
  serviceSummaries: [],
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
});

const createSettlementDocument = (settlement: ShopWorkDaySettlementType) => ({
  id: settlement.id,
  exists: true,
  ref: { path: `stores/store-1/work_day_settlements/${settlement.id}` },
  data: () => settlement,
});

const createSettlementFirestore = (
  settlementDocument: ReturnType<typeof createSettlementDocument>,
) => {
  const transaction = {
    get: vi.fn().mockResolvedValue(settlementDocument),
    set: vi.fn(),
  };
  const firestoreDB = new Firestore({ projectId: "test-project" });
  const documentReference = {
    get: vi.fn().mockResolvedValue(settlementDocument),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  Reflect.set(
    firestoreDB,
    "collection",
    vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => ({
            ...documentReference,
          })),
        })),
      })),
    })),
  );
  Reflect.set(firestoreDB, "runTransaction", vi.fn());

  return { firestoreDB, transaction, documentReference };
};

describe("work-day settlement repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheDeleteByPrefixMock.mockResolvedValue(undefined);
    invalidateWeeklyReportMock.mockResolvedValue(undefined);
    deleteWeeklyReportsByWeekMock.mockResolvedValue(undefined);
  });

  it("does not let a commit observer change persistence behavior", () => {
    expect(() =>
      notifyWorkDaySettlementCommit(
        () => {
          throw new Error("observer failed");
        },
        {
          stage: "employee_closing",
          persistAction: "overwrite",
        },
      ),
    ).not.toThrow();
  });

  it("rejects an invalid stored settlement document", async () => {
    const firestoreDB = new Firestore({ projectId: "test-project" });
    const invalidSettlement = createSettlement("2026-07-23");
    invalidSettlement.attendance.totalCount = -1;

    Reflect.set(
      firestoreDB,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                id: "2026-07-23",
                exists: true,
                ref: { path: "stores/store-1/work_day_settlements/2026-07-23" },
                data: () => invalidSettlement,
              }),
            })),
          })),
        })),
      })),
    );

    const getSettlement = getShopWorkDaySettlementFactory(firestoreDB);

    await expect(getSettlement("owner-1", "store-1", "2026-07-23")).rejects.toMatchObject({
      statusCode: 500,
      type: "/database/invalid-document",
    });
  });

  it("rejects a stored settlement whose work date does not match the document path", async () => {
    const firestoreDB = new Firestore({ projectId: "test-project" });
    const settlementWithMismatchedWorkDate = createSettlement("2026-07-22");

    Reflect.set(
      firestoreDB,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                id: "2026-07-23",
                exists: true,
                ref: { path: "stores/store-1/work_day_settlements/2026-07-23" },
                data: () => settlementWithMismatchedWorkDate,
              }),
            })),
          })),
        })),
      })),
    );

    const getSettlement = getShopWorkDaySettlementFactory(firestoreDB);

    await expect(getSettlement("owner-1", "store-1", "2026-07-23")).rejects.toMatchObject({
      statusCode: 500,
      type: "/database/invalid-document",
    });
  });

  it("selects and validates the closed settlement financial projection", async () => {
    const closedSettlement: ShopWorkDaySettlementType = {
      ...createSettlement("2026-07-23"),
      status: "closed",
      closing: {
        id: "closing-2026-07-23",
        closedAt: 1,
        closedByUserId: "owner-1",
        ownerDiscountCoverageRate: 50,
        discountAllocationMethod: "revenue_share",
        employeeSummaries: [],
        summary: {
          totalEntries: 1,
          subtotalAmount: 100,
          totalDiscountAmount: 0,
          totalNetAmount: 100,
          totalOwnerCommission: 40,
          totalEmployeeEarning: 60,
        },
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const openSettlement = createSettlement("2026-07-24");
    const query = {
      where: vi.fn(),
      orderBy: vi.fn(),
      select: vi.fn(),
      get: vi.fn().mockResolvedValue({
        docs: [
          createSettlementDocument(openSettlement),
          createSettlementDocument(closedSettlement),
        ],
      }),
    };
    query.where.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const firestoreDB = new Firestore({ projectId: "test-project" });

    Reflect.set(
      firestoreDB,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => query),
        })),
      })),
    );

    const listClosedSettlements =
      listClosedShopWorkDaySettlementFinancialProjectionByStoreDateRangeFactory(firestoreDB);
    const result = await listClosedSettlements("owner-1", "store-1", "2026-07-01", "2026-07-31");

    expect(query.where).toHaveBeenNthCalledWith(1, "workDate", ">=", "2026-07-01");
    expect(query.where).toHaveBeenNthCalledWith(2, "workDate", "<=", "2026-07-31");
    expect(query.orderBy).toHaveBeenCalledWith("workDate", "desc");
    expect(query.select).toHaveBeenCalledWith(
      "ownerId",
      "storeId",
      "workDate",
      "status",
      "updatedAt",
      "attendance.totalCount",
      "employees",
      "preview.employeeSummaries",
      "preview.totalEmployeeEarning",
      "preview.totalOwnerCommission",
      "serviceSummaries",
      "closing.id",
      "closing.closedAt",
      "closing.closedByUserId",
      "closing.ownerDiscountCoverageRate",
      "closing.discountAllocationMethod",
      "closing.employeeSummaries",
      "closing.summary",
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: "2026-07-23",
        status: "closed",
        workDate: "2026-07-23",
      }),
    ]);
  });

  it("rejects a closed financial projection without closing data", async () => {
    const invalidClosedSettlement: ShopWorkDaySettlementType = {
      ...createSettlement("2026-07-23"),
      status: "closed",
    };
    const query = {
      where: vi.fn(),
      orderBy: vi.fn(),
      select: vi.fn(),
      get: vi.fn().mockResolvedValue({
        docs: [createSettlementDocument(invalidClosedSettlement)],
      }),
    };
    query.where.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const firestoreDB = new Firestore({ projectId: "test-project" });

    Reflect.set(
      firestoreDB,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => query),
        })),
      })),
    );

    const listClosedSettlements =
      listClosedShopWorkDaySettlementFinancialProjectionByStoreDateRangeFactory(firestoreDB);

    await expect(
      listClosedSettlements("owner-1", "store-1", "2026-07-01", "2026-07-31"),
    ).rejects.toMatchObject({
      statusCode: 500,
      type: "/database/invalid-document",
    });
  });

  it("queries unsettled days by owner and eligibility with cursor pagination", async () => {
    const settlements = [
      createSettlement("2026-07-23"),
      createSettlement("2026-07-22"),
      createSettlement("2026-07-21"),
    ];
    const query = {
      where: vi.fn(),
      orderBy: vi.fn(),
      startAfter: vi.fn(),
      select: vi.fn(),
      limit: vi.fn(),
      get: vi.fn().mockResolvedValue({
        docs: settlements.map(createSettlementDocument),
      }),
    };
    query.where.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.startAfter.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const firestoreDB = new Firestore({ projectId: "test-project" });

    Reflect.set(
      firestoreDB,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => query),
        })),
      })),
    );

    const listSettlements = listShopWorkDaySettlementsByStatusPaginatedFactory(firestoreDB);
    const result = await listSettlements("owner-1", "store-1", ["open", "ready"], {
      limit: 2,
      cursorWorkDate: "2026-07-24",
      cursorSettlementEligibleAt: Date.parse("2026-07-24T00:00:00.000Z"),
      toSettlementEligibleAt: Date.parse("2026-07-23T23:59:59.999Z"),
    });

    expect(query.where).toHaveBeenNthCalledWith(1, "ownerId", "==", "owner-1");
    expect(query.where).toHaveBeenNthCalledWith(2, "status", "in", ["open", "ready"]);
    expect(query.where).toHaveBeenNthCalledWith(
      3,
      "settlementEligibleAt",
      "<=",
      Date.parse("2026-07-23T23:59:59.999Z"),
    );
    expect(query.orderBy).toHaveBeenNthCalledWith(1, "settlementEligibleAt", "desc");
    expect(query.orderBy).toHaveBeenNthCalledWith(2, "workDate", "desc");
    expect(query.startAfter).toHaveBeenCalledWith(
      Date.parse("2026-07-24T00:00:00.000Z"),
      "2026-07-24",
    );
    expect(query.select).toHaveBeenCalledWith(
      "ownerId",
      "storeId",
      "workDate",
      "settlementEligibleAt",
      "status",
      "attendance.employeeTotalCount",
      "attendance.employeeClosedCount",
      "employees",
    );
    expect(query.limit).toHaveBeenCalledWith(3);
    expect(result.settlements.map((settlement) => settlement.workDate)).toEqual([
      "2026-07-23",
      "2026-07-22",
    ]);
    expect(result.nextCursor).toEqual({
      workDate: "2026-07-22",
      settlementEligibleAt: Date.parse("2026-07-22T00:00:00.000Z"),
    });
    expect(result.hasMore).toBe(true);
  });

  it("emits one aggregate commit callback after a retried transaction", async () => {
    const settlement = createSettlement("2026-07-23");
    settlement.employees = [
      {
        employeeUserId: "employee-1",
        attendanceCount: 1,
        closedCount: 0,
        totalRevenue: 100,
      },
    ];
    const settlementDocument = createSettlementDocument(settlement);
    const { firestoreDB, transaction } = createSettlementFirestore(settlementDocument);
    const runTransaction = vi.fn();
    let transactionCallbackCount = 0;

    runTransaction.mockImplementation(async (callback) => {
      transactionCallbackCount += 1;
      await callback(transaction);
      transactionCallbackCount += 1;
      return callback(transaction);
    });
    Reflect.set(firestoreDB, "runTransaction", runTransaction);
    const onCommitted = vi.fn();
    const markEmployeeClosed = markShopWorkDaySettlementEmployeeClosedFactory(firestoreDB);

    await markEmployeeClosed("owner-1", "store-1", "2026-07-23", "employee-1", {
      onCommitted,
    });

    expect(transactionCallbackCount).toBe(2);
    expect(transaction.set).toHaveBeenCalledTimes(2);
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(onCommitted.mock.invocationCallOrder[0]).toBeGreaterThan(
      transaction.set.mock.invocationCallOrder[1] ?? 0,
    );
    expect(onCommitted).toHaveBeenCalledWith({
      stage: "aggregate_mark",
      persistAction: "overwrite",
      statusBefore: "open",
      statusAfter: "ready",
      revisionBefore: 1,
      revisionAfter: 2,
    });
  });

  it("reports a closed settlement commit before cache failure", async () => {
    const openSettlement = createSettlement("2026-07-23");
    const settlementDocument = createSettlementDocument(openSettlement);
    const { firestoreDB, transaction } = createSettlementFirestore(settlementDocument);
    const runTransaction = vi.fn().mockImplementation(async (callback) => callback(transaction));
    Reflect.set(firestoreDB, "runTransaction", runTransaction);
    cacheDeleteByPrefixMock.mockRejectedValue(new Error("redis unavailable"));
    const onCommitted = vi.fn();
    const closedSettlement: ShopWorkDaySettlementType = {
      ...openSettlement,
      status: "closed",
      closing: {
        id: "closing-2026-07-23",
        closedAt: 1,
        closedByUserId: "owner-1",
        ownerDiscountCoverageRate: 50,
        discountAllocationMethod: "revenue_share",
        employeeSummaries: [],
        summary: {
          totalEntries: 1,
          subtotalAmount: 100,
          totalDiscountAmount: 0,
          totalNetAmount: 100,
          totalOwnerCommission: 40,
          totalEmployeeEarning: 60,
        },
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const upsertSettlement = upsertShopWorkDaySettlementFactory(firestoreDB);

    await expect(
      upsertSettlement("owner-1", closedSettlement, { onCommitted }),
    ).rejects.toThrow("redis unavailable");

    expect(runTransaction).toHaveBeenCalledOnce();
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(onCommitted).toHaveBeenCalledWith({
      stage: "store_closing",
      persistAction: "overwrite",
      statusBefore: "open",
      statusAfter: "closed",
      revisionBefore: 1,
      revisionAfter: 2,
    });
  });
});
