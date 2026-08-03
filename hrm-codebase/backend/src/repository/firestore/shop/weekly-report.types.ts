export type WeeklyReportDailyMetric = {
  workDate: string;
  attendanceCount: number;
  revenue: number;
  revenueMinor?: number | undefined;
  discount: number;
  discountMinor?: number | undefined;
  netRevenue: number;
  netRevenueMinor?: number | undefined;
  ownerCommission: number;
  ownerCommissionMinor?: number | undefined;
  employeeEarnings: number;
  employeeEarningsMinor?: number | undefined;
};

export type WeeklyReportEmployeeBreakdown = {
  employeeUserId: string;
  employeeName: string;
  totalAttendances: number;
  totalRevenue: number;
  totalRevenueMinor?: number | undefined;
  totalEarnings: number;
  totalEarningsMinor?: number | undefined;
  totalDiscountAllocated?: number | undefined;
  totalDiscountAllocatedMinor?: number | undefined;
  totalOwnerCommission?: number | undefined;
  totalOwnerCommissionMinor?: number | undefined;
  totalWorkedMinutes?: number | undefined;
  compensationModel?: "commission" | "fixed" | "hourly" | undefined;
  fixedSalary?: number | undefined;
  fixedSalaryMinor?: number | undefined;
  hourlyRate?: number | undefined;
  hourlyRateMinor?: number | undefined;
  workingDays: number;
};

export type WeeklyReportDailyEmployeeBreakdown = WeeklyReportEmployeeBreakdown & {
  workDate: string;
};

export type WeeklyReportServiceBreakdown = {
  serviceId: string;
  serviceName: string;
  category: string;
  count: number;
  totalRevenue: number;
  totalRevenueMinor?: number | undefined;
  averagePrice: number;
  averagePriceMinor?: number | undefined;
};

export type WeeklyReportDailyServiceBreakdown = WeeklyReportServiceBreakdown & {
  workDate: string;
};

export type WeeklyReportSummary = {
  totalAttendances: number;
  totalRevenue: number;
  totalRevenueMinor?: number | undefined;
  totalDiscount: number;
  totalDiscountMinor?: number | undefined;
  totalNetRevenue: number;
  totalNetRevenueMinor?: number | undefined;
  totalOwnerCommission: number;
  totalOwnerCommissionMinor?: number | undefined;
  totalEmployeeEarnings: number;
  totalEmployeeEarningsMinor?: number | undefined;
  averageTicketSize: number;
  averageTicketSizeMinor?: number | undefined;
  workingDays: number;
};

export type WeeklyReportType = {
  id: string;
  ownerId: string;
  storeId: string;
  weekStartDate: string;
  weekEndDate: string;
  year: number;
  weekNumber: number;
  isPartial: boolean;
  currency?: string | undefined;
  moneyScale?: number | undefined;

  summary: WeeklyReportSummary;
  dailyMetrics: WeeklyReportDailyMetric[];
  employeeBreakdowns: WeeklyReportEmployeeBreakdown[];
  dailyEmployeeBreakdowns?: WeeklyReportDailyEmployeeBreakdown[] | undefined;
  serviceBreakdowns: WeeklyReportServiceBreakdown[];
  dailyServiceBreakdowns?: WeeklyReportDailyServiceBreakdown[] | undefined;

  generatedAt: number;
  generatedByUserId: string;
  sourceClosingIds: string[];
  revision: number;

  createdAt: number;
  updatedAt: number;
};
