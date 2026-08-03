// Logic tổng hợp báo cáo owner — hàm THUẦN (không req/res). Tách khỏi endpoint để 3 endpoint
// report (summary / employees / services) cùng dùng chung một tầng tổng hợp.
import {
  addMoney,
  DEFAULT_MONEY_SCALE,
  resolveMoneyAmount,
  roundMoney,
  sumMoney,
} from "../../../helpers/money.js";
import { isRevenueBearingAttendance } from "../../../helpers/work-day-settlement.js";
import type { ShopWorkDaySettlementFinancialProjectionType } from "../../../repository/firestore/shop/shop.types.js";
import type { WeeklyReportType } from "../../../repository/firestore/shop/weekly-report.types.js";
import type { normalizeAttendanceForResponse } from "../domain/attendance-presentation.js";
import {
  getEmployeeBreakdownsForRange,
  getServiceBreakdownsForRange,
  getWeeklyMoney,
} from "../domain/weekly-report-reader.js";

// Khoảng ngày tối đa cho báo cáo dạng RAW (không tổng hợp weekly). Vượt → chỉ cho chế độ chỉ-thống-kê
// (summaryOnly).
export const MAX_RAW_REPORT_RANGE_DAYS = 31;

// complete: đủ breakdown dịch vụ. partial: thiếu nhưng range quá dài không fallback được.
// legacy_fallback: đã fallback quét attendance thô để bù breakdown.
export type ServiceBreakdownStatus = "complete" | "partial" | "legacy_fallback";

const toWorkDateTime = (workDate: string) => new Date(`${workDate}T00:00:00.000Z`).getTime();

export const getInclusiveRangeDays = (startDate: string, endDate: string) =>
  Math.floor((toWorkDateTime(endDate) - toWorkDateTime(startDate)) / 86_400_000) + 1;

export const roundCurrency = roundMoney;

const getReportDateKey = (workDate: string, groupBy: "day" | "month") =>
  groupBy === "month" ? `${workDate.slice(0, 7)}-01` : workDate;

const getAttendanceRevenueTotal = (
  attendance: ReturnType<typeof normalizeAttendanceForResponse>,
) => {
  const servicesTotal = sumMoney(attendance.services.map((service) => service.price));

  return servicesTotal > 0 ? servicesTotal : roundCurrency(attendance.totalAmount);
};

const hasAttendanceInRange = (report: WeeklyReportType, startDate: string, endDate: string) =>
  report.dailyMetrics.some(
    (metric) =>
      metric.workDate >= startDate && metric.workDate <= endDate && metric.attendanceCount > 0,
  );

export const isWeeklyServiceBreakdownMissing = (
  report: WeeklyReportType,
  startDate: string,
  endDate: string,
) =>
  hasAttendanceInRange(report, startDate, endDate) &&
  getServiceBreakdownsForRange(report, startDate, endDate).length === 0;

type DailyRevenueEntry = { date: string; revenue: number; attendanceCount: number };
type EmployeeEntry = {
  employeeId: string;
  employeeName: string;
  totalRevenue: number;
  attendanceCount: number;
};
type ServiceEntry = { serviceId: string; serviceName: string; count: number; revenue: number };

// Bước KẾT của mọi builder (giống hệt 4 nơi): map cộng dồn → mảng sắp xếp + summary.
// `totalRevenue`/`totalAttendance` thiếu → tự suy từ dailyRevenue đã làm tròn (nhánh merge dùng thế).
const finalizeReportAggregate = (input: {
  revenueEntries: DailyRevenueEntry[];
  employeeEntries: EmployeeEntry[];
  serviceEntries: ServiceEntry[];
  fallbackDailyRevenueDate: string;
  totalRevenue?: number;
  totalAttendance?: number;
}) => {
  const dailyRevenue = input.revenueEntries
    .map((entry) => ({ ...entry, revenue: roundCurrency(entry.revenue) }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const employeePerformance = input.employeeEntries
    .map((employee) => ({
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      totalRevenue: roundCurrency(employee.totalRevenue),
      attendanceCount: employee.attendanceCount,
    }))
    .sort((left, right) => right.totalRevenue - left.totalRevenue);
  const serviceReport = input.serviceEntries
    .map((service) => ({ ...service, revenue: roundCurrency(service.revenue) }))
    .sort((left, right) => right.revenue - left.revenue);

  const totalRevenue = input.totalRevenue ?? sumMoney(dailyRevenue.map((day) => day.revenue));
  const totalAttendance =
    input.totalAttendance ?? dailyRevenue.reduce((sum, day) => sum + day.attendanceCount, 0);
  return {
    dailyRevenue:
      dailyRevenue.length > 0
        ? dailyRevenue
        : [{ date: input.fallbackDailyRevenueDate, revenue: 0, attendanceCount: 0 }],
    employeePerformance,
    serviceReport,
    summary: {
      totalRevenue: roundCurrency(totalRevenue),
      totalAttendance,
    },
  };
};

/**
 * Builds report aggregates from weekly reports (optimized path)
 * Aggregates pre-computed weekly data instead of processing individual attendances
 */
export const buildReportAggregatesFromWeeklyReports = (
  weeklyReports: WeeklyReportType[],
  groupBy: "day" | "month",
  fallbackStartDate: string,
  startDate: string,
  endDate: string,
) => {
  const revenueMap = new Map<string, { date: string; revenue: number; attendanceCount: number }>();
  const employeeMap = new Map<
    string,
    {
      employeeId: string;
      employeeName: string;
      totalRevenue: number;
      attendanceCount: number;
    }
  >();
  const serviceMap = new Map<
    string,
    { serviceId: string; serviceName: string; count: number; revenue: number }
  >();
  let totalRevenue = 0;

  // Aggregate from weekly reports
  for (const report of weeklyReports) {
    if (!report) continue;

    // Aggregate daily revenue
    for (const dailyMetric of report.dailyMetrics) {
      if (dailyMetric.workDate < startDate || dailyMetric.workDate > endDate) {
        continue;
      }

      const dateKey = getReportDateKey(dailyMetric.workDate, groupBy);
      const revenue = getWeeklyMoney(report, dailyMetric.revenue, dailyMetric.revenueMinor);
      const existing = revenueMap.get(dateKey) ?? {
        date: dateKey,
        revenue: 0,
        attendanceCount: 0,
      };

      existing.revenue = addMoney(existing.revenue, revenue);
      existing.attendanceCount += dailyMetric.attendanceCount;
      revenueMap.set(dateKey, existing);
      totalRevenue = addMoney(totalRevenue, revenue);
    }

    // Aggregate employee performance
    for (const employeeBreakdown of getEmployeeBreakdownsForRange(report, startDate, endDate)) {
      const employeeRevenue = getWeeklyMoney(
        report,
        employeeBreakdown.totalRevenue,
        employeeBreakdown.totalRevenueMinor,
      );
      const existing = employeeMap.get(employeeBreakdown.employeeUserId) ?? {
        employeeId: employeeBreakdown.employeeUserId,
        employeeName: employeeBreakdown.employeeName,
        totalRevenue: 0,
        attendanceCount: 0,
      };

      existing.totalRevenue = addMoney(existing.totalRevenue, employeeRevenue);
      existing.attendanceCount += employeeBreakdown.totalAttendances;
      employeeMap.set(employeeBreakdown.employeeUserId, existing);
    }

    // Aggregate service breakdown
    for (const serviceBreakdown of getServiceBreakdownsForRange(report, startDate, endDate)) {
      const serviceRevenue = getWeeklyMoney(
        report,
        serviceBreakdown.totalRevenue,
        serviceBreakdown.totalRevenueMinor,
      );
      const existing = serviceMap.get(serviceBreakdown.serviceId) ?? {
        serviceId: serviceBreakdown.serviceId,
        serviceName: serviceBreakdown.serviceName,
        count: 0,
        revenue: 0,
      };

      existing.count += serviceBreakdown.count;
      existing.revenue = addMoney(existing.revenue, serviceRevenue);
      serviceMap.set(serviceBreakdown.serviceId, existing);
    }
  }

  return finalizeReportAggregate({
    revenueEntries: Array.from(revenueMap.values()),
    employeeEntries: Array.from(employeeMap.values()),
    serviceEntries: Array.from(serviceMap.values()),
    totalRevenue,
    fallbackDailyRevenueDate: getReportDateKey(fallbackStartDate, groupBy),
  });
};

export const buildReportAggregatesFromSettlements = (
  settlements: ShopWorkDaySettlementFinancialProjectionType[],
  groupBy: "day" | "month",
  fallbackStartDate: string,
) => {
  const revenueMap = new Map<string, { date: string; revenue: number; attendanceCount: number }>();
  const employeeMap = new Map<
    string,
    {
      employeeId: string;
      employeeName: string;
      totalRevenue: number;
      attendanceCount: number;
    }
  >();
  const serviceMap = new Map<
    string,
    { serviceId: string; serviceName: string; count: number; revenue: number }
  >();
  let totalRevenue = 0;

  for (const settlement of settlements) {
    const settlementAttendanceCountByEmployeeUserId = new Map(
      settlement.employees.map((employee) => [employee.employeeUserId, employee.attendanceCount]),
    );
    const dateKey = getReportDateKey(settlement.workDate, groupBy);
    const revenue = roundCurrency(settlement.closing.summary.subtotalAmount);
    const existingRevenue = revenueMap.get(dateKey) ?? {
      date: dateKey,
      revenue: 0,
      attendanceCount: 0,
    };

    existingRevenue.revenue = addMoney(existingRevenue.revenue, revenue);
    existingRevenue.attendanceCount += settlement.closing.summary.totalEntries;
    revenueMap.set(dateKey, existingRevenue);
    totalRevenue = addMoney(totalRevenue, revenue);

    for (const employeeSummary of settlement.preview.employeeSummaries) {
      const existingEmployee = employeeMap.get(employeeSummary.employeeUserId) ?? {
        employeeId: employeeSummary.employeeUserId,
        employeeName: employeeSummary.employeeName,
        totalRevenue: 0,
        attendanceCount: 0,
      };

      existingEmployee.totalRevenue = addMoney(
        existingEmployee.totalRevenue,
        employeeSummary.totalRevenue,
      );
      existingEmployee.attendanceCount +=
        settlementAttendanceCountByEmployeeUserId.get(employeeSummary.employeeUserId) ?? 0;
      employeeMap.set(employeeSummary.employeeUserId, existingEmployee);
    }

    for (const serviceSummary of settlement.serviceSummaries) {
      const serviceRevenue = resolveMoneyAmount(
        serviceSummary.totalRevenue,
        serviceSummary.totalRevenueMinor,
        DEFAULT_MONEY_SCALE,
      );
      const existingService = serviceMap.get(serviceSummary.serviceId) ?? {
        serviceId: serviceSummary.serviceId,
        serviceName: serviceSummary.serviceName,
        count: 0,
        revenue: 0,
      };

      existingService.count += serviceSummary.count;
      existingService.revenue = addMoney(existingService.revenue, serviceRevenue);
      serviceMap.set(serviceSummary.serviceId, existingService);
    }
  }

  return finalizeReportAggregate({
    revenueEntries: Array.from(revenueMap.values()),
    employeeEntries: Array.from(employeeMap.values()),
    serviceEntries: Array.from(serviceMap.values()),
    totalRevenue,
    fallbackDailyRevenueDate: getReportDateKey(fallbackStartDate, groupBy),
  });
};

/**
 * Builds report aggregates from raw attendances (fallback for current week)
 * This is the original implementation used for real-time data
 */
export const buildReportAggregatesFromAttendances = (
  attendances: ReturnType<typeof normalizeAttendanceForResponse>[],
  groupBy: "day" | "month",
  fallbackStartDate: string,
) => {
  const revenueMap = new Map<string, { date: string; revenue: number; attendanceCount: number }>();
  const employeeMap = new Map<
    string,
    {
      employeeId: string;
      employeeName: string;
      totalRevenue: number;
      attendanceIds: Set<string>;
    }
  >();
  const serviceMap = new Map<
    string,
    { serviceId: string; serviceName: string; count: number; revenue: number }
  >();
  let totalRevenue = 0;

  attendances.forEach((attendance) => {
    if (!isRevenueBearingAttendance(attendance)) {
      return;
    }

    const attendanceRevenue = getAttendanceRevenueTotal(attendance);
    const dateKey = getReportDateKey(attendance.workDate, groupBy);
    const existingRevenue = revenueMap.get(dateKey) ?? {
      date: dateKey,
      revenue: 0,
      attendanceCount: 0,
    };

    existingRevenue.revenue = addMoney(existingRevenue.revenue, attendanceRevenue);
    existingRevenue.attendanceCount += 1;
    revenueMap.set(dateKey, existingRevenue);
    totalRevenue = addMoney(totalRevenue, attendanceRevenue);

    attendance.services.forEach((service) => {
      service.employees?.forEach((employee) => {
        const existingEmployee = employeeMap.get(employee.employeeUserId) ?? {
          employeeId: employee.employeeUserId,
          employeeName: employee.employeeName ?? employee.employeeUserId,
          totalRevenue: 0,
          attendanceIds: new Set<string>(),
        };

        existingEmployee.totalRevenue = addMoney(
          existingEmployee.totalRevenue,
          employee.shareAmount ?? 0,
        );
        existingEmployee.attendanceIds.add(attendance.id);
        employeeMap.set(employee.employeeUserId, existingEmployee);
      });

      if (service.type !== "predefined") {
        return;
      }

      const existingService = serviceMap.get(service.id) ?? {
        serviceId: service.id,
        serviceName: service.name,
        count: 0,
        revenue: 0,
      };

      existingService.count += 1;
      existingService.revenue = addMoney(existingService.revenue, service.price);
      serviceMap.set(service.id, existingService);
    });
  });

  // employeeMap dùng Set để đếm distinct chấm công (thợ ở nhiều service của cùng cc chỉ tính 1) →
  // quy về attendanceCount trước khi finalize.
  return finalizeReportAggregate({
    revenueEntries: Array.from(revenueMap.values()),
    employeeEntries: Array.from(employeeMap.values()).map((employee) => ({
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      totalRevenue: employee.totalRevenue,
      attendanceCount: employee.attendanceIds.size,
    })),
    serviceEntries: Array.from(serviceMap.values()),
    totalRevenue,
    fallbackDailyRevenueDate: getReportDateKey(
      attendances[0]?.workDate ?? fallbackStartDate,
      groupBy,
    ),
  });
};

export const mergeReportAggregates = (
  aggregates: Array<ReturnType<typeof buildReportAggregatesFromAttendances>>,
  fallbackStartDate: string,
) => {
  const revenueMap = new Map<string, { date: string; revenue: number; attendanceCount: number }>();
  const employeeMap = new Map<
    string,
    {
      employeeId: string;
      employeeName: string;
      totalRevenue: number;
      attendanceCount: number;
    }
  >();
  const serviceMap = new Map<
    string,
    { serviceId: string; serviceName: string; count: number; revenue: number }
  >();

  for (const aggregate of aggregates) {
    for (const day of aggregate.dailyRevenue) {
      if (day.revenue === 0 && day.attendanceCount === 0) {
        continue;
      }

      const existing = revenueMap.get(day.date) ?? {
        date: day.date,
        revenue: 0,
        attendanceCount: 0,
      };
      existing.revenue = addMoney(existing.revenue, day.revenue);
      existing.attendanceCount += day.attendanceCount;
      revenueMap.set(day.date, existing);
    }

    for (const employee of aggregate.employeePerformance) {
      const existing = employeeMap.get(employee.employeeId) ?? {
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        totalRevenue: 0,
        attendanceCount: 0,
      };
      existing.totalRevenue = addMoney(existing.totalRevenue, employee.totalRevenue);
      existing.attendanceCount += employee.attendanceCount;
      employeeMap.set(employee.employeeId, existing);
    }

    for (const service of aggregate.serviceReport) {
      const existing = serviceMap.get(service.serviceId) ?? {
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        count: 0,
        revenue: 0,
      };
      existing.count += service.count;
      existing.revenue = addMoney(existing.revenue, service.revenue);
      serviceMap.set(service.serviceId, existing);
    }
  }

  // Không truyền totalRevenue/totalAttendance → finalize tự suy TỪ dailyRevenue đã làm tròn
  // (đúng như bản gốc của nhánh merge: cộng lại từ số ngày đã round).
  return finalizeReportAggregate({
    revenueEntries: Array.from(revenueMap.values()),
    employeeEntries: Array.from(employeeMap.values()),
    serviceEntries: Array.from(serviceMap.values()),
    fallbackDailyRevenueDate: fallbackStartDate,
  });
};
