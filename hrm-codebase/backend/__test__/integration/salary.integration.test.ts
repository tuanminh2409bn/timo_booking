import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  ShopClosedWorkDaySettlementType,
  ShopWorkDaySettlementType,
} from "../../src/repository/firestore/shop/shop.types.js";
import type { UserType } from "../../src/repository/firestore/user/user.types.js";
import {
  app,
  ownerSessionHeader,
  state,
  withRequestDefaults,
} from "./backend-api-fixture.js";

const createClosing = (
  patch: Partial<ShopClosedWorkDaySettlementType> & Pick<ShopClosedWorkDaySettlementType, "id" | "storeId" | "workDate">,
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
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...patch,
});

const seedMonthlySalaryState = () => {
  const hourlyEmployee: UserType = {
    uid: "staff-hourly-1",
    email: "hourly@example.com",
    ownerId: "shop-1",
    role: "employee" as UserType["role"],
    active: true,
    storeId: "branch-1",
    name: "Hourly One",
    position: "Receptionist",
    employeeStatus: "active",
    compensationModel: "hourly",
    hourlyRate: 12,
  };

  state.users.set(hourlyEmployee.uid, hourlyEmployee);
  state.closings.set(
    "closing-may-1",
    createClosing({
      id: "closing-may-1",
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
          totalRevenue: 30,
          discountAllocated: 2,
          ownerDiscountSupported: 0,
          revenueAfterDiscount: 28,
          ownerCommission: 12,
          employeeEarning: 16,
          workedMinutes: 60,
          isSelectedForDiscount: false,
        },
        {
          employeeUserId: "staff-hourly-1",
          employeeName: "Hourly One",
          compensationModel: "hourly",
          hourlyRate: 12,
          payType: "fixed",
          ownerCommissionRate: 100,
          totalRevenue: 40,
          discountAllocated: 0,
          ownerDiscountSupported: 0,
          revenueAfterDiscount: 40,
          ownerCommission: 40,
          employeeEarning: 0,
          workedMinutes: 120,
          isSelectedForDiscount: false,
          isFixedSalary: true,
        },
      ],
      summary: {
        totalEntries: 2,
        subtotalAmount: 70,
        totalDiscountAmount: 2,
        totalEmployeeDiscountAmount: 2,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 68,
        totalOwnerCommission: 52,
        totalEmployeeEarning: 16,
      },
    }),
  );
  state.closings.set(
    "closing-may-2",
    createClosing({
      id: "closing-may-2",
      storeId: "branch-1",
      workDate: "2026-05-02",
      employeeSummaries: [
        {
          employeeUserId: "staff-1",
          employeeName: "Staff One",
          compensationModel: "commission",
          commissionRate: 60,
          payType: "commission",
          ownerCommissionRate: 40,
          totalRevenue: 20,
          discountAllocated: 0,
          ownerDiscountSupported: 0,
          revenueAfterDiscount: 20,
          ownerCommission: 8,
          employeeEarning: 12,
          workedMinutes: 45,
          isSelectedForDiscount: false,
        },
      ],
    }),
  );
  state.closings.set(
    "closing-apr-1",
    createClosing({
      id: "closing-apr-1",
      storeId: "branch-1",
      workDate: "2026-04-30",
      employeeSummaries: [
        {
          employeeUserId: "staff-1",
          employeeName: "Staff One",
          compensationModel: "commission",
          commissionRate: 60,
          payType: "commission",
          ownerCommissionRate: 40,
          totalRevenue: 25,
          discountAllocated: 0,
          ownerDiscountSupported: 0,
          revenueAfterDiscount: 25,
          ownerCommission: 10,
          employeeEarning: 15,
          workedMinutes: 60,
          isSelectedForDiscount: false,
        },
      ],
    }),
  );
  state.closings.set(
    "closing-branch-2",
    createClosing({
      id: "closing-branch-2",
      storeId: "branch-2",
      workDate: "2026-05-01",
      employeeSummaries: [
        {
          employeeUserId: "staff-2",
          employeeName: "Staff Two",
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
          workedMinutes: 60,
          isSelectedForDiscount: false,
        },
      ],
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
      attendanceVersion: `salary-${closing.id}`,
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

describe("backend API integration: monthly salary", () => {
  it("returns fixed salary once per month and prorates it in weekly views", async () => {
    seedMonthlySalaryState();
    state.users.set("staff-fixed-1", {
      uid: "staff-fixed-1",
      email: "fixed@example.com",
      ownerId: "shop-1",
      role: "employee",
      active: true,
      storeId: "branch-1",
      name: "Fixed One",
      compensationModel: "fixed",
      fixedSalary: 3100,
    });

    const monthlyResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/salaries/monthly")
        .query({ year: "2026", month: "5" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(monthlyResponse.status).toBe(200);
    expect(monthlyResponse.body.summary).toMatchObject({
      totalFixedEarning: 3100,
      totalSalary: 3152,
    });
    expect(monthlyResponse.body.employees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeUserId: "staff-fixed-1",
          compensationModel: "fixed",
          fixedSalary: 3100,
          fixedEarning: 3100,
          totalSalary: 3100,
          workedMinutes: 0,
        }),
      ]),
    );

    const weeklyResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/salaries/weekly")
        .query({ weekStart: "2026-04-27" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(weeklyResponse.status).toBe(200);
    expect(weeklyResponse.body.employees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeUserId: "staff-fixed-1",
          compensationModel: "fixed",
          fixedEarning: 713.33,
          totalSalary: 713.33,
        }),
      ]),
    );
  });

  it("returns owner monthly salary from closed work days with cacheable reads", async () => {
    seedMonthlySalaryState();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/salaries/monthly")
        .query({ year: "2026", month: "5" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body.period).toMatchObject({
      mode: "month",
      year: 2026,
      month: 5,
      fromWorkDate: "2026-05-01",
      toWorkDate: "2026-05-31",
    });
    expect(response.body.store).toMatchObject({
      id: "branch-1",
      name: "District 1",
    });
    expect(response.body.summary).toMatchObject({
      totalSalary: 52,
      totalCommissionEarning: 28,
      totalHourlyEarning: 24,
      previousTotalSalary: 15,
      salaryGrowthPercent: 246.67,
      closedDayCount: 2,
      paidEmployeeCount: 0,
    });
    expect(response.body.employees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeUserId: "staff-1",
          name: "Staff One",
          commissionEarning: 28,
          hourlyEarning: 0,
          totalSalary: 28,
          closedDayCount: 2,
          lastClosedWorkDate: "2026-05-02",
        }),
        expect.objectContaining({
          employeeUserId: "staff-hourly-1",
          name: "Hourly One",
          compensationModel: "hourly",
          hourlyRate: 12,
          commissionEarning: 0,
          hourlyEarning: 24,
          totalSalary: 24,
        }),
        expect.objectContaining({
          employeeUserId: "staff-lead-1",
          totalSalary: 0,
        }),
      ]),
    );

    const etag = response.headers["etag"] as string;
    expect(etag).toEqual(expect.any(String));

    const cachedResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/salaries/monthly")
        .query({ year: "2026", month: "5" })
        .set("Authorization", ownerSessionHeader())
        .set("If-None-Match", etag),
    );
    expect(cachedResponse.status).toBe(304);
  });

  it("guards monthly salary by role, validation, and branch scope", async () => {
    seedMonthlySalaryState();

    const staffResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/salaries/monthly")
        .query({ year: "2026", month: "5" })
        .set(
          "Authorization",
          ownerSessionHeader({ uid: "staff-1", role: "employee" as UserType["role"], storeId: "branch-1" }),
        ),
    );
    expect(staffResponse.status).toBe(403);

    const invalidResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/salaries/monthly")
        .query({ year: "2026", month: "13" })
        .set("Authorization", ownerSessionHeader()),
    );
    expect(invalidResponse.status).toBe(400);

    const branchTwoResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-2/salaries/monthly")
        .query({ year: "2026", month: "5" })
        .set("Authorization", ownerSessionHeader()),
    );
    expect(branchTwoResponse.status).toBe(200);
    expect(branchTwoResponse.body.summary.totalSalary).toBe(60);
    expect(branchTwoResponse.body.employees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeUserId: "staff-2",
          totalSalary: 60,
        }),
      ]),
    );
    expect(
      branchTwoResponse.body.employees.some(
        (employee: { employeeUserId: string }) => employee.employeeUserId === "staff-1",
      ),
    ).toBe(false);
  });

  it("returns owner weekly salary for a Monday-aligned week", async () => {
    seedMonthlySalaryState();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/salaries/weekly")
        .query({ weekStart: "2026-04-27" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body.period).toEqual({
      mode: "week",
      fromWorkDate: "2026-04-27",
      toWorkDate: "2026-05-03",
    });
    expect(response.body.summary).toMatchObject({
      totalSalary: 67,
      previousTotalSalary: 0,
      closedDayCount: 3,
      paidEmployeeCount: 0,
    });
    expect(response.body.employees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeUserId: "staff-1",
          totalSalary: 43,
          closedDayCount: 3,
        }),
        expect.objectContaining({
          employeeUserId: "staff-hourly-1",
          totalSalary: 24,
        }),
      ]),
    );

    const weeklyEtag = response.headers["etag"] as string;
    expect(weeklyEtag).toEqual(expect.any(String));

    const cachedResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/salaries/weekly")
        .query({ weekStart: "2026-04-27" })
        .set("Authorization", ownerSessionHeader())
        .set("If-None-Match", weeklyEtag),
    );
    expect(cachedResponse.status).toBe(304);

    const invalidResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/salaries/weekly")
        .query({ weekStart: "2026-04-28" })
        .set("Authorization", ownerSessionHeader()),
    );
    expect(invalidResponse.status).toBe(400);
  });
});
