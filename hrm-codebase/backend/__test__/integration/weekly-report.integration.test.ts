import request from "supertest";
import { describe, expect, it, beforeEach } from "vitest";
import type {
  ShopClosedWorkDaySettlementType,
  ShopWorkDaySettlementType,
} from "../../src/repository/firestore/shop/shop.types.js";
import type { WeeklyReportType } from "../../src/repository/firestore/shop/weekly-report.types.js";
import { app, ownerSessionHeader, state, withRequestDefaults } from "./backend-api-fixture.js";
import {
  generateWeeklyReport,
  getWeeksInRange,
  getWeeksInMonth,
  isCurrentWeek,
  aggregateWeeklyReports,
} from "../../src/helpers/weekly-report-generator.js";
import {
  getOrGenerateWeeklyReport,
  invalidateWeeklyReport,
  invalidateWeeklyReportsByStore,
  getCacheKey,
} from "../../src/helpers/weekly-report-cache.js";
import { cacheGetJson, cacheDeleteByPrefix } from "../../src/repository/cache/cache-client.js";

const createClosing = (
  patch: Partial<ShopClosedWorkDaySettlementType> &
    Pick<ShopClosedWorkDaySettlementType, "id" | "storeId" | "workDate">,
): ShopClosedWorkDaySettlementType => ({
  ownerId: "shop-1",
  closedAt: Date.now(),
  closedByUserId: "owner-1",
  ownerCommissionRate: 40,
  ownerDiscountCoverageRate: 0,
  discountAllocationMethod: "equal",
  discountEmployeeScope: "all",
  selectedEmployeeUserIds: [],
  attendanceDiscountOwnerShares: {},
  employeeSummaries: [],
  summary: {
    totalEntries: 0,
    subtotalAmount: 0,
    totalDiscountAmount: 0,
    totalEmployeeDiscountAmount: 0,
    totalOwnerDiscountAmount: 0,
    totalNetAmount: 0,
    totalOwnerCommission: 0,
    totalEmployeeEarning: 0,
  },
  revision: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...patch,
});

const seedWeeklyReportData = () => {
  // Boundary week: May 2026 starts on Friday, so the monthly report must still
  // use the weekly report for 2026-04-27 and clip it to May 1-3.
  state.closings.set(
    "closing-2026-05-01",
    createClosing({
      id: "closing-2026-05-01",
      storeId: "branch-1",
      workDate: "2026-05-01",
      employeeSummaries: [
        {
          employeeUserId: "staff-1",
          employeeName: "Staff One",
          compensationModel: "commission",
          commissionRate: 60,
          payType: "commission",
          ownerCommissionRate: 40,
          totalRevenue: 70,
          discountAllocated: 0,
          ownerDiscountSupported: 0,
          revenueAfterDiscount: 70,
          ownerCommission: 28,
          employeeEarning: 42,
          workedMinutes: 60,
          isSelectedForDiscount: false,
        },
      ],
      summary: {
        totalEntries: 1,
        subtotalAmount: 70,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 70,
        totalOwnerCommission: 28,
        totalEmployeeEarning: 42,
      },
    }),
  );

  // Week 1: May 5-11, 2026 (Monday to Sunday)
  state.closings.set(
    "closing-2026-05-05",
    createClosing({
      id: "closing-2026-05-05",
      storeId: "branch-1",
      workDate: "2026-05-05",
      employeeSummaries: [
        {
          employeeUserId: "staff-1",
          employeeName: "Staff One",
          compensationModel: "commission",
          commissionRate: 60,
          payType: "commission",
          ownerCommissionRate: 40,
          totalRevenue: 100,
          discountAllocated: 0,
          ownerDiscountSupported: 0,
          revenueAfterDiscount: 100,
          ownerCommission: 40,
          employeeEarning: 60,
          workedMinutes: 120,
          isSelectedForDiscount: false,
        },
      ],
      summary: {
        totalEntries: 2,
        subtotalAmount: 100,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 100,
        totalOwnerCommission: 40,
        totalEmployeeEarning: 60,
      },
    }),
  );

  state.closings.set(
    "closing-2026-05-06",
    createClosing({
      id: "closing-2026-05-06",
      storeId: "branch-1",
      workDate: "2026-05-06",
      employeeSummaries: [
        {
          employeeUserId: "staff-1",
          employeeName: "Staff One",
          compensationModel: "commission",
          commissionRate: 60,
          payType: "commission",
          ownerCommissionRate: 40,
          totalRevenue: 150,
          discountAllocated: 10,
          ownerDiscountSupported: 0,
          revenueAfterDiscount: 140,
          ownerCommission: 56,
          employeeEarning: 84,
          workedMinutes: 180,
          isSelectedForDiscount: false,
        },
        {
          employeeUserId: "staff-lead-1",
          employeeName: "Lead One",
          compensationModel: "commission",
          commissionRate: 70,
          payType: "commission",
          ownerCommissionRate: 30,
          totalRevenue: 80,
          discountAllocated: 0,
          ownerDiscountSupported: 0,
          revenueAfterDiscount: 80,
          ownerCommission: 24,
          employeeEarning: 56,
          workedMinutes: 90,
          isSelectedForDiscount: false,
        },
      ],
      summary: {
        totalEntries: 3,
        subtotalAmount: 230,
        totalDiscountAmount: 10,
        totalEmployeeDiscountAmount: 10,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 220,
        totalOwnerCommission: 80,
        totalEmployeeEarning: 140,
      },
    }),
  );

  // Week 1: Branch 2
  state.closings.set(
    "closing-2026-05-05-branch-2",
    createClosing({
      id: "closing-2026-05-05-branch-2",
      storeId: "branch-2",
      workDate: "2026-05-05",
      employeeSummaries: [
        {
          employeeUserId: "staff-2",
          employeeName: "Staff Two",
          compensationModel: "commission",
          commissionRate: 60,
          payType: "commission",
          ownerCommissionRate: 40,
          totalRevenue: 200,
          discountAllocated: 0,
          ownerDiscountSupported: 0,
          revenueAfterDiscount: 200,
          ownerCommission: 80,
          employeeEarning: 120,
          workedMinutes: 150,
          isSelectedForDiscount: false,
        },
      ],
      summary: {
        totalEntries: 4,
        subtotalAmount: 200,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 200,
        totalOwnerCommission: 80,
        totalEmployeeEarning: 120,
      },
    }),
  );

  for (const closing of state.closings.values()) {
    const settlement: ShopWorkDaySettlementType = {
      id: closing.workDate,
      ownerId: closing.ownerId,
      storeId: closing.storeId,
      workDate: closing.workDate,
      settlementEligibleAt: Date.parse(`${closing.workDate}T23:59:59.999Z`),
      status: "closed",
      attendance: {
        totalCount: closing.summary.totalEntries,
        openCount: 0,
        closedCount: closing.summary.totalEntries,
        incompleteCount: 0,
        employeeTotalCount: closing.employeeSummaries.length,
        employeeClosedCount: closing.employeeSummaries.length,
      },
      employees: [],
      totalRevenue: closing.summary.subtotalAmount,
      totalDiscount: closing.summary.totalDiscountAmount,
      totalNetAmount: closing.summary.totalNetAmount,
      totalOwnerNetAfterDiscount: 0,
      attendanceVersion: `weekly-report-${closing.id}`,
      previewOwnerDiscountCoverageRate: closing.ownerDiscountCoverageRate,
      preview: {
        employeeSummaries: closing.employeeSummaries,
        compensationConfigurationErrors: [],
        totalRevenue: closing.summary.subtotalAmount,
        totalDiscount: closing.summary.totalDiscountAmount,
        totalEmployeeDiscount: closing.summary.totalEmployeeDiscountAmount ?? 0,
        totalOwnerDiscount: closing.summary.totalOwnerDiscountAmount ?? 0,
        totalOwnerDiscountAbsorbed: closing.summary.totalOwnerDiscountAmount ?? 0,
        totalEmployeeDiscountAllocated: closing.summary.totalEmployeeDiscountAmount ?? 0,
        totalUnallocatedDiscount: 0,
        totalNetAmount: closing.summary.totalNetAmount,
        totalOwnerCommission: closing.summary.totalOwnerCommission,
        totalOwnerNetAfterDiscount: 0,
        totalEmployeeEarning: closing.summary.totalEmployeeEarning,
        allocationSource: "workday",
        discountTargetEmployeeUserIds: [],
        discountEligibleEmployeeUserIds: [],
        submittedEmployeeUserIds: closing.employeeSummaries.map(
          (employeeSummary) => employeeSummary.employeeUserId,
        ),
        incompleteAttendanceIds: [],
      },
      pendingEmployees: [],
      serviceSummaries: closing.serviceSummaries ?? [],
      closing: {
        id: closing.id,
        closedAt: closing.closedAt,
        closedByUserId: closing.closedByUserId,
        ownerDiscountCoverageRate: closing.ownerDiscountCoverageRate,
        discountAllocationMethod: "revenue_share",
        ...(closing.storeTimezone !== undefined && { storeTimezone: closing.storeTimezone }),
        summary: closing.summary,
        createdAt: closing.createdAt,
        updatedAt: closing.updatedAt,
      },
      revision: 1,
      createdAt: closing.createdAt,
      updatedAt: closing.updatedAt,
    };

    state.workDaySettlements.set(`${closing.storeId}__${closing.workDate}`, settlement);
  }
};

describe("Weekly Report Integration: Generation", () => {
  beforeEach(() => {
    seedWeeklyReportData();
  });

  it("generates weekly report for completed week", () => {
    const closings = [
      state.closings.get("closing-2026-05-05")!,
      state.closings.get("closing-2026-05-06")!,
    ];

    const report = generateWeeklyReport("shop-1", "branch-1", "2026-05-05", "owner-1", closings);

    expect(report.ownerId).toBe("shop-1");
    expect(report.storeId).toBe("branch-1");
    expect(report.weekStartDate).toBe("2026-05-05");
    expect(report.weekEndDate).toBe("2026-05-11");
    expect(report.year).toBe(2026);
    expect(report.weekNumber).toBe(19);
    expect(report.isPartial).toBe(false);
    expect(report.currency).toBe("EUR");
    expect(report.moneyScale).toBe(2);
    expect(report.revision).toBe(4);

    expect(report.summary).toMatchObject({
      totalAttendances: 5,
      totalRevenue: 330,
      totalRevenueMinor: 33000,
      totalDiscount: 10,
      totalDiscountMinor: 1000,
      totalNetRevenue: 320,
      totalNetRevenueMinor: 32000,
      totalOwnerCommission: 120,
      totalOwnerCommissionMinor: 12000,
      totalEmployeeEarnings: 200,
      totalEmployeeEarningsMinor: 20000,
      workingDays: 2,
    });

    expect(report.summary.averageTicketSize).toBeCloseTo(66, 1);

    expect(report.dailyMetrics).toHaveLength(2);
    expect(report.dailyMetrics[0]).toMatchObject({
      workDate: "2026-05-05",
      attendanceCount: 2,
      revenue: 100,
      revenueMinor: 10000,
      discount: 0,
      discountMinor: 0,
      netRevenue: 100,
      netRevenueMinor: 10000,
      ownerCommission: 40,
      ownerCommissionMinor: 4000,
      employeeEarnings: 60,
      employeeEarningsMinor: 6000,
    });

    expect(report.employeeBreakdowns).toHaveLength(2);
    const staff1Breakdown = report.employeeBreakdowns.find((e) => e.employeeUserId === "staff-1");
    expect(staff1Breakdown).toMatchObject({
      employeeUserId: "staff-1",
      employeeName: "Staff One",
      totalRevenue: 250,
      totalRevenueMinor: 25000,
      totalEarnings: 144,
      totalEarningsMinor: 14400,
      workingDays: 2,
    });
    expect(report.dailyEmployeeBreakdowns).toHaveLength(3);
    expect(
      report.dailyEmployeeBreakdowns?.filter((item) => item.employeeUserId === "staff-1"),
    ).toEqual([
      expect.objectContaining({ workDate: "2026-05-05", totalRevenue: 100 }),
      expect.objectContaining({ workDate: "2026-05-06", totalRevenue: 150 }),
    ]);

    expect(report.sourceClosingIds).toEqual(["closing-2026-05-05", "closing-2026-05-06"]);
    expect(report.generatedByUserId).toBe("owner-1");
  });

  it("stores money as integer minor units and rounds legacy number fields", () => {
    const report = generateWeeklyReport("shop-1", "branch-1", "2026-05-05", "owner-1", [
      createClosing({
        id: "closing-float-1",
        storeId: "branch-1",
        workDate: "2026-05-05",
        employeeSummaries: [
          {
            employeeUserId: "staff-1",
            employeeName: "Staff One",
            compensationModel: "commission",
            commissionRate: 60,
            payType: "commission",
            ownerCommissionRate: 40,
            totalRevenue: 0.1,
            discountAllocated: 0,
            ownerDiscountSupported: 0,
            revenueAfterDiscount: 0.1,
            ownerCommission: 0.04,
            employeeEarning: 0.06,
            workedMinutes: 30,
            isSelectedForDiscount: false,
          },
        ],
        summary: {
          totalEntries: 1,
          subtotalAmount: 0.1,
          totalDiscountAmount: 0,
          totalEmployeeDiscountAmount: 0,
          totalOwnerDiscountAmount: 0,
          totalNetAmount: 0.1,
          totalOwnerCommission: 0.04,
          totalEmployeeEarning: 0.06,
        },
      }),
      createClosing({
        id: "closing-float-2",
        storeId: "branch-1",
        workDate: "2026-05-06",
        employeeSummaries: [
          {
            employeeUserId: "staff-1",
            employeeName: "Staff One",
            compensationModel: "commission",
            commissionRate: 60,
            payType: "commission",
            ownerCommissionRate: 40,
            totalRevenue: 0.2,
            discountAllocated: 0,
            ownerDiscountSupported: 0,
            revenueAfterDiscount: 0.2,
            ownerCommission: 0.08,
            employeeEarning: 0.12,
            workedMinutes: 30,
            isSelectedForDiscount: false,
          },
        ],
        summary: {
          totalEntries: 1,
          subtotalAmount: 0.2,
          totalDiscountAmount: 0,
          totalEmployeeDiscountAmount: 0,
          totalOwnerDiscountAmount: 0,
          totalNetAmount: 0.2,
          totalOwnerCommission: 0.08,
          totalEmployeeEarning: 0.12,
        },
      }),
    ]);

    expect(report.summary.totalRevenue).toBe(0.3);
    expect(report.summary.totalRevenueMinor).toBe(30);
    expect(report.summary.totalOwnerCommission).toBe(0.12);
    expect(report.summary.totalOwnerCommissionMinor).toBe(12);
    expect(report.employeeBreakdowns[0]).toMatchObject({
      totalRevenue: 0.3,
      totalRevenueMinor: 30,
      totalEarnings: 0.18,
      totalEarningsMinor: 18,
    });
  });

  it("generates weekly report for current (partial) week", () => {
    // Use a future date to ensure it's treated as partial
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dayOfWeek = futureDate.getDay();
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    futureDate.setDate(futureDate.getDate() + daysToMonday);
    const weekStartDate = futureDate.toISOString().slice(0, 10);

    const closings = [
      createClosing({
        id: "closing-current",
        storeId: "branch-1",
        workDate: weekStartDate,
        summary: {
          totalEntries: 1,
          subtotalAmount: 50,
          totalDiscountAmount: 0,
          totalEmployeeDiscountAmount: 0,
          totalOwnerDiscountAmount: 0,
          totalNetAmount: 50,
          totalOwnerCommission: 20,
          totalEmployeeEarning: 30,
        },
      }),
    ];

    const report = generateWeeklyReport("shop-1", "branch-1", weekStartDate, "owner-1", closings);

    expect(report.isPartial).toBe(true);
    expect(report.weekStartDate).toBe(weekStartDate);
  });

  it("generates empty weekly report when no closings exist", () => {
    const report = generateWeeklyReport("shop-1", "branch-1", "2026-05-12", "owner-1", []);

    expect(report.summary).toMatchObject({
      totalAttendances: 0,
      totalRevenue: 0,
      totalDiscount: 0,
      totalNetRevenue: 0,
      totalOwnerCommission: 0,
      totalEmployeeEarnings: 0,
      averageTicketSize: 0,
      workingDays: 0,
    });

    expect(report.dailyMetrics).toHaveLength(0);
    expect(report.employeeBreakdowns).toHaveLength(0);
  });
});

describe("Weekly Report Integration: Aggregation", () => {
  it("aggregates multiple weekly reports", () => {
    const report1: WeeklyReportType = {
      id: "report-1",
      ownerId: "shop-1",
      storeId: "branch-1",
      weekStartDate: "2026-05-05",
      weekEndDate: "2026-05-11",
      year: 2026,
      weekNumber: 19,
      isPartial: false,
      summary: {
        totalAttendances: 10,
        totalRevenue: 500,
        totalDiscount: 20,
        totalNetRevenue: 480,
        totalOwnerCommission: 192,
        totalEmployeeEarnings: 288,
        averageTicketSize: 50,
        workingDays: 5,
      },
      dailyMetrics: [],
      employeeBreakdowns: [],
      serviceBreakdowns: [],
      generatedAt: Date.now(),
      generatedByUserId: "owner-1",
      sourceClosingIds: [],
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const report2: WeeklyReportType = {
      ...report1,
      id: "report-2",
      weekStartDate: "2026-05-12",
      weekEndDate: "2026-05-18",
      weekNumber: 20,
      summary: {
        totalAttendances: 15,
        totalRevenue: 750,
        totalDiscount: 30,
        totalNetRevenue: 720,
        totalOwnerCommission: 288,
        totalEmployeeEarnings: 432,
        averageTicketSize: 50,
        workingDays: 6,
      },
    };

    const aggregated = aggregateWeeklyReports([report1, report2]);

    expect(aggregated).toMatchObject({
      totalAttendances: 25,
      totalRevenue: 1250,
      totalDiscount: 50,
      totalNetRevenue: 1200,
      totalOwnerCommission: 480,
      totalEmployeeEarnings: 720,
      workingDays: 11,
    });

    expect(aggregated.averageTicketSize).toBe(50);
  });

  it("aggregates empty weekly reports array", () => {
    const aggregated = aggregateWeeklyReports([]);

    expect(aggregated).toMatchObject({
      totalAttendances: 0,
      totalRevenue: 0,
      totalDiscount: 0,
      totalNetRevenue: 0,
      totalOwnerCommission: 0,
      totalEmployeeEarnings: 0,
      averageTicketSize: 0,
      workingDays: 0,
    });
  });
});

describe("Weekly Report Integration: Cache Behavior", () => {
  beforeEach(async () => {
    seedWeeklyReportData();
    await cacheDeleteByPrefix("store:shop-1:weekly-report:");
  });

  it("caches generated weekly report and returns cached version on subsequent calls", async () => {
    const closings = [
      state.closings.get("closing-2026-05-05")!,
      state.closings.get("closing-2026-05-06")!,
    ];

    let generatorCallCount = 0;
    const generator = async () => {
      generatorCallCount++;
      return generateWeeklyReport(
        "shop-1",
        "branch-1",
        "2026-05-05",
        "owner-1",
        closings,
      ) as WeeklyReportType;
    };

    const report1 = await getOrGenerateWeeklyReport("shop-1", "branch-1", "2026-05-05", generator);
    expect(generatorCallCount).toBe(1);
    expect(report1!.summary.totalRevenue).toBe(330);

    const report2 = await getOrGenerateWeeklyReport("shop-1", "branch-1", "2026-05-05", generator);
    expect(generatorCallCount).toBe(1); // Should not call generator again
    expect(report2!.summary.totalRevenue).toBe(330);
  });

  it("invalidates specific weekly report from cache", async () => {
    const closings = [state.closings.get("closing-2026-05-05")!];
    const generator = async () =>
      generateWeeklyReport(
        "shop-1",
        "branch-1",
        "2026-05-05",
        "owner-1",
        closings,
      ) as WeeklyReportType;

    await getOrGenerateWeeklyReport("shop-1", "branch-1", "2026-05-05", generator);

    const cacheKey = getCacheKey("shop-1", "branch-1", "2026-05-05");
    let cached = await cacheGetJson(cacheKey);
    expect(cached).toBeDefined();

    await invalidateWeeklyReport("shop-1", "branch-1", "2026-05-05");

    cached = await cacheGetJson(cacheKey);
    expect(cached).toBeUndefined();
  });

  it("invalidates all weekly reports for a branch", async () => {
    const closings1 = [state.closings.get("closing-2026-05-05")!];
    const closings2 = [state.closings.get("closing-2026-05-06")!];

    await getOrGenerateWeeklyReport(
      "shop-1",
      "branch-1",
      "2026-05-05",
      async () =>
        generateWeeklyReport(
          "shop-1",
          "branch-1",
          "2026-05-05",
          "owner-1",
          closings1,
        ) as WeeklyReportType,
    );
    await getOrGenerateWeeklyReport(
      "shop-1",
      "branch-1",
      "2026-05-12",
      async () =>
        generateWeeklyReport(
          "shop-1",
          "branch-1",
          "2026-05-12",
          "owner-1",
          closings2,
        ) as WeeklyReportType,
    );

    await invalidateWeeklyReportsByStore("shop-1", "branch-1");

    const cache1 = await cacheGetJson(getCacheKey("shop-1", "branch-1", "2026-05-05"));
    const cache2 = await cacheGetJson(getCacheKey("shop-1", "branch-1", "2026-05-12"));

    expect(cache1).toBeUndefined();
    expect(cache2).toBeUndefined();
  });
});

describe("Weekly Report Integration: Cache Invalidation", () => {
  beforeEach(async () => {
    seedWeeklyReportData();
    await cacheDeleteByPrefix("store:shop-1:weekly-report:");
  });

  it("invalidates weekly report from cache on demand", async () => {
    const closings = [state.closings.get("closing-2026-05-05")!];
    await getOrGenerateWeeklyReport(
      "shop-1",
      "branch-1",
      "2026-05-05",
      async () =>
        generateWeeklyReport(
          "shop-1",
          "branch-1",
          "2026-05-05",
          "owner-1",
          closings,
        ) as WeeklyReportType,
    );

    const cacheKey = getCacheKey("shop-1", "branch-1", "2026-05-05");
    let cached = await cacheGetJson(cacheKey);
    expect(cached).toBeDefined();

    await invalidateWeeklyReport("shop-1", "branch-1", "2026-05-05");

    cached = await cacheGetJson(cacheKey);
    expect(cached).toBeUndefined();
  });
});

describe("Weekly Report Integration: Fallback to Real-Time Query", () => {
  beforeEach(() => {
    seedWeeklyReportData();
  });

  it("falls back to real-time query when weekly report is missing", async () => {
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.summary.totalRevenue).toBeGreaterThan(0);
    expect(response.body.meta).toBeDefined();
  });
});

describe("Weekly Report API: /api/v1/weekly-reports", () => {
  beforeEach(() => {
    seedWeeklyReportData();
  });

  it("generates, reads, and lists a weekly report", async () => {
    const ownerAuth = ownerSessionHeader();

    const createResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/weekly-reports")
        .set("Authorization", ownerAuth)
        .send({ weekStartDate: "2026-05-04" }),
    );

    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.etag).toEqual(expect.any(String));
    expect(createResponse.body.item).toMatchObject({
      storeId: "branch-1",
      weekStartDate: "2026-05-04",
      summary: expect.objectContaining({ totalRevenue: 330 }),
    });

    const detailResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/weekly-reports/2026-05-04")
        .query({ storeId: "branch-1" })
        .set("Authorization", ownerAuth),
    );

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.item.id).toBe(createResponse.body.item.id);

    const listResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/weekly-reports")
        .query({
          fromWeek: "2026-05-04",
          toWeek: "2026-05-04",
          aggregate: "true",
        })
        .set("Authorization", ownerAuth),
    );

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.items).toHaveLength(1);
    expect(listResponse.body.aggregate.totalRevenue).toBe(330);
  });

  it("guards weekly report validation and owner-only writes", async () => {
    const ownerAuth = ownerSessionHeader();
    const adminAuth = ownerSessionHeader({ uid: "admin-1", role: "admin" });
    const staffAuth = ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" });

    const invalidResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/weekly-reports")
        .set("Authorization", ownerAuth)
        .send({ weekStartDate: "2026-05-05" }),
    );
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.type).toBe("/stores/weekly-reports/invalid-request");

    const adminForbiddenResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/weekly-reports")
        .set("Authorization", adminAuth)
        .send({ weekStartDate: "2026-05-04" }),
    );
    // Firebase-only: admin không có store claims trong idToken → token không hợp lệ cho store API → 401.
    expect(adminForbiddenResponse.status).toBe(401);
    expect(adminForbiddenResponse.body.type).toBe("/auth/token-invalid");

    const forbiddenResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/weekly-reports")
        .set("Authorization", staffAuth)
        .send({ weekStartDate: "2026-05-04" }),
    );
    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenResponse.body.type).toBe("/stores/weekly-reports/forbidden-role");
  });
});

describe("Weekly Report Integration: Cross-Branch Aggregation", () => {
  beforeEach(() => {
    seedWeeklyReportData();
  });

  it("generates separate weekly reports for different stores", () => {
    const closingsBranch1 = [
      state.closings.get("closing-2026-05-05")!,
      state.closings.get("closing-2026-05-06")!,
    ];
    const closingsBranch2 = [state.closings.get("closing-2026-05-05-branch-2")!];

    const report1 = generateWeeklyReport(
      "shop-1",
      "branch-1",
      "2026-05-05",
      "owner-1",
      closingsBranch1,
    ) as WeeklyReportType;
    const report2 = generateWeeklyReport(
      "shop-1",
      "branch-2",
      "2026-05-05",
      "owner-1",
      closingsBranch2,
    ) as WeeklyReportType;

    expect(report1.storeId).toBe("branch-1");
    expect(report1.summary.totalRevenue).toBe(330);

    expect(report2.storeId).toBe("branch-2");
    expect(report2.summary.totalRevenue).toBe(200);

    const aggregated = aggregateWeeklyReports([report1, report2]);
    expect(aggregated.totalRevenue).toBe(530);
  });
});

describe("Weekly Report Integration: Monthly Salary Calculation", () => {
  beforeEach(() => {
    seedWeeklyReportData();
  });

  it("uses closed settlements for monthly salary calculation", async () => {
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/salaries/monthly")
        .query({ year: "2026", month: "5" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.period).toMatchObject({
      year: 2026,
      month: 5,
    });
    expect(response.body.summary.totalSalary).toBeGreaterThanOrEqual(0);
    expect(response.body.meta).toMatchObject({
      source: "closed_work_day",
      realTimeClosingsUsed: 3,
    });
    expect(state.weeklyReports.size).toBe(0);
  });
});

describe("Weekly Report Integration: Owner Report Using Weekly Reports", () => {
  beforeEach(() => {
    seedWeeklyReportData();
  });

  it("returns owner report using weekly reports for completed weeks", async () => {
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({
      totalRevenue: expect.any(Number),
      totalAttendance: expect.any(Number),
    });
    expect(response.body.meta).toBeDefined();
  });

  it("returns owner report with summary only using weekly reports", async () => {
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({
          fromWorkDate: "2026-05-05",
          toWorkDate: "2026-05-06",
          summaryOnly: "true",
        })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toBeUndefined();
    expect(response.body.summary).toBeDefined();
  });

  it("uses weekly reports for calendar-month owner summary without scanning the whole month", async () => {
    await cacheDeleteByPrefix("store:shop-1:response:employee-report:");
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({
          fromWorkDate: "2026-05-01",
          toWorkDate: "2026-05-31",
          groupBy: "month",
          summaryOnly: "true",
          debug: "true",
        })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.summary.totalRevenue).toBeGreaterThanOrEqual(330);
    expect(response.body.meta).toMatchObject({
      optimized: true,
      source: "weekly-report-hybrid",
      weeklyReportsUsed: expect.any(Number),
      rawAttendanceCount: expect.any(Number),
    });
    expect(response.body.meta.rawAttendanceCount).toBe(0);
    expect(response.body.meta.settlementDateRangesUsed).toEqual(expect.any(Array));
  });
});

describe("Weekly Report Integration: Employee Portal Report Using Weekly Reports", () => {
  beforeEach(async () => {
    seedWeeklyReportData();
    await cacheDeleteByPrefix("store:shop-1:weekly-report:");
  });

  it("returns staff summaryOnly report from weekly reports for completed weeks", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/me/report")
        .query({
          fromWorkDate: "2026-05-04",
          toWorkDate: "2026-05-10",
          summaryOnly: "true",
        })
        .set("Authorization", staffAuth),
    );

    expect(response.status).toBe(200);
    expect(response.headers.etag).toEqual(expect.any(String));
    expect(response.body.report).toMatchObject({
      attendanceCount: 2,
      settledRevenue: 250,
      settledEarning: 144,
      settledDayCount: 2,
      totalWorkedMinutes: 300,
      closedAttendanceCount: 2,
      openAttendanceCount: 0,
    });
    expect(response.body.items).toEqual([]);
    expect(response.body.closings).toBeUndefined();
    expect(response.body.attendances).toBeUndefined();
    expect(response.body.meta).toMatchObject({
      employeeUserId: "staff-1",
      storeId: "branch-1",
      fromWorkDate: "2026-05-04",
      toWorkDate: "2026-05-10",
      summaryOnly: true,
      source: "weekly-report",
      weeklyReportsUsed: 1,
    });
    expect(
      Array.from(state.weeklyReports.values()).some(
        (report) => report.storeId === "branch-1" && report.weekStartDate === "2026-05-04",
      ),
    ).toBe(true);
  });

  it("uses weekly reports for staff calendar-month summary and only falls back for uncovered days", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/me/report")
        .query({
          fromWorkDate: "2026-05-01",
          toWorkDate: "2026-05-31",
          summaryOnly: "true",
        })
        .set("Authorization", staffAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.report.settledRevenue).toBeGreaterThanOrEqual(250);
    expect(response.body.meta).toMatchObject({
      employeeUserId: "staff-1",
      storeId: "branch-1",
      fromWorkDate: "2026-05-01",
      toWorkDate: "2026-05-31",
      summaryOnly: true,
      source: expect.stringMatching(/^weekly-report(-hybrid)?$/),
      weeklyReportsUsed: expect.any(Number),
    });
    expect(response.body.meta.weeklyReportsUsed).toBeGreaterThan(0);
    if (response.body.meta.rawDateRangesUsed !== undefined) {
      expect(response.body.meta.rawDateRangesUsed).not.toEqual([
        { fromWorkDate: "2026-05-01", toWorkDate: "2026-05-31" },
      ]);
    }
  });
});

describe("Weekly Report Integration: Error Handling", () => {
  it("handles missing closings gracefully", () => {
    const report = generateWeeklyReport("shop-1", "branch-1", "2026-06-01", "owner-1", []);

    expect(report.summary.totalRevenue).toBe(0);
    expect(report.dailyMetrics).toHaveLength(0);
  });

  it("handles invalid date range in owner report", async () => {
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-10", toWorkDate: "2026-05-05" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(400);
  });

  it("handles invalid date format in owner report", async () => {
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "not-a-date", toWorkDate: "2026-05-10" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(400);
  });
});

describe("Weekly Report Integration: Helper Functions", () => {
  it("calculates weeks in date range correctly", () => {
    const weeks = getWeeksInRange("2026-05-01", "2026-05-31");
    expect(weeks).toEqual(["2026-04-27", "2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25"]);
  });

  it("calculates weeks in month correctly", () => {
    const weeks = getWeeksInMonth(2026, 5);
    expect(weeks).toEqual(["2026-04-27", "2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25"]);
  });

  it("identifies current week correctly", () => {
    // Mirror the UTC-based getMondayOfWeek logic from weekly-report-generator.ts
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + daysToMonday);
    monday.setUTCHours(0, 0, 0, 0);
    const weekStartDate = monday.toISOString().slice(0, 10);

    expect(isCurrentWeek(weekStartDate)).toBe(true);
    expect(isCurrentWeek("2026-05-05")).toBe(false);
  });
});
