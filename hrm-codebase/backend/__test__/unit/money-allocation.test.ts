import { describe, expect, it } from "vitest";
import { allocateMoneyMinorUnits, parseMoneyInput, sumMoney } from "../../src/helpers/money.js";
import { buildWorkDaySettlementPreview } from "../../src/helpers/work-day-settlement.js";
import { buildAttendanceAssignees } from "../../src/business/employee/domain/attendance-money.js";
import { parseAttendancePayload } from "../../src/business/employee/domain/attendance-payload.js";
import { toFrontendAttendanceItem } from "../../src/business/employee/domain/attendance-presentation.js";
import { createShopServiceSchema } from "../../src/business/shop/services/service-shared.js";
import { createShopEmployeeSchema } from "../../src/business/employee/employees/employee-shared.js";
import type {
  ShopAttendanceType,
  ShopEmployeeWorkDayClosingType,
} from "../../src/repository/firestore/shop/shop.types.js";

const sum = (values: number[]) =>
  Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;

const buildSettlementAttendance = (
  employees: Array<{ employeeUserId: string; employeeName: string; shareAmount: number }>,
  discountAmount: number,
): ShopAttendanceType => {
  const totalRevenue = sum(employees.map((employee) => employee.shareAmount));

  return {
    id: "attendance-revenue-share",
    ownerId: "shop-1",
    employeeUserId: employees[0]?.employeeUserId ?? "staff-1",
    storeId: "branch-1",
    storeName: "Branch 1",
    storeWorkDateKey: "branch-1__2026-06-01",
    workDate: "2026-06-01",
    startTime: 600,
    endTime: 660,
    assignees: [],
    services: [
      {
        id: "service-revenue-share",
        ownerId: "shop-1",
        storeId: "branch-1",
        type: "custom",
        name: "Revenue Share Service",
        category: "other",
        price: totalRevenue,
        employees: employees.map((employee) => ({
          ...employee,
          percentage: totalRevenue > 0 ? (employee.shareAmount / totalRevenue) * 100 : 0,
        })),
      },
    ],
    subtotalAmount: totalRevenue,
    discount: {
      allocationMode: "workday",
      type: "amount",
      value: discountAmount,
      splitMode: "all_assignees",
      splitEmployeeUserIds: [],
      ownerCoverageRate: 50,
      amount: discountAmount,
      employeeAmount: discountAmount,
      ownerAmount: 0,
      shares: [],
      ownerShares: [],
    },
    totalAmount: totalRevenue - discountAmount,
    status: "closed",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: "owner-1",
    updatedBy: "owner-1",
  };
};

const buildEmployeeWorkDayClosing = (
  employeeUserId: string,
  attendances: ShopAttendanceType[],
): ShopEmployeeWorkDayClosingType => {
  const attendanceIds = attendances.map((attendance) => attendance.id).sort();
  const timestamp = Date.now();

  return {
    id: `${employeeUserId}__2026-06-01`,
    ownerId: "shop-1",
    storeId: "branch-1",
    workDate: "2026-06-01",
    employeeUserId,
    attendanceIds,
    attendanceVersions: Object.fromEntries(
      attendances.map((attendance) => [attendance.id, attendance.updatedAt]),
    ),
    closedAt: timestamp,
    closedByUserId: employeeUserId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

describe("money allocation", () => {
  it("allocates minor units with deterministic remainder", () => {
    expect(allocateMoneyMinorUnits(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("rejects money inputs that cannot be represented in the configured minor unit", () => {
    expect(parseMoneyInput(1.23456789)).toBeUndefined();
    expect(parseMoneyInput("1.23456789")).toBeUndefined();
    expect(parseMoneyInput("1.2300")).toBe(1.23);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });

  it("rejects API money payloads with more decimals than moneyScale", () => {
    expect(
      createShopServiceSchema.safeParse({
        storeId: "branch-1",
        name: "Invalid Precision",
        amount: "1.23456789",
        groupService: "Nail",
        duration: 30,
      }).success,
    ).toBe(false);

    expect(
      createShopEmployeeSchema.safeParse({
        email: "staff@example.com",
        password: "password",
        name: "Staff Name",
        storeId: "branch-1",
        role: "employee",
        compensationModel: "hourly",
        hourlyRate: 12.345,
      }).success,
    ).toBe(false);

    expect(
      parseAttendancePayload({
        date: "2026-06-01T09:00:00.000Z",
        storeId: "branch-1",
        services: [
          {
            id: "service-1",
            name: "Invalid Precision",
            price: "1.23456789",
            duration: 30,
            employees: [{ employeeId: "employee-1" }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts frontend quick attendance drafts without services", () => {
    const result = parseAttendancePayload({
      date: "2026-06-01T09:00:00",
      endDate: "2026-06-01T09:15:00",
      storeId: "branch-1",
      customerName: "Khách lẻ",
      services: [],
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.services).toEqual([]);
      expect(result.data.assignees).toEqual([]);
      expect(result.data.startTime).toBe(540);
      expect(result.data.endTime).toBe(555);
    }
  });

  it("builds attendance assignee shares without losing one cent", () => {
    const assignees = buildAttendanceAssignees(
      [{ employeeUserId: "a" }, { employeeUserId: "b" }, { employeeUserId: "c" }],
      100,
    );

    expect(assignees.map((assignee) => assignee.shareAmount)).toEqual([33.34, 33.33, 33.33]);
    expect(sum(assignees.map((assignee) => assignee.shareAmount))).toBe(100);
    expect(sum(assignees.map((assignee) => assignee.percentage))).toBe(100);
  });

  it("rejects explicit attendance assignee percentages that do not total 100", () => {
    const basePayload = {
      date: "2026-06-01T09:00:00.000Z",
      endDate: "2026-06-01T10:00:00.000Z",
      storeId: "branch-1",
      employeeUserId: "staff-1",
      services: [
        {
          id: "service-1",
          name: "Split Service",
          price: "100",
          duration: 60,
          employees: [
            { employeeId: "staff-1", percentage: 40 },
            { employeeId: "staff-2", percentage: 50 },
          ],
        },
      ],
    };

    expect(parseAttendancePayload(basePayload).success).toBe(false);
    expect(
      parseAttendancePayload({
        ...basePayload,
        services: [
          {
            ...basePayload.services[0],
            employees: [
              { employeeId: "staff-1", percentage: 40 },
              { employeeId: "staff-2", percentage: 60 },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("normalizes near-100 percentage splits and preserves settlement totals", () => {
    const attendance: ShopAttendanceType = {
      id: "attendance-1",
      ownerId: "shop-1",
      employeeUserId: "a",
      storeId: "branch-1",
      storeName: "Branch 1",
      storeWorkDateKey: "branch-1__2026-06-01",
      workDate: "2026-06-01",
      startTime: 600,
      endTime: 660,
      assignees: [],
      services: [
        {
          id: "service-1",
          ownerId: "shop-1",
          storeId: "branch-1",
          type: "custom",
          name: "Split Service",
          category: "other",
          price: 100,
          employees: [
            { employeeUserId: "a", percentage: 33.33 },
            { employeeUserId: "b", percentage: 33.33 },
            { employeeUserId: "c", percentage: 33.33 },
          ],
        },
      ],
      subtotalAmount: 100,
      totalAmount: 100,
      status: "closed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "owner-1",
      updatedBy: "owner-1",
    };

    const preview = buildWorkDaySettlementPreview([attendance], {
      ownerCommissionRate: 0,
      ownerDiscountCoverageRate: 0,
      discountAllocationMethod: "equal",
      discountEmployeeScope: "all",
      employeeWorkDayClosings: [],
    });

    expect(preview.totalRevenue).toBe(100);
    expect(sum(preview.employeeSummaries.map((summary) => summary.totalRevenue))).toBe(100);
    expect(preview.employeeSummaries.map((summary) => summary.totalRevenue).sort()).toEqual([
      33.33, 33.33, 33.34,
    ]);
  });

  it("allocates revenue-share discount across commission employees by day revenue", () => {
    const attendance = buildSettlementAttendance(
      [
        { employeeUserId: "staff-a", employeeName: "A", shareAmount: 500 },
        { employeeUserId: "staff-b", employeeName: "B", shareAmount: 300 },
        { employeeUserId: "staff-c", employeeName: "C", shareAmount: 100 },
        { employeeUserId: "staff-d", employeeName: "D", shareAmount: 50 },
        { employeeUserId: "staff-e", employeeName: "E", shareAmount: 50 },
      ],
      200,
    );

    const preview = buildWorkDaySettlementPreview([attendance], {
      ownerCommissionRate: 0,
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeWorkDayClosings: [],
    });

    expect(preview.totalOwnerDiscount).toBe(100);
    expect(preview.totalEmployeeDiscount).toBe(100);
    expect(preview.employeeSummaries.map((summary) => summary.discountAllocated)).toEqual([
      50, 30, 10, 5, 5,
    ]);
    // Ăn chia trên R gốc rồi mới trừ D: ownerComm = 1000×50% = 500; employeeEarning = 500 − 100(D) = 400;
    // ownerNet = 500 − 100(D chủ gánh) = 400. Net 800 = 400 + 400.
    expect(preview.totalOwnerCommission).toBe(500);
    expect(preview.totalOwnerNetAfterDiscount).toBe(400);
    expect(preview.totalEmployeeEarning).toBe(400);
  });

  // Ví dụ chuẩn ở docs/salary-discount-rules.md mục 3: ăn chia TRÊN doanh thu gốc (R × (1−rate)) rồi
  // MỚI trừ phần giảm giá thợ gánh (D). N1..N3 thợ chính (rate chủ 50/50/60), N4/N5 thợ cứng.
  it("splits commission on gross revenue then subtracts discount (salary-discount-rules example 3)", () => {
    const attendance = buildSettlementAttendance(
      [
        { employeeUserId: "n1", employeeName: "N1", shareAmount: 200 },
        { employeeUserId: "n2", employeeName: "N2", shareAmount: 300 },
        { employeeUserId: "n3", employeeName: "N3", shareAmount: 300 },
        { employeeUserId: "n4", employeeName: "N4", shareAmount: 100 },
        { employeeUserId: "n5", employeeName: "N5", shareAmount: 100 },
      ],
      50,
    );

    const preview = buildWorkDaySettlementPreview([attendance], {
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeConfigs: [
        { uid: "n1", compensationModel: "commission", ownerCommissionRate: 50 },
        { uid: "n2", compensationModel: "commission", ownerCommissionRate: 50 },
        { uid: "n3", compensationModel: "commission", ownerCommissionRate: 60 },
        { uid: "n4", compensationModel: "hourly", hourlyRate: 20 },
        { uid: "n5", compensationModel: "hourly", hourlyRate: 20 },
      ],
    });

    const earningByUid = Object.fromEntries(
      preview.employeeSummaries.map((summary) => [summary.employeeUserId, summary.employeeEarning]),
    );
    // N1: 200×0.5 − 5 = 95;  N2: 300×0.5 − 7.5 = 142.5;  N3: 300×0.4 − 7.5 = 112.5;  N4/N5 lương cứng = 0.
    expect(earningByUid["n1"]).toBe(95);
    expect(earningByUid["n2"]).toBe(142.5);
    expect(earningByUid["n3"]).toBe(112.5);
    expect(earningByUid["n4"]).toBe(0);
    expect(earningByUid["n5"]).toBe(0);
    expect(preview.totalEmployeeEarning).toBe(350);
  });

  it("counts only confirmed attendances in settlement revenue", () => {
    const active = buildSettlementAttendance(
      [{ employeeUserId: "staff-a", employeeName: "A", shareAmount: 100 }],
      0,
    );
    const cancelled = {
      ...buildSettlementAttendance(
        [{ employeeUserId: "staff-b", employeeName: "B", shareAmount: 500 }],
        0,
      ),
      id: "attendance-cancelled",
      bookingStatus: "cancelled" as const,
    };
    const noShow = {
      ...buildSettlementAttendance(
        [{ employeeUserId: "staff-c", employeeName: "C", shareAmount: 300 }],
        0,
      ),
      id: "attendance-no-show",
      bookingStatus: "no_show" as const,
    };
    const processing = {
      ...buildSettlementAttendance(
        [{ employeeUserId: "staff-d", employeeName: "D", shareAmount: 700 }],
        0,
      ),
      id: "attendance-processing",
      bookingStatus: "processing" as const,
    };
    const requested = {
      ...buildSettlementAttendance(
        [{ employeeUserId: "staff-e", employeeName: "E", shareAmount: 900 }],
        0,
      ),
      id: "attendance-requested",
      bookingStatus: "requested" as const,
    };

    const preview = buildWorkDaySettlementPreview(
      [active, cancelled, noShow, processing, requested],
      {
        ownerDiscountCoverageRate: 0,
        employeeWorkDayClosings: [],
      },
    );

    expect(preview.totalRevenue).toBe(100);
    expect(preview.employeeSummaries.map((summary) => summary.employeeUserId)).toEqual(["staff-a"]);
  });

  it("moves fixed employee revenue-share discount to owner support", () => {
    const attendance = buildSettlementAttendance(
      [
        { employeeUserId: "staff-a", employeeName: "A", shareAmount: 500 },
        { employeeUserId: "staff-b", employeeName: "B", shareAmount: 300 },
        { employeeUserId: "staff-c", employeeName: "C", shareAmount: 100 },
        { employeeUserId: "staff-d", employeeName: "D", shareAmount: 50 },
        { employeeUserId: "staff-e", employeeName: "E", shareAmount: 50 },
      ],
      200,
    );

    const preview = buildWorkDaySettlementPreview([attendance], {
      ownerCommissionRate: 0,
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeConfigs: [
        { uid: "staff-a", compensationModel: "hourly", hourlyRate: 20 },
        { uid: "staff-b", compensationModel: "hourly", hourlyRate: 20 },
        { uid: "staff-c", compensationModel: "hourly", hourlyRate: 20 },
      ],
      employeeWorkDayClosings: [],
    });

    expect(preview.totalOwnerDiscount).toBe(190);
    expect(preview.totalEmployeeDiscount).toBe(10);
    expect(sum(preview.employeeSummaries.map((summary) => summary.ownerDiscountSupported))).toBe(
      90,
    );
    expect(preview.employeeSummaries.map((summary) => summary.discountAllocated)).toEqual([
      0, 0, 0, 5, 5,
    ]);
    // ownerComm = 900 (3 thợ cứng: full revenue về chủ) + 50 (D,E: R×50%) = 950.
    // employeeEarning = D,E: (50−25−5)+(50−25−5) = 40. ownerNet = 950 − 190(D chủ gánh) = 760. Net 800 = 40 + 760.
    expect(preview.totalOwnerCommission).toBe(950);
    expect(preview.totalOwnerNetAfterDiscount).toBe(760);
    expect(preview.totalEmployeeEarning).toBe(40);
  });

  it("lets owner absorb all revenue-share discount for all-fixed settlement", () => {
    const attendance = buildSettlementAttendance(
      [
        { employeeUserId: "staff-a", employeeName: "A", shareAmount: 500 },
        { employeeUserId: "staff-b", employeeName: "B", shareAmount: 500 },
      ],
      200,
    );

    const preview = buildWorkDaySettlementPreview([attendance], {
      ownerCommissionRate: 0,
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeConfigs: [
        { uid: "staff-a", compensationModel: "hourly", hourlyRate: 20 },
        { uid: "staff-b", compensationModel: "hourly", hourlyRate: 20 },
      ],
      employeeWorkDayClosings: [],
    });

    expect(preview.totalOwnerDiscount).toBe(200);
    expect(preview.totalEmployeeDiscount).toBe(0);
    expect(preview.totalOwnerCommission).toBe(1000);
    expect(preview.totalOwnerNetAfterDiscount).toBe(800);
    expect(preview.totalEmployeeEarning).toBe(0);
    expect(preview.discountAllocationError).toBeUndefined();
  });

  it("does not double-count overlapping work intervals for hourly employees", () => {
    const firstAttendance = buildSettlementAttendance(
      [{ employeeUserId: "staff-hourly", employeeName: "Hourly", shareAmount: 100 }],
      0,
    );
    const secondAttendance = {
      ...buildSettlementAttendance(
        [{ employeeUserId: "staff-hourly", employeeName: "Hourly", shareAmount: 100 }],
        0,
      ),
      id: "attendance-overlap",
      startTime: 570,
      endTime: 630,
    };

    const preview = buildWorkDaySettlementPreview([firstAttendance, secondAttendance], {
      ownerDiscountCoverageRate: 50,
      employeeConfigs: [{ uid: "staff-hourly", compensationModel: "hourly", hourlyRate: 20 }],
      employeeWorkDayClosings: [],
    });

    expect(preview.employeeSummaries[0]?.workedMinutes).toBe(90);
    expect(preview.employeeSummaries[0]?.employeeEarning).toBe(0);
  });

  it.skip("uses the employee work-day closing record regardless of attendance status", () => {
    const closedAttendance = buildSettlementAttendance(
      [{ employeeUserId: "staff-1", employeeName: "Staff", shareAmount: 100 }],
      0,
    );
    const openAttendance: ShopAttendanceType = {
      ...closedAttendance,
      id: "attendance-open",
      status: "open",
    };

    const attendances = [closedAttendance, openAttendance];
    const employeeWorkDayClosing = buildEmployeeWorkDayClosing("staff-1", attendances);
    const pendingPreview = buildWorkDaySettlementPreview(attendances, {
      ownerDiscountCoverageRate: 50,
      employeeWorkDayClosings: [],
    });
    const closedPreview = buildWorkDaySettlementPreview(attendances, {
      ownerDiscountCoverageRate: 50,
      employeeWorkDayClosings: [employeeWorkDayClosing],
    });

    expect(pendingPreview.submittedEmployeeUserIds).toEqual([]);
    expect(closedPreview.submittedEmployeeUserIds).toEqual(["staff-1"]);
    expect(getPendingResponsibleEmployeeUserIds(attendances, [])).toEqual(["staff-1"]);
    expect(getPendingResponsibleEmployeeUserIds(attendances, [employeeWorkDayClosing])).toEqual([]);
  });

  it("recomputes service employee shares from percentages when stored shareAmount is stale", () => {
    const attendance: ShopAttendanceType = {
      id: "attendance-stale-share",
      ownerId: "shop-1",
      employeeUserId: "staff-a",
      storeId: "branch-1",
      storeName: "Branch 1",
      storeWorkDateKey: "branch-1__2026-06-06",
      workDate: "2026-06-06",
      startTime: 750,
      endTime: 810,
      assignees: [],
      services: [
        {
          id: "service-1",
          ownerId: "shop-1",
          storeId: "branch-1",
          type: "predefined",
          name: "Split Service",
          category: "nail",
          price: 18,
          employees: [
            { employeeUserId: "staff-a", employeeName: "A", percentage: 50, shareAmount: 18 },
            { employeeUserId: "staff-b", employeeName: "B", percentage: 50, shareAmount: 18 },
          ],
        },
      ],
      subtotalAmount: 18,
      totalAmount: 18,
      status: "closed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "owner-1",
      updatedBy: "owner-1",
    };

    const preview = buildWorkDaySettlementPreview([attendance], {
      ownerDiscountCoverageRate: 0,
      employeeWorkDayClosings: [],
    });
    const item = toFrontendAttendanceItem(attendance);

    expect(preview.totalRevenue).toBe(18);
    expect(preview.employeeSummaries.map((summary) => summary.totalRevenue)).toEqual([9, 9]);
    expect(item.services[0]?.sourceServiceId).toBe("service-1");
    expect(item.services[0]?.employees.map((employee) => employee.shareAmount)).toEqual([9, 9]);
  });
});
