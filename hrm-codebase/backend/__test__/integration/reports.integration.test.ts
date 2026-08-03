import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShopWorkDayEmployeeSummaryType } from "../../src/repository/firestore/shop/shop.types.js";
import {
  app,
  ownerSessionHeader,
  withRequestDefaults,
  state,
  getAttendanceOrThrow,
  seedClosedWorkDaySettlement,
} from "./backend-api-fixture.js";

afterEach(() => {
  vi.useRealTimers();
});

const seedReportData = () => {
  const now = Date.now();
  const attendance1 = getAttendanceOrThrow("attendance-1");
  const attendance2 = getAttendanceOrThrow("attendance-2");

  state.attendances.set("attendance-1", {
    ...attendance1,
    status: "closed",
    closedAt: now,
    closedBy: "owner-1",
  });

  state.attendances.set("attendance-2", {
    ...attendance2,
    status: "closed",
    closedAt: now,
    closedBy: "owner-1",
  });

  state.attendances.set("attendance-report-3", {
    ...attendance1,
    id: "attendance-report-3",
    workDate: "2026-05-06",
    storeWorkDateKey: "branch-1__2026-05-06",
    totalAmount: 75,
    status: "closed",
    closedAt: now,
    closedBy: "owner-1",
  });

  seedClosedWorkDaySettlement({
    id: "closing-report-1",
    ownerId: "shop-1",
    storeId: "branch-1",
    workDate: "2026-05-05",
    closedAt: now,
    closedByUserId: "owner-1",
    ownerCommissionRate: 40,
    ownerDiscountCoverageRate: 50,
    discountAllocationMethod: "equal",
    employeeSummaries: [],
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
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });

  seedClosedWorkDaySettlement({
    id: "closing-report-2",
    ownerId: "shop-1",
    storeId: "branch-1",
    workDate: "2026-05-06",
    closedAt: now,
    closedByUserId: "owner-1",
    ownerCommissionRate: 40,
    ownerDiscountCoverageRate: 50,
    discountAllocationMethod: "equal",
    employeeSummaries: [],
    summary: {
      totalEntries: 1,
      subtotalAmount: 75,
      totalDiscountAmount: 5,
      totalEmployeeDiscountAmount: 5,
      totalOwnerDiscountAmount: 0,
      totalNetAmount: 70,
      totalOwnerCommission: 28,
      totalEmployeeEarning: 42,
    },
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
};

describe("Reports Integration: Owner Summary Report", () => {
  it("returns the complete dashboard projection from one report resource", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/dashboard")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        dailyRevenue: expect.any(Array),
        dailyAppointments: expect.any(Array),
        employeePerformance: expect.any(Array),
        serviceReport: expect.any(Array),
        summary: expect.objectContaining({
          totalRevenue: expect.any(Number),
          totalExpense: expect.any(Number),
        }),
        meta: expect.objectContaining({ storeId: "branch-1" }),
      }),
    );
    expect(response.headers.etag).toEqual(expect.any(String));
  });

  it("reuses verified report scope before returning a conditional cache response", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader({ uid: "owner-report-cache-test" });
    const reportRequestPath = "/api/v1/stores/branch-1/reports/dashboard";
    const reportQuery = { fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" };

    const firstResponse = await withRequestDefaults(
      request(app).get(reportRequestPath).query(reportQuery).set("Authorization", ownerAuth),
    );
    const secondResponse = await withRequestDefaults(
      request(app)
        .get(reportRequestPath)
        .query(reportQuery)
        .set("Authorization", ownerAuth)
        .set("If-None-Match", firstResponse.headers.etag),
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(304);
    expect(secondResponse.headers["server-timing"]).toContain(
      'auth_verify;desc="memory-cache";dur=0',
    );
    expect(secondResponse.headers["server-timing"]).toContain(
      'store_scope;desc="memory-cache";dur=0',
    );
    expect(secondResponse.headers["server-timing"]).toContain(
      'report_cache_version;desc="memory-cache";dur=0',
    );
  });

  it("returns owner summary report for single branch with date range", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({
      startDate: "2026-05-05",
      endDate: "2026-05-06",
      totalCount: 2,
    });
    expect(response.body.meta).not.toHaveProperty("storeCount");
    expect(response.body.items).toBeUndefined();
    expect(response.body).not.toHaveProperty("employeePerformance");
    expect(response.body).not.toHaveProperty("serviceReport");
    expect(response.body.dailyRevenue).toEqual(expect.any(Array));
    expect(response.headers.etag).toEqual(expect.any(String));
  });

  it("returns only the overview projection and includes the requested expense total", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();
    const now = Date.now();

    state.expenses.set("expense-report-1", {
      id: "expense-report-1",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-06",
      name: "Supplies",
      amount: 20,
      createdByUserId: "owner-1",
      updatedByUserId: "owner-1",
      createdAt: now,
      updatedAt: now,
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.summary.totalExpense).toBe(20);
    expect(response.body).not.toHaveProperty("employeePerformance");
    expect(response.body).not.toHaveProperty("serviceReport");
    expect(response.body).not.toHaveProperty("items");
  });

  it("keeps report revenue from attendance service snapshots after catalog price changes", async () => {
    const ownerAuth = ownerSessionHeader();
    const now = Date.now();
    const attendance = getAttendanceOrThrow("attendance-1");

    state.attendances.set("attendance-1", {
      ...attendance,
      status: "closed",
      closedAt: now,
      closedBy: "owner-1",
    });

    const updateServiceResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/services/service-1")
        .set("Authorization", ownerAuth)
        .send({ price: "999" }),
    );
    expect(updateServiceResponse.status).toBe(200);
    expect(state.services.get("service-1")?.price).toBe(999);
    expect(getAttendanceOrThrow("attendance-1").services[0]?.price).toBe(50);

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-05" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.summary.totalRevenue).toBe(50);
    const serviceResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/service-performance")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-05" })
        .set("Authorization", ownerAuth),
    );

    expect(serviceResponse.body.serviceReport).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceId: "service-1",
          revenue: 50,
        }),
      ]),
    );
  });

  it("returns owner summary report filtered by specific branch", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({
      totalCount: 2,
    });
    expect(response.body.items).toBeUndefined();
    expect(response.body.dailyRevenue).toEqual(expect.any(Array));
  });

  it("returns owner summary report with summary only (no items)", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({
          fromWorkDate: "2026-05-05",
          toWorkDate: "2026-05-06",
        })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toBeUndefined();
    expect(response.body.summary).toMatchObject({
      totalAttendance: expect.any(Number),
    });
    expect(response.body.dailyRevenue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: expect.any(String),
          attendanceCount: expect.any(Number),
        }),
      ]),
    );
  });

  it("returns cancelled appointment activity separately from appointment totals", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();
    const attendance = getAttendanceOrThrow("attendance-1");

    state.attendances.set("attendance-cancelled-report", {
      ...attendance,
      id: "attendance-cancelled-report",
      workDate: "2026-05-06",
      storeWorkDateKey: "branch-1__2026-05-06",
      bookingStatus: "cancelled",
      subtotalAmount: 0,
      totalAmount: 0,
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({
          fromWorkDate: "2026-05-05",
          toWorkDate: "2026-05-06",
        })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.summary.totalCancelledAppointments).toBe(1);
    expect(response.body.dailyAppointments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: "2026-05-06",
          cancelledCount: 1,
        }),
      ]),
    );
  });

  it("keeps settled historical revenue authoritative for post-settlement custom attendance", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();
    const attendance = getAttendanceOrThrow("attendance-1");

    state.attendances.set("attendance-custom-service-report", {
      ...attendance,
      id: "attendance-custom-service-report",
      workDate: "2026-05-06",
      storeWorkDateKey: "branch-1__2026-05-06",
      subtotalAmount: 30,
      totalAmount: 30,
      services: [
        {
          ...attendance.services[0]!,
          id: "custom-polish-fix",
          sourceServiceId: undefined,
          type: "custom",
          name: "Sửa móng phát sinh",
          price: 30,
          employees: [
            {
              employeeUserId: "staff-1",
              employeeName: "Staff One",
              percentage: 100,
              shareAmount: 30,
            },
          ],
        },
      ],
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.summary.totalRevenue).toBe(125);
    expect(response.body.meta.totalCount).toBe(2);
    const serviceResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/service-performance")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth),
    );

    expect(serviceResponse.body.serviceReport).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ serviceId: "custom-polish-fix" })]),
    );
    expect(response.body.items).toBeUndefined();
  });

  it("splits a mixed current-week range between historical settlements and live attendance", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-22T05:00:00.000Z"));
    const now = Date.now();
    const baseAttendance = getAttendanceOrThrow("attendance-1");

    state.weeklyReports.set("branch-1__2026-07-13", {
      id: "branch-1__2026-07-13",
      ownerId: "shop-1",
      storeId: "branch-1",
      weekStartDate: "2026-07-13",
      weekEndDate: "2026-07-19",
      year: 2026,
      weekNumber: 29,
      isPartial: false,
      summary: {
        totalAttendances: 0,
        totalRevenue: 0,
        totalDiscount: 0,
        totalNetRevenue: 0,
        totalOwnerCommission: 0,
        totalEmployeeEarnings: 0,
        averageTicketSize: 0,
        workingDays: 0,
      },
      dailyMetrics: [],
      employeeBreakdowns: [],
      serviceBreakdowns: [],
      generatedAt: now,
      generatedByUserId: "owner-1",
      sourceClosingIds: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });

    seedClosedWorkDaySettlement({
      id: "closing-mixed-range-2026-07-21",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-07-21",
      closedAt: now,
      closedByUserId: "owner-1",
      ownerCommissionRate: 40,
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "equal",
      employeeSummaries: [],
      summary: {
        totalEntries: 1,
        subtotalAmount: 200,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 200,
        totalOwnerCommission: 80,
        totalEmployeeEarning: 120,
      },
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });

    state.attendances.set("attendance-mixed-range-historical", {
      ...baseAttendance,
      id: "attendance-mixed-range-historical",
      workDate: "2026-07-21",
      storeWorkDateKey: "branch-1__2026-07-21",
      services: [],
      totalAmount: 999,
      status: "closed",
      closedAt: now,
      closedBy: "owner-1",
    });
    state.attendances.set("attendance-mixed-range-live", {
      ...baseAttendance,
      id: "attendance-mixed-range-live",
      workDate: "2026-07-22",
      storeWorkDateKey: "branch-1__2026-07-22",
      services: [],
      totalAmount: 10,
      status: "closed",
      closedAt: now,
      closedBy: "owner-1",
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({
          fromWorkDate: "2026-07-13",
          toWorkDate: "2026-07-22",
          debug: "true",
        })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body.summary.totalRevenue).toBe(210);
    expect(response.body.meta.settlementDateRangesUsed).toContainEqual({
      startDate: "2026-07-20",
      endDate: "2026-07-21",
    });
  });

  it("returns cached owner summary report with ETag", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();

    const firstResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth),
    );
    expect(firstResponse.status).toBe(200);

    const etag = firstResponse.headers["etag"] as string;
    expect(etag).toEqual(expect.any(String));

    const cachedResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth)
        .set("If-None-Match", etag),
    );
    expect(cachedResponse.status).toBe(304);
  });

  it("handles error when date range is invalid (end before start)", async () => {
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-10", toWorkDate: "2026-05-05" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(400);
  });

  it("returns only the employee breakdown from the employees facet endpoint", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/employee-performance")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.employeePerformance)).toBe(true);
    // Facet CHỈ trả breakdown thợ — không kèm serviceReport / dailyRevenue / items.
    expect(response.body).not.toHaveProperty("serviceReport");
    expect(response.body).not.toHaveProperty("dailyRevenue");
    expect(response.body).not.toHaveProperty("items");
    expect(response.body.meta).toMatchObject({ startDate: "2026-05-05", storeId: "branch-1" });
  });

  it("uses settlement employee attendance counts instead of counting one day per employee", async () => {
    const now = Date.now();
    const employeeSummary: ShopWorkDayEmployeeSummaryType = {
      employeeUserId: "staff-1",
      employeeName: "Staff One",
      compensationModel: "commission",
      totalRevenue: 150,
      discountAllocated: 0,
      ownerDiscountSupported: 0,
      revenueAfterDiscount: 150,
      ownerCommission: 60,
      employeeEarning: 90,
      workedMinutes: 240,
      isSelectedForDiscount: false,
    };

    const settlement = seedClosedWorkDaySettlement({
      id: "closing-report-employee-count",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-05",
      closedAt: now,
      closedByUserId: "owner-1",
      ownerCommissionRate: 40,
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "equal",
      employeeSummaries: [employeeSummary],
      summary: {
        totalEntries: 3,
        subtotalAmount: 150,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 150,
        totalOwnerCommission: 60,
        totalEmployeeEarning: 90,
      },
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });

    state.workDaySettlements.set("branch-1__2026-05-05", {
      ...settlement,
      employees: [
        {
          employeeUserId: "staff-1",
          employeeName: "Staff One",
          attendanceCount: 3,
          closedCount: 3,
          totalRevenue: 150,
        },
      ],
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/employee-performance")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-05" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body.employeePerformance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ employeeId: "staff-1", attendanceCount: 3 }),
      ]),
    );
  });

  it("returns only the service breakdown from the services facet endpoint", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/service-performance")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.serviceReport)).toBe(true);
    expect(response.body).not.toHaveProperty("employeePerformance");
    expect(response.body).not.toHaveProperty("items");
    expect(response.body.meta).toMatchObject({ startDate: "2026-05-05", storeId: "branch-1" });
  });

  it("forbids a manager from the report facet endpoints", async () => {
    const managerAuth = ownerSessionHeader({ uid: "mgr-1", role: "manager", storeId: "branch-1" });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/service-performance")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", managerAuth),
    );

    expect(response.status).toBe(403);
  });
});

describe("Reports Integration: Staff Report", () => {
  it("counts only cancellations visible to the employee", async () => {
    const attendance = getAttendanceOrThrow("attendance-1");
    const attendanceService = attendance.services[0];

    if (!attendanceService) {
      throw new Error("Expected seeded attendance service");
    }

    const staffOnlyService = {
      ...attendanceService,
      employees: [
        {
          employeeUserId: "staff-1",
          employeeName: "Staff One",
          percentage: 100,
          shareAmount: 0,
        },
      ],
    };
    const otherEmployeeService = {
      ...attendanceService,
      employees: [
        {
          employeeUserId: "staff-lead-1",
          employeeName: "Lead One",
          percentage: 100,
          shareAmount: 0,
        },
      ],
    };

    state.attendances.set("attendance-cancelled-visible", {
      ...attendance,
      id: "attendance-cancelled-visible",
      bookingStatus: "cancelled",
      employeeUserId: "staff-1",
      assignees: staffOnlyService.employees,
      assigneeUserIds: ["staff-1"],
      services: [staffOnlyService],
      subtotalAmount: 0,
      totalAmount: 0,
      createdBy: "staff-1",
    });
    state.attendances.set("attendance-cancelled-hidden", {
      ...attendance,
      id: "attendance-cancelled-hidden",
      bookingStatus: "cancelled",
      employeeUserId: "staff-lead-1",
      assignees: otherEmployeeService.employees,
      assigneeUserIds: ["staff-lead-1"],
      services: [otherEmployeeService],
      subtotalAmount: 0,
      totalAmount: 0,
      createdBy: "staff-lead-1",
    });
    const staffAuth = ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-05" })
        .set("Authorization", staffAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.summary.totalCancelledAppointments).toBe(1);
  });

  it("returns staff-scoped report showing only their own attendances", async () => {
    seedReportData();
    const staffAuth = ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", staffAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.summary.totalAttendance).toBe(2);
  });

  it("returns employee portal report with attendance and service counts", async () => {
    seedReportData();
    const staffAuth = ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/me/report")
        .query({ fromWorkDate: "2026-05-01", toWorkDate: "2026-05-31" })
        .set("Authorization", staffAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.report).toMatchObject({
      attendanceCount: expect.any(Number),
      totalWorkedMinutes: expect.any(Number),
    });
    expect(response.body.employee).toMatchObject({
      id: "staff-1",
      name: expect.any(String),
      compensationModel: expect.stringMatching(/^(commission|fixed|hourly)$/),
    });
    expect(response.body.store).toMatchObject({
      id: "branch-1",
      settlementCutoffTime: expect.any(String),
      timezone: expect.any(String),
    });
    expect(response.body.attendances).toBeUndefined();
    expect(response.body.closings).toBeUndefined();
  });

  it("handles error when staff tries to access another branch report", async () => {
    const staffAuth = ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-2/reports/overview")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-06" })
        .set("Authorization", staffAuth),
    );

    expect(response.status).toBe(403);
  });
});

describe("Reports Integration: Attendance Session Report", () => {
  it("returns attendance session summary for specific work date", async () => {
    seedReportData();
    const staffAuth = ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days")
        .query({ workDate: "2026-05-05" })
        .set("Authorization", staffAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.session.summary.totalEntries).toBeGreaterThanOrEqual(1);
  });

  it("handles error when session query has invalid work date", async () => {
    const staffAuth = ownerSessionHeader({ uid: "staff-1", role: "employee" });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days")
        .query({ workDate: "not-a-date" })
        .set("Authorization", staffAuth),
    );

    expect(response.status).toBe(400);
  });
});

describe("Reports Integration: Attendance List", () => {
  it("returns attendance list filtered by branch and work date", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances")
        .query({ workDate: "2026-05-05", status: "closed" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({
      totalCount: expect.any(Number),
      returnedCount: expect.any(Number),
      storeId: "branch-1",
    });
  });

  it("returns attendance list filtered by open status", async () => {
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances")
        .query({ workDate: "2026-05-05", status: "open" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({
      openCount: expect.any(Number),
    });
  });

  it("returns attendance detail for specific attendance ID", async () => {
    seedReportData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances/attendance-1")
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.item).toMatchObject({
      id: "attendance-1",
    });
  });

  it("handles error when attendance list query missing required parameters", async () => {
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/attendances").set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(400);
  });

  it("handles error when staff tries to access attendance from another branch", async () => {
    const staffAuth = ownerSessionHeader({ uid: "staff-1", role: "employee" });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances/attendance-2")
        .set("Authorization", staffAuth),
    );

    expect(response.status).toBe(403);
  });
});
