import type {
  ShopWorkDayEmployeeSummaryType,
  ShopWorkDaySettlementReportDayType,
} from "../../../repository/firestore/shop/shop.types.js";
import type { ShopEmployeeListItem } from "../../../repository/firestore/user/user-factory.js";
import {
  addMoney,
  divideMoney,
  fromMoneyMinorUnit,
  roundMoney,
  subtractMoney,
  sumMoney,
  toMoneyMinorUnit,
} from "../../../helpers/money.js";

const roundCurrency = roundMoney;

export type MonthlySalaryEmployee = {
  employeeUserId: string;
  name: string;
  position?: string;
  compensationModel: "commission" | "fixed" | "hourly";
  fixedSalary?: number;
  hourlyRate?: number;
  totalRevenue: number;
  discountAllocated: number;
  ownerCommission: number;
  commissionEarning: number;
  fixedEarning: number;
  hourlyEarning: number;
  totalSalary: number;
  workedMinutes: number;
  closedDayCount: number;
  lastClosedWorkDate?: string;
};

export type MonthlySalarySummary = {
  totalSalary: number;
  totalCommissionEarning: number;
  totalFixedEarning: number;
  totalHourlyEarning: number;
  totalRevenue: number;
  totalDiscount: number;
  totalOwnerCommission: number;
  totalEmployees: number;
  paidEmployeeCount: 0;
  closedDayCount: number;
  averageSalary: number;
  previousTotalSalary: number;
  salaryGrowthPercent: number;
};

const resolveCompensationModel = (
  summary?: Pick<ShopWorkDayEmployeeSummaryType, "compensationModel" | "fixedSalary" | "hourlyRate">,
  employee?: Pick<ShopEmployeeListItem, "compensationModel" | "fixedSalary" | "hourlyRate">,
): "commission" | "fixed" | "hourly" => {
  if (summary?.compensationModel) {
    return summary.compensationModel;
  }

  if (employee?.compensationModel) {
    return employee.compensationModel;
  }

  return summary?.hourlyRate !== undefined || employee?.hourlyRate !== undefined
    ? "hourly"
    : "commission";
};

const DEFAULT_SALARY_EMPLOYEE_DISPLAY_NAME = "Nhân viên";

export const getSalaryEmployeeDisplayName = (
  employeeUserId: string,
  employee?: Pick<ShopEmployeeListItem, "name" | "displayName" | "email">,
  summaryName?: string,
) => {
  const employeeName = employee?.name?.trim();
  if (employeeName && employeeName !== employeeUserId) {
    return employeeName;
  }

  const employeeDisplayName = employee?.displayName?.trim();
  if (employeeDisplayName && employeeDisplayName !== employeeUserId) {
    return employeeDisplayName;
  }

  const closingEmployeeName = summaryName?.trim();
  return closingEmployeeName && closingEmployeeName !== employeeUserId
    ? closingEmployeeName
    : DEFAULT_SALARY_EMPLOYEE_DISPLAY_NAME;
};

const getHourlyRate = (
  summary?: Pick<ShopWorkDayEmployeeSummaryType, "hourlyRate">,
  employee?: Pick<ShopEmployeeListItem, "hourlyRate" | "fixedSalary">,
) => summary?.hourlyRate ?? employee?.hourlyRate;

export const calculateHourlyEarning = (hourlyRate: number | undefined, workedMinutes: number) =>
  hourlyRate === undefined
    ? 0
    : fromMoneyMinorUnit(Math.round((toMoneyMinorUnit(hourlyRate) * workedMinutes) / 60));

export const buildMonthlySalaryEmployees = (
  closedSettlementDays: ShopWorkDaySettlementReportDayType[],
  storeEmployees: ShopEmployeeListItem[],
): MonthlySalaryEmployee[] => {
  const employeeMap = new Map<string, MonthlySalaryEmployee>();
  const employeeLookup = new Map(storeEmployees.map((employee) => [employee.uid, employee]));

  storeEmployees.forEach((employee) => {
    const compensationModel = resolveCompensationModel(undefined, employee);
    const hourlyRate = getHourlyRate(undefined, employee);
    const fixedSalary = employee.compensationModel === "fixed" ? employee.fixedSalary : undefined;

    employeeMap.set(employee.uid, {
      employeeUserId: employee.uid,
      name: getSalaryEmployeeDisplayName(employee.uid, employee),
      ...(employee.position !== undefined && { position: employee.position }),
      compensationModel,
      ...(fixedSalary !== undefined && { fixedSalary }),
      ...(hourlyRate !== undefined && { hourlyRate }),
      totalRevenue: 0,
      discountAllocated: 0,
      ownerCommission: 0,
      commissionEarning: 0,
      fixedEarning: fixedSalary ?? 0,
      hourlyEarning: 0,
      totalSalary: fixedSalary ?? 0,
      workedMinutes: 0,
      closedDayCount: 0,
    });
  });

  closedSettlementDays.forEach((closing) => {
    closing.employeeSummaries.forEach((summary) => {
      const employee = employeeLookup.get(summary.employeeUserId);
      const compensationModel = resolveCompensationModel(summary, employee);
      const hourlyRate = getHourlyRate(summary, employee);
      const existing = employeeMap.get(summary.employeeUserId) ?? {
        employeeUserId: summary.employeeUserId,
        name: getSalaryEmployeeDisplayName(
          summary.employeeUserId,
          employee,
          summary.employeeName,
        ),
        ...(employee?.position !== undefined && { position: employee.position }),
        compensationModel,
        ...(summary.fixedSalary !== undefined && { fixedSalary: summary.fixedSalary }),
        totalRevenue: 0,
        discountAllocated: 0,
        ownerCommission: 0,
        commissionEarning: 0,
        fixedEarning: compensationModel === "fixed" ? (summary.fixedSalary ?? 0) : 0,
        hourlyEarning: 0,
        totalSalary: compensationModel === "fixed" ? (summary.fixedSalary ?? 0) : 0,
        workedMinutes: 0,
        closedDayCount: 0,
      };
      const hourlyEarning =
        compensationModel === "hourly"
          ? calculateHourlyEarning(hourlyRate, summary.workedMinutes)
          : 0;
      const commissionEarning = compensationModel === "commission" ? summary.employeeEarning : 0;
      const fixedEarning = compensationModel === "fixed" ? (summary.fixedSalary ?? employee?.fixedSalary ?? 0) : 0;

      existing.name = getSalaryEmployeeDisplayName(
        summary.employeeUserId,
        employee,
        summary.employeeName,
      );
      existing.compensationModel = compensationModel;
      existing.totalRevenue = addMoney(existing.totalRevenue, summary.totalRevenue);
      existing.discountAllocated = addMoney(existing.discountAllocated, summary.discountAllocated);
      existing.ownerCommission = addMoney(existing.ownerCommission, summary.ownerCommission);
      existing.commissionEarning = addMoney(existing.commissionEarning, commissionEarning);
      existing.fixedEarning = fixedEarning;
      existing.hourlyEarning = addMoney(existing.hourlyEarning, hourlyEarning);
      existing.totalSalary = addMoney(
        addMoney(existing.commissionEarning, existing.fixedEarning),
        existing.hourlyEarning,
      );
      existing.workedMinutes += summary.workedMinutes;
      existing.closedDayCount += 1;
      existing.lastClosedWorkDate =
        existing.lastClosedWorkDate && existing.lastClosedWorkDate > closing.workDate
          ? existing.lastClosedWorkDate
          : closing.workDate;

      if (employee?.position !== undefined) {
        existing.position = employee.position;
      }

      if (hourlyRate !== undefined) {
        existing.hourlyRate = hourlyRate;
      }

      if (summary.fixedSalary !== undefined || employee?.fixedSalary !== undefined) {
        const fixedSalary = summary.fixedSalary ?? employee?.fixedSalary;
        if (fixedSalary !== undefined) {
          existing.fixedSalary = fixedSalary;
        }
      }

      employeeMap.set(summary.employeeUserId, existing);
    });
  });

  return Array.from(employeeMap.values()).sort((left, right) =>
    left.name.localeCompare(right.name, "vi-VN"),
  );
};

export const getTotalSalary = (employees: MonthlySalaryEmployee[]) =>
  sumMoney(employees.map((employee) => employee.totalSalary));

export const buildMonthlySalarySummary = (
  employees: MonthlySalaryEmployee[],
  closings: { length: number },
  previousTotalSalary: number,
): MonthlySalarySummary => {
  const totalSalary = getTotalSalary(employees);
  const totalEmployees = employees.length;
  let salaryGrowthPercent: number;

  if (previousTotalSalary > 0) {
    salaryGrowthPercent = roundCurrency(
      (subtractMoney(totalSalary, previousTotalSalary) / previousTotalSalary) * 100,
    );
  } else if (totalSalary > 0) {
    salaryGrowthPercent = 100;
  } else {
    salaryGrowthPercent = 0;
  }

  return {
    totalSalary,
    totalCommissionEarning: sumMoney(employees.map((employee) => employee.commissionEarning)),
    totalFixedEarning: sumMoney(employees.map((employee) => employee.fixedEarning)),
    totalHourlyEarning: sumMoney(employees.map((employee) => employee.hourlyEarning)),
    totalRevenue: sumMoney(employees.map((employee) => employee.totalRevenue)),
    totalDiscount: sumMoney(employees.map((employee) => employee.discountAllocated)),
    totalOwnerCommission: sumMoney(employees.map((employee) => employee.ownerCommission)),
    totalEmployees,
    paidEmployeeCount: 0,
    closedDayCount: closings.length,
    averageSalary: divideMoney(totalSalary, totalEmployees),
    previousTotalSalary,
    salaryGrowthPercent,
  };
};
