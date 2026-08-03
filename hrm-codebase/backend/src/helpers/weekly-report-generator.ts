import type { ShopWorkDaySettlementReportDayType } from "../repository/firestore/shop/shop.types.js";
import {
  WeeklyReportDailyEmployeeBreakdown,
  WeeklyReportDailyMetric,
  WeeklyReportDailyServiceBreakdown,
  WeeklyReportEmployeeBreakdown,
  WeeklyReportServiceBreakdown,
  WeeklyReportSummary,
  WeeklyReportType,
} from "../repository/firestore/shop/weekly-report.types.js";
import {
  DEFAULT_MONEY_CURRENCY,
  DEFAULT_MONEY_SCALE,
  fromMoneyMinorUnit,
  resolveMoneyAmount,
  toMoneyMinorUnit,
} from "./money.js";

export const getWeekEndDate = (weekStartDate: string): string => {
  const date = new Date(`${weekStartDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
};

const getISOWeekNumber = (date: Date): number => {
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(thursday.getUTCFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((thursday.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    )
  );
};

const getMondayOfWeek = (date: Date): Date => {
  const monday = new Date(date);
  const dayOfWeek = date.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  monday.setUTCDate(date.getUTCDate() + daysToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
};

export const getWeekStartDate = (workDate: string): string =>
  getMondayOfWeek(new Date(`${workDate}T00:00:00.000Z`))
    .toISOString()
    .slice(0, 10);

export const getWeeksInRange = (startDate: string, endDate: string): string[] => {
  const weeks: string[] = [];
  const current = getMondayOfWeek(new Date(`${startDate}T00:00:00.000Z`));
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (current <= end) {
    weeks.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 7);
  }

  return weeks;
};

export const getWeeksInMonth = (year: number, month: number): string[] => {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0));
  return getWeeksInRange(firstDay.toISOString().slice(0, 10), lastDay.toISOString().slice(0, 10));
};

export const isCurrentWeek = (weekStartDate: string): boolean => {
  const now = new Date();
  const currentMonday = getMondayOfWeek(now).toISOString().slice(0, 10);
  return weekStartDate === currentMonday;
};

const toLegacyMoney = (minorUnit: number): number =>
  fromMoneyMinorUnit(minorUnit, DEFAULT_MONEY_SCALE);

const getReportMoneyScale = (report: Pick<WeeklyReportType, "moneyScale">) =>
  report.moneyScale ?? DEFAULT_MONEY_SCALE;

const getSummaryMoneyMinor = (
  report: WeeklyReportType,
  minorValue: number | undefined,
  fallbackAmount: number,
) =>
  typeof minorValue === "number" && Number.isSafeInteger(minorValue)
    ? minorValue
    : toMoneyMinorUnit(fallbackAmount, getReportMoneyScale(report));

export const generateWeeklyReport = (
  ownerId: string,
  storeId: string,
  weekStartDate: string,
  userId: string,
  closedSettlementDays: ShopWorkDaySettlementReportDayType[],
): Omit<WeeklyReportType, "id" | "createdAt" | "updatedAt"> => {
  const weekEndDate = getWeekEndDate(weekStartDate);
  const weekDate = new Date(`${weekStartDate}T00:00:00.000Z`);
  const weekNumber = getISOWeekNumber(weekDate);
  const year = weekDate.getUTCFullYear();

  const weekClosings = closedSettlementDays.filter(
    (c) => c.workDate >= weekStartDate && c.workDate <= weekEndDate,
  );

  const dailyMetrics: WeeklyReportDailyMetric[] = weekClosings.map((closing) => {
    const revenueMinor = toMoneyMinorUnit(closing.summary.subtotalAmount);
    const discountMinor = toMoneyMinorUnit(closing.summary.totalDiscountAmount);
    const netRevenueMinor = toMoneyMinorUnit(closing.summary.totalNetAmount);
    const ownerCommissionMinor = toMoneyMinorUnit(closing.summary.totalOwnerCommission);
    const employeeEarningsMinor = toMoneyMinorUnit(closing.summary.totalEmployeeEarning);

    return {
      workDate: closing.workDate,
      attendanceCount: closing.summary.totalEntries,
      revenue: toLegacyMoney(revenueMinor),
      revenueMinor,
      discount: toLegacyMoney(discountMinor),
      discountMinor,
      netRevenue: toLegacyMoney(netRevenueMinor),
      netRevenueMinor,
      ownerCommission: toLegacyMoney(ownerCommissionMinor),
      ownerCommissionMinor,
      employeeEarnings: toLegacyMoney(employeeEarningsMinor),
      employeeEarningsMinor,
    };
  });

  const dailyEmployeeBreakdowns: WeeklyReportDailyEmployeeBreakdown[] = weekClosings.flatMap(
    (closing) =>
      closing.employeeSummaries.map((emp) => {
        const totalRevenueMinor = toMoneyMinorUnit(emp.totalRevenue);
        const totalEarningsMinor = toMoneyMinorUnit(emp.employeeEarning);
        const totalDiscountAllocatedMinor = toMoneyMinorUnit(emp.discountAllocated);
        const totalOwnerCommissionMinor = toMoneyMinorUnit(emp.ownerCommission);
        const hourlyRateMinor =
          emp.hourlyRate !== undefined ? toMoneyMinorUnit(emp.hourlyRate) : undefined;
        const fixedSalaryMinor =
          emp.fixedSalary !== undefined ? toMoneyMinorUnit(emp.fixedSalary) : undefined;

        return {
          workDate: closing.workDate,
          employeeUserId: emp.employeeUserId,
          employeeName: emp.employeeName,
          totalAttendances: 1,
          totalRevenue: toLegacyMoney(totalRevenueMinor),
          totalRevenueMinor,
          totalEarnings: toLegacyMoney(totalEarningsMinor),
          totalEarningsMinor,
          totalDiscountAllocated: toLegacyMoney(totalDiscountAllocatedMinor),
          totalDiscountAllocatedMinor,
          totalOwnerCommission: toLegacyMoney(totalOwnerCommissionMinor),
          totalOwnerCommissionMinor,
          totalWorkedMinutes: emp.workedMinutes,
          compensationModel: emp.compensationModel,
          ...(fixedSalaryMinor !== undefined && {
            fixedSalary: toLegacyMoney(fixedSalaryMinor),
            fixedSalaryMinor,
          }),
          ...(hourlyRateMinor !== undefined && {
            hourlyRate: toLegacyMoney(hourlyRateMinor),
            hourlyRateMinor,
          }),
          workingDays: 1,
        };
      }),
  );

  const employeeMap = new Map<
    string,
    {
      employeeName: string;
      totalAttendances: number;
      totalRevenueMinor: number;
      totalEarningsMinor: number;
      totalDiscountAllocatedMinor: number;
      totalOwnerCommissionMinor: number;
      totalWorkedMinutes: number;
      compensationModel?: "commission" | "fixed" | "hourly";
      fixedSalaryMinor?: number;
      hourlyRateMinor?: number;
      workingDays: Set<string>;
    }
  >();

  for (const closing of weekClosings) {
    for (const emp of closing.employeeSummaries) {
      const totalRevenueMinor = toMoneyMinorUnit(emp.totalRevenue);
      const totalEarningsMinor = toMoneyMinorUnit(emp.employeeEarning);
      const totalDiscountAllocatedMinor = toMoneyMinorUnit(emp.discountAllocated);
      const totalOwnerCommissionMinor = toMoneyMinorUnit(emp.ownerCommission);
      const hourlyRateMinor =
        emp.hourlyRate !== undefined ? toMoneyMinorUnit(emp.hourlyRate) : undefined;
      const fixedSalaryMinor =
        emp.fixedSalary !== undefined ? toMoneyMinorUnit(emp.fixedSalary) : undefined;
      const existing = employeeMap.get(emp.employeeUserId);
      if (existing) {
        existing.totalAttendances += 1;
        existing.totalRevenueMinor += totalRevenueMinor;
        existing.totalEarningsMinor += totalEarningsMinor;
        existing.totalDiscountAllocatedMinor += totalDiscountAllocatedMinor;
        existing.totalOwnerCommissionMinor += totalOwnerCommissionMinor;
        existing.totalWorkedMinutes += emp.workedMinutes;
        existing.compensationModel = emp.compensationModel;
        if (hourlyRateMinor !== undefined) {
          existing.hourlyRateMinor = hourlyRateMinor;
        }
        if (fixedSalaryMinor !== undefined) {
          existing.fixedSalaryMinor = fixedSalaryMinor;
        }
        existing.workingDays.add(closing.workDate);
      } else {
        employeeMap.set(emp.employeeUserId, {
          employeeName: emp.employeeName,
          totalAttendances: 1,
          totalRevenueMinor,
          totalEarningsMinor,
          totalDiscountAllocatedMinor,
          totalOwnerCommissionMinor,
          totalWorkedMinutes: emp.workedMinutes,
          compensationModel: emp.compensationModel,
          ...(fixedSalaryMinor !== undefined && { fixedSalaryMinor }),
          ...(hourlyRateMinor !== undefined && { hourlyRateMinor }),
          workingDays: new Set([closing.workDate]),
        });
      }
    }
  }

  const employeeBreakdowns: WeeklyReportEmployeeBreakdown[] = Array.from(employeeMap.entries()).map(
    ([employeeUserId, data]) => ({
      employeeUserId,
      employeeName: data.employeeName,
      totalAttendances: data.totalAttendances,
      totalRevenue: toLegacyMoney(data.totalRevenueMinor),
      totalRevenueMinor: data.totalRevenueMinor,
      totalEarnings: toLegacyMoney(data.totalEarningsMinor),
      totalEarningsMinor: data.totalEarningsMinor,
      totalDiscountAllocated: toLegacyMoney(data.totalDiscountAllocatedMinor),
      totalDiscountAllocatedMinor: data.totalDiscountAllocatedMinor,
      totalOwnerCommission: toLegacyMoney(data.totalOwnerCommissionMinor),
      totalOwnerCommissionMinor: data.totalOwnerCommissionMinor,
      totalWorkedMinutes: data.totalWorkedMinutes,
      ...(data.compensationModel !== undefined && { compensationModel: data.compensationModel }),
      ...(data.fixedSalaryMinor !== undefined && {
        fixedSalary: toLegacyMoney(data.fixedSalaryMinor),
        fixedSalaryMinor: data.fixedSalaryMinor,
      }),
      ...(data.hourlyRateMinor !== undefined && {
        hourlyRate: toLegacyMoney(data.hourlyRateMinor),
        hourlyRateMinor: data.hourlyRateMinor,
      }),
      workingDays: data.workingDays.size,
    }),
  );

  const dailyServiceBreakdowns: WeeklyReportDailyServiceBreakdown[] = weekClosings.flatMap(
    (closing) =>
      (closing.serviceSummaries ?? []).map((service) => ({
        workDate: closing.workDate,
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        category: service.category,
        count: service.count,
        totalRevenue: service.totalRevenue,
        ...(service.totalRevenueMinor !== undefined && {
          totalRevenueMinor: service.totalRevenueMinor,
        }),
        averagePrice: service.averagePrice,
        ...(service.averagePriceMinor !== undefined && {
          averagePriceMinor: service.averagePriceMinor,
        }),
      })),
  );

  const serviceMap = new Map<
    string,
    {
      serviceName: string;
      category: string;
      count: number;
      totalRevenueMinor: number;
    }
  >();

  for (const closing of weekClosings) {
    for (const service of closing.serviceSummaries ?? []) {
      const existing = serviceMap.get(service.serviceId) ?? {
        serviceName: service.serviceName,
        category: service.category,
        count: 0,
        totalRevenueMinor: 0,
      };

      existing.count += service.count;
      existing.totalRevenueMinor +=
        service.totalRevenueMinor ?? toMoneyMinorUnit(service.totalRevenue);
      serviceMap.set(service.serviceId, existing);
    }
  }

  const serviceBreakdowns: WeeklyReportServiceBreakdown[] = Array.from(serviceMap.entries())
    .map(([serviceId, service]) => {
      const averagePriceMinor =
        service.count > 0 ? Math.round(service.totalRevenueMinor / service.count) : 0;

      return {
        serviceId,
        serviceName: service.serviceName,
        category: service.category,
        count: service.count,
        totalRevenue: toLegacyMoney(service.totalRevenueMinor),
        totalRevenueMinor: service.totalRevenueMinor,
        averagePrice: toLegacyMoney(averagePriceMinor),
        averagePriceMinor,
      };
    })
    .sort((left, right) => right.totalRevenue - left.totalRevenue);

  const summaryMinor = dailyMetrics.reduce(
    (acc, day) => ({
      totalAttendances: acc.totalAttendances + day.attendanceCount,
      totalRevenueMinor: acc.totalRevenueMinor + (day.revenueMinor ?? 0),
      totalDiscountMinor: acc.totalDiscountMinor + (day.discountMinor ?? 0),
      totalNetRevenueMinor: acc.totalNetRevenueMinor + (day.netRevenueMinor ?? 0),
      totalOwnerCommissionMinor: acc.totalOwnerCommissionMinor + (day.ownerCommissionMinor ?? 0),
      totalEmployeeEarningsMinor: acc.totalEmployeeEarningsMinor + (day.employeeEarningsMinor ?? 0),
      averageTicketSizeMinor: 0,
      workingDays: acc.workingDays + 1,
    }),
    {
      totalAttendances: 0,
      totalRevenueMinor: 0,
      totalDiscountMinor: 0,
      totalNetRevenueMinor: 0,
      totalOwnerCommissionMinor: 0,
      totalEmployeeEarningsMinor: 0,
      averageTicketSizeMinor: 0,
      workingDays: 0,
    },
  );

  summaryMinor.averageTicketSizeMinor =
    summaryMinor.totalAttendances > 0
      ? Math.round(summaryMinor.totalRevenueMinor / summaryMinor.totalAttendances)
      : 0;

  const summary: WeeklyReportSummary = {
    totalAttendances: summaryMinor.totalAttendances,
    totalRevenue: toLegacyMoney(summaryMinor.totalRevenueMinor),
    totalRevenueMinor: summaryMinor.totalRevenueMinor,
    totalDiscount: toLegacyMoney(summaryMinor.totalDiscountMinor),
    totalDiscountMinor: summaryMinor.totalDiscountMinor,
    totalNetRevenue: toLegacyMoney(summaryMinor.totalNetRevenueMinor),
    totalNetRevenueMinor: summaryMinor.totalNetRevenueMinor,
    totalOwnerCommission: toLegacyMoney(summaryMinor.totalOwnerCommissionMinor),
    totalOwnerCommissionMinor: summaryMinor.totalOwnerCommissionMinor,
    totalEmployeeEarnings: toLegacyMoney(summaryMinor.totalEmployeeEarningsMinor),
    totalEmployeeEarningsMinor: summaryMinor.totalEmployeeEarningsMinor,
    averageTicketSize: toLegacyMoney(summaryMinor.averageTicketSizeMinor),
    averageTicketSizeMinor: summaryMinor.averageTicketSizeMinor,
    workingDays: summaryMinor.workingDays,
  };

  const isPartial =
    isCurrentWeek(weekStartDate) || weekEndDate > new Date().toISOString().slice(0, 10);

  return {
    ownerId,
    storeId,
    weekStartDate,
    weekEndDate,
    year,
    weekNumber,
    isPartial,
    currency: DEFAULT_MONEY_CURRENCY,
    moneyScale: DEFAULT_MONEY_SCALE,
    summary,
    dailyMetrics,
    employeeBreakdowns,
    dailyEmployeeBreakdowns,
    serviceBreakdowns,
    dailyServiceBreakdowns,
    generatedAt: Date.now(),
    generatedByUserId: userId,
    sourceClosingIds: weekClosings.map((c) => c.id),
    revision: 4,
  };
};

export const aggregateWeeklyReports = (
  reports: WeeklyReportType[],
): WeeklyReportSummary & { workingDays: number } => {
  const aggregate = reports.reduce(
    (acc, report) => {
      const scale = getReportMoneyScale(report);
      const totalRevenueMinor = getSummaryMoneyMinor(
        report,
        report.summary.totalRevenueMinor,
        report.summary.totalRevenue,
      );
      const totalDiscountMinor = getSummaryMoneyMinor(
        report,
        report.summary.totalDiscountMinor,
        report.summary.totalDiscount,
      );
      const totalNetRevenueMinor = getSummaryMoneyMinor(
        report,
        report.summary.totalNetRevenueMinor,
        report.summary.totalNetRevenue,
      );
      const totalOwnerCommissionMinor = getSummaryMoneyMinor(
        report,
        report.summary.totalOwnerCommissionMinor,
        report.summary.totalOwnerCommission,
      );
      const totalEmployeeEarningsMinor = getSummaryMoneyMinor(
        report,
        report.summary.totalEmployeeEarningsMinor,
        report.summary.totalEmployeeEarnings,
      );
      const next = {
        totalAttendances: acc.totalAttendances + report.summary.totalAttendances,
        totalRevenueMinor: acc.totalRevenueMinor + totalRevenueMinor,
        totalDiscountMinor: acc.totalDiscountMinor + totalDiscountMinor,
        totalNetRevenueMinor: acc.totalNetRevenueMinor + totalNetRevenueMinor,
        totalOwnerCommissionMinor: acc.totalOwnerCommissionMinor + totalOwnerCommissionMinor,
        totalEmployeeEarningsMinor: acc.totalEmployeeEarningsMinor + totalEmployeeEarningsMinor,
        workingDays: acc.workingDays + report.summary.workingDays,
        averageTicketSizeMinor: 0,
        scale,
      };
      next.averageTicketSizeMinor =
        next.totalAttendances > 0 ? Math.round(next.totalRevenueMinor / next.totalAttendances) : 0;
      return next;
    },
    {
      totalAttendances: 0,
      totalRevenueMinor: 0,
      totalDiscountMinor: 0,
      totalNetRevenueMinor: 0,
      totalOwnerCommissionMinor: 0,
      totalEmployeeEarningsMinor: 0,
      workingDays: 0,
      averageTicketSizeMinor: 0,
      scale: DEFAULT_MONEY_SCALE,
    },
  );

  return {
    totalAttendances: aggregate.totalAttendances,
    totalRevenue: resolveMoneyAmount(undefined, aggregate.totalRevenueMinor, aggregate.scale),
    totalRevenueMinor: aggregate.totalRevenueMinor,
    totalDiscount: resolveMoneyAmount(undefined, aggregate.totalDiscountMinor, aggregate.scale),
    totalDiscountMinor: aggregate.totalDiscountMinor,
    totalNetRevenue: resolveMoneyAmount(undefined, aggregate.totalNetRevenueMinor, aggregate.scale),
    totalNetRevenueMinor: aggregate.totalNetRevenueMinor,
    totalOwnerCommission: resolveMoneyAmount(
      undefined,
      aggregate.totalOwnerCommissionMinor,
      aggregate.scale,
    ),
    totalOwnerCommissionMinor: aggregate.totalOwnerCommissionMinor,
    totalEmployeeEarnings: resolveMoneyAmount(
      undefined,
      aggregate.totalEmployeeEarningsMinor,
      aggregate.scale,
    ),
    totalEmployeeEarningsMinor: aggregate.totalEmployeeEarningsMinor,
    averageTicketSize: resolveMoneyAmount(
      undefined,
      aggregate.averageTicketSizeMinor,
      aggregate.scale,
    ),
    averageTicketSizeMinor: aggregate.averageTicketSizeMinor,
    workingDays: aggregate.workingDays,
  };
};
