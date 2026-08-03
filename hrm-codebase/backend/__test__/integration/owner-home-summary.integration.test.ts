import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  app,
  getAttendanceOrThrow,
  ownerSessionHeader,
  state,
  withRequestDefaults,
} from "./backend-api-fixture.js";
import type { ShopWorkDaySettlementType } from "../../src/repository/firestore/shop/shop.types.js";

describe("backend API integration: owner home summary", () => {
  it("falls back to an active store when the selected store is stale", async () => {
    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/reports/home-summary")
        .query({
          storeId: "deleted-store-from-local-storage",
          workDate: "2026-05-05",
          monthStart: "2026-05-01",
          monthEnd: "2026-05-31",
        })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body.store.id).toBe("branch-1");
    expect(response.body.meta.storeId).toBe("branch-1");
    expect(response.body).not.toHaveProperty("stores");
    expect(response.body).not.toHaveProperty("branch");
    expect(response.body.today).toMatchObject({
      revenueTotal: expect.any(Number),
      upcomingServiceCount: expect.any(Number),
      totalCount: expect.any(Number),
    });
    expect(response.body.today).not.toHaveProperty("attendances");
  });

  it("counts pending settlement days outside the selected month", async () => {
    const now = Date.now();

    state.attendances.set("attendance-home-closed-previous-month", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "attendance-home-closed-previous-month",
      workDate: "2026-05-29",
      storeWorkDateKey: "branch-1__2026-05-29",
      totalAmount: 120,
      subtotalAmount: 120,
      status: "closed",
      closedAt: now,
      closedBy: "owner-1",
    });
    const pendingSettlement: ShopWorkDaySettlementType = {
      id: "2026-05-29",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-29",
      settlementEligibleAt: now,
      status: "ready",
      attendance: {
        totalCount: 1,
        openCount: 0,
        closedCount: 1,
        incompleteCount: 0,
        employeeTotalCount: 0,
        employeeClosedCount: 0,
      },
      employees: [],
      totalRevenue: 120,
      totalDiscount: 0,
      totalNetAmount: 120,
      totalOwnerNetAfterDiscount: 48,
      attendanceVersion: "home-summary-pending",
      previewOwnerDiscountCoverageRate: 50,
      preview: {
        employeeSummaries: [],
        compensationConfigurationErrors: [],
        totalRevenue: 120,
        totalDiscount: 0,
        totalEmployeeDiscount: 0,
        totalOwnerDiscount: 0,
        totalOwnerDiscountAbsorbed: 0,
        totalEmployeeDiscountAllocated: 0,
        totalUnallocatedDiscount: 0,
        totalNetAmount: 120,
        totalOwnerCommission: 48,
        totalOwnerNetAfterDiscount: 48,
        totalEmployeeEarning: 72,
        allocationSource: "workday",
        discountTargetEmployeeUserIds: [],
        discountEligibleEmployeeUserIds: [],
        submittedEmployeeUserIds: [],
        incompleteAttendanceIds: [],
      },
      pendingEmployees: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    state.workDaySettlements.set("branch-1__2026-05-29", pendingSettlement);

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/reports/home-summary")
        .query({
          storeId: "branch-1",
          workDate: "2026-06-15",
          monthStart: "2026-06-01",
          monthEnd: "2026-06-30",
        })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body.summary.pendingSettlementCount).toBe(1);
  });
});
