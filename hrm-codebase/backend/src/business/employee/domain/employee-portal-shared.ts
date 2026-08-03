import type { Request } from "express";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import type {
  ShopAttendanceType,
  ShopWorkDayEmployeeSummaryType,
  ShopWorkDaySettlementFinancialProjectionType,
} from "../../../repository/firestore/shop/shop.types.js";
import { normalizeAttendanceForResponse } from "./attendance-presentation.js";
import { subtractMoney, sumMoney } from "../../../helpers/money.js";
import { calculateHourlyEarning } from "../salary/monthly-salary-shared.js";

const MAX_EMPLOYEE_PORTAL_RANGE_DAYS = 92;

const toDateFromWorkDate = (workDate: string) => new Date(`${workDate}T00:00:00.000Z`);

const toWorkDate = (value: Date): string => {
  const year = value.getUTCFullYear();
  const month = `${value.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${value.getUTCDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const addDays = (workDate: string, days: number): string => {
  const date = toDateFromWorkDate(workDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toWorkDate(date);
};

const getRangeDayCount = (fromWorkDate: string, toWorkDateValue: string): number => {
  const fromTime = toDateFromWorkDate(fromWorkDate).getTime();
  const toTime = toDateFromWorkDate(toWorkDateValue).getTime();

  return Math.floor((toTime - fromTime) / 86_400_000) + 1;
};

const normalizeWorkDateInput = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  if (isValidWorkDate(value)) {
    return value;
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }

  return toWorkDate(parsedDate);
};

export const resolveEmployeePortalDateRange = (query: Request["query"]) => {
  const today = toWorkDate(new Date());
  const currentDate = toDateFromWorkDate(today);
  const monthStart = new Date(currentDate);
  monthStart.setUTCDate(1);

  const fromWorkDate =
    normalizeWorkDateInput(query["fromWorkDate"]) ??
    normalizeWorkDateInput(query["from"]) ??
    normalizeWorkDateInput(query["startDate"]) ??
    toWorkDate(monthStart);
  const toWorkDateValue =
    normalizeWorkDateInput(query["toWorkDate"]) ??
    normalizeWorkDateInput(query["to"]) ??
    normalizeWorkDateInput(query["endDate"]) ??
    today;

  if (!isValidWorkDate(fromWorkDate) || !isValidWorkDate(toWorkDateValue)) {
    return undefined;
  }

  const rangeDayCount = getRangeDayCount(fromWorkDate, toWorkDateValue);

  if (rangeDayCount <= 0 || rangeDayCount > MAX_EMPLOYEE_PORTAL_RANGE_DAYS) {
    return undefined;
  }

  return {
    fromWorkDate,
    toWorkDate: toWorkDateValue,
    rangeDayCount,
  };
};

const isEmployeeInService = (
  service: ShopAttendanceType["services"][number],
  employeeUserId: string,
) => (service.employees ?? []).some((employee) => employee.employeeUserId === employeeUserId);

// Normalize trước rồi mới kiểm tra: khi chấm công có service, `assignees` bị dựng lại từ service
// nên thợ chỉ nằm ở `assignees` top-level (chưa gán vào service) sẽ KHÔNG khớp.
// ⚠️ TRÙNG Ý VỚI `isAttendanceAssignedToUser` (attendance-rules.ts) — bản đó đọc thẳng dữ liệu thô
// nên khớp cả trường hợp trên. Chưa gộp vì đổi = đổi phạm vi hiển thị của employee; xem docs/todo.md.
export const isAttendanceAssignedToEmployee = (
  attendance: ShopAttendanceType,
  employeeUserId: string,
) => {
  const normalizedAttendance = normalizeAttendanceForResponse(attendance);

  return (
    normalizedAttendance.createdBy === employeeUserId ||
    normalizedAttendance.assignees.some((assignee) => assignee.employeeUserId === employeeUserId) ||
    normalizedAttendance.services.some((service) => isEmployeeInService(service, employeeUserId))
  );
};

const getEmployeeServiceCount = (attendance: ShopAttendanceType, employeeUserId: string) =>
  normalizeAttendanceForResponse(attendance).services.filter((service) =>
    isEmployeeInService(service, employeeUserId),
  ).length;

const getEmployeeSummaryEarning = (summary: ShopWorkDayEmployeeSummaryType): number =>
  summary.compensationModel === "hourly"
    ? calculateHourlyEarning(summary.hourlyRate, summary.workedMinutes)
    : summary.employeeEarning;

const mapEmployeeSummary = (summary: ShopWorkDayEmployeeSummaryType) => ({
  employeeId: summary.employeeUserId,
  employeeUserId: summary.employeeUserId,
  employeeName: summary.employeeName,
  totalRevenue: summary.totalRevenue,
  discountAllocated: summary.discountAllocated,
  ownerDiscountSupported: summary.ownerDiscountSupported,
  revenueAfterDiscount: summary.revenueAfterDiscount,
  ownerCommission: summary.ownerCommission,
  employeeEarning: getEmployeeSummaryEarning(summary),
  compensationModel: summary.compensationModel,
  ...(summary.ownerCommissionRate !== undefined && {
    ownerCommissionRate: summary.ownerCommissionRate,
  }),
  ...(summary.fixedSalary !== undefined && { fixedSalary: summary.fixedSalary }),
  ...(summary.hourlyRate !== undefined && { hourlyRate: summary.hourlyRate }),
  workedMinutes: summary.workedMinutes,
  isSelectedForDiscount: summary.isSelectedForDiscount,
});

export const toFrontendDailySettlement = (
  settlement: ShopWorkDaySettlementFinancialProjectionType,
) => ({
  id: settlement.closing.id,
  date: `${settlement.workDate}T00:00:00.000Z`,
  workDate: settlement.workDate,
  storeId: settlement.storeId,
  attendances: [],
  totalRevenue: settlement.closing.summary.subtotalAmount,
  totalDiscount: settlement.closing.summary.totalDiscountAmount,
  ownerDiscountCoverageRate: settlement.closing.ownerDiscountCoverageRate,
  discountAllocationMethod: settlement.closing.discountAllocationMethod,
  totalOwnerDiscountAbsorbed: settlement.closing.summary.totalOwnerDiscountAmount ?? 0,
  totalEmployeeDiscountAllocated:
    settlement.closing.summary.totalEmployeeDiscountAmount ?? 0,
  totalOwnerNetAfterDiscount: subtractMoney(
    settlement.closing.summary.totalOwnerCommission,
    settlement.closing.summary.totalOwnerDiscountAmount ?? 0,
  ),
  employeeSummaries: settlement.preview.employeeSummaries.map(mapEmployeeSummary),
  totalEmployeeEarning: settlement.closing.summary.totalEmployeeEarning,
  status: "confirmed",
  confirmedAt: settlement.closing.closedAt,
  confirmedBy: settlement.closing.closedByUserId,
});

export const buildEmployeePortalReportSummary = (
  attendances: ShopAttendanceType[],
  settlements: ShopWorkDaySettlementFinancialProjectionType[],
  employeeUserId: string,
) => {
  const employeeSummaries = settlements
    .flatMap((settlement) => settlement.preview.employeeSummaries)
    .filter((summary) => summary.employeeUserId === employeeUserId);
  const totalWorkedMinutesFromClosings = employeeSummaries.reduce(
    (sum, summary) => sum + summary.workedMinutes,
    0,
  );
  const normalizedAttendances = attendances.map(normalizeAttendanceForResponse);

  return {
    attendanceCount: normalizedAttendances.length,
    serviceCount: normalizedAttendances.reduce(
      (sum, attendance) => sum + getEmployeeServiceCount(attendance, employeeUserId),
      0,
    ),
    settledRevenue: sumMoney(employeeSummaries.map((summary) => summary.totalRevenue)),
    settledDiscount: sumMoney(employeeSummaries.map((summary) => summary.discountAllocated)),
    settledEarning: sumMoney(employeeSummaries.map(getEmployeeSummaryEarning)),
    settledDayCount: employeeSummaries.length,
    totalWorkedMinutes: totalWorkedMinutesFromClosings,
    openAttendanceCount: normalizedAttendances.filter((attendance) => attendance.status === "open")
      .length,
    closedAttendanceCount: normalizedAttendances.filter(
      (attendance) => attendance.status === "closed",
    ).length,
  };
};

export const resolveWorkDateFromTimestamp = (timestamp: number): string => {
  const checkedDate = new Date(timestamp);
  const workDate = toWorkDate(checkedDate);
  const hour = checkedDate.getUTCHours();

  return hour >= 23 ? addDays(workDate, 1) : workDate;
};
