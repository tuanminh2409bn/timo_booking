import { describe, expect, it } from "vitest";
import type { ShopWorkDaySettlementFinancialProjectionType } from "../../src/repository/firestore/shop/shop.types.js";
import {
  buildEmployeePortalReportSummary,
  toFrontendDailySettlement,
} from "../../src/business/employee/domain/employee-portal-shared.js";

const hourlySettlement: ShopWorkDaySettlementFinancialProjectionType = {
  id: "2026-07-20",
  ownerId: "shop-1",
  storeId: "branch-1",
  workDate: "2026-07-20",
  updatedAt: 1,
  status: "closed",
  attendance: { totalCount: 1 },
  employees: [{ employeeUserId: "staff-hourly", attendanceCount: 1 }],
  preview: {
    employeeSummaries: [
      {
        employeeUserId: "staff-hourly",
        employeeName: "Hourly",
        totalRevenue: 100,
        discountAllocated: 0,
        ownerDiscountSupported: 10,
        revenueAfterDiscount: 100,
        ownerCommission: 100,
        employeeEarning: 0,
        compensationModel: "hourly",
        hourlyRate: 12,
        workedMinutes: 120,
        isSelectedForDiscount: false,
      },
    ],
    totalEmployeeEarning: 0,
    totalOwnerCommission: 100,
  },
  serviceSummaries: [],
  closing: {
    id: "closing-hourly",
    closedAt: 1,
    closedByUserId: "owner-1",
    ownerDiscountCoverageRate: 50,
    discountAllocationMethod: "revenue_share",
    summary: {
      totalEntries: 1,
      subtotalAmount: 100,
      totalDiscountAmount: 20,
      totalEmployeeDiscountAmount: 0,
      totalOwnerDiscountAmount: 20,
      totalNetAmount: 80,
      totalOwnerCommission: 100,
      totalEmployeeEarning: 0,
    },
  },
};

describe("employee portal salary presentation", () => {
  it("reports hourly salary instead of the commission-only closing earning", () => {
    const report = buildEmployeePortalReportSummary([], [hourlySettlement], "staff-hourly");

    expect(report.settledEarning).toBe(24);
    expect(report.totalWorkedMinutes).toBe(120);
  });

  it("maps hourly salary into the employee settlement item", () => {
    const settlement = toFrontendDailySettlement(hourlySettlement);

    expect(settlement.employeeSummaries[0]?.employeeEarning).toBe(24);
  });
});
