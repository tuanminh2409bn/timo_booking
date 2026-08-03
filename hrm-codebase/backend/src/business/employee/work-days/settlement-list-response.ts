import { sumMoney } from "../../../helpers/money.js";
import {
  getIncompleteAttendanceIds,
  getSubmittedEmployeeUserIds,
  isSettlementAttendance,
  isWorkDayClosingEffective,
  summarizeResponsibleEmployeeClosing,
} from "../../../helpers/work-day-settlement.js";
import type {
  ShopAttendanceType,
  ShopEmployeeWorkDayClosingType,
  ShopWorkDaySettlementClosingType,
} from "../../../repository/firestore/shop/shop.types.js";
import { normalizeAttendanceForResponse } from "../domain/attendance-presentation.js";

const DEFAULT_SETTLEMENT_EMPLOYEE_DISPLAY_NAME = "Nhân viên";

export type SettlementListEmployee = {
  employeeUserId: string;
  employeeName?: string;
  attendanceCount: number;
  closedCount: number;
  totalRevenue: number;
};

export type SettlementListItem = {
  workDate: string;
  storeId: string;
  status: "open" | "ready" | "closed";
  attendance: {
    totalCount: number;
    openCount: number;
    closedCount: number;
    incompleteCount: number;
    employeeTotalCount: number;
    employeeClosedCount: number;
  };
  employees: SettlementListEmployee[];
  totalRevenue: number;
  totalDiscount: number;
  totalNetAmount: number;
  totalOwnerNetAfterDiscount: number;
  closedAt?: number;
};

const getAttendanceRevenueTotal = (attendance: ShopAttendanceType): number => {
  const servicesTotal = sumMoney(attendance.services.map((service) => service.price));

  if (servicesTotal > 0) {
    return servicesTotal;
  }

  return attendance.subtotalAmount || attendance.totalAmount;
};

const getAttendanceDiscountAmount = (attendance: ShopAttendanceType): number => {
  if (attendance.discount?.amount !== undefined) {
    return attendance.discount.amount;
  }

  return sumMoney(attendance.services.map((service) => service.discountAmount ?? 0));
};

const getSettlementEmployeeDisplayName = (
  employeeUserId: string,
  employeeName: string | undefined,
): string | undefined => {
  const trimmedEmployeeName = employeeName?.trim();

  if (!trimmedEmployeeName || trimmedEmployeeName === employeeUserId) {
    return undefined;
  }

  return trimmedEmployeeName;
};

const addSettlementEmployeeSummary = (
  employeeMap: Map<string, SettlementListEmployee>,
  employee: {
    employeeUserId?: string;
    employeeName?: string;
    shareAmount?: number;
  },
  attendanceStatus: ShopAttendanceType["status"],
): void => {
  const employeeUserId = employee.employeeUserId?.trim();

  if (!employeeUserId) {
    return;
  }

  const employeeDisplayName = getSettlementEmployeeDisplayName(
    employeeUserId,
    employee.employeeName,
  );
  const existingEmployee = employeeMap.get(employeeUserId);
  const settlementEmployee: SettlementListEmployee = existingEmployee ?? {
    employeeUserId,
    attendanceCount: 0,
    closedCount: 0,
    totalRevenue: 0,
    ...(employeeDisplayName !== undefined && { employeeName: employeeDisplayName }),
  };

  if (!settlementEmployee.employeeName && employeeDisplayName !== undefined) {
    settlementEmployee.employeeName = employeeDisplayName;
  }

  settlementEmployee.attendanceCount += 1;

  if (attendanceStatus === "closed") {
    settlementEmployee.closedCount += 1;
  }

  settlementEmployee.totalRevenue = sumMoney([
    settlementEmployee.totalRevenue,
    employee.shareAmount ?? 0,
  ]);
  employeeMap.set(employeeUserId, settlementEmployee);
};

const summarizeSettlementEmployees = (
  attendances: ReturnType<typeof normalizeAttendanceForResponse>[],
): SettlementListEmployee[] => {
  const employeeMap = new Map<string, SettlementListEmployee>();

  attendances.forEach((attendance) => {
    const attendanceEmployeeMap = new Map<
      string,
      {
        employeeUserId: string;
        employeeName?: string;
        shareAmount?: number;
      }
    >();

    const addAttendanceEmployee = (employee: {
      employeeUserId?: string;
      employeeName?: string;
      shareAmount?: number;
    }): void => {
      const employeeUserId = employee.employeeUserId?.trim();

      if (!employeeUserId) {
        return;
      }

      const existingEmployee = attendanceEmployeeMap.get(employeeUserId);
      const employeeName = employee.employeeName ?? existingEmployee?.employeeName;
      attendanceEmployeeMap.set(employeeUserId, {
        employeeUserId,
        shareAmount: sumMoney([
          existingEmployee?.shareAmount ?? 0,
          employee.shareAmount ?? 0,
        ]),
        ...(employeeName !== undefined && { employeeName }),
      });
    };

    attendance.assignees.forEach(addAttendanceEmployee);
    attendance.services.forEach((service) => {
      service.employees?.forEach(addAttendanceEmployee);
    });

    attendanceEmployeeMap.forEach((employee) => {
      addSettlementEmployeeSummary(employeeMap, employee, attendance.status);
    });
  });

  return Array.from(employeeMap.values())
    .map((employee) => ({
      ...employee,
      employeeName: employee.employeeName ?? DEFAULT_SETTLEMENT_EMPLOYEE_DISPLAY_NAME,
    }))
    .sort((left, right) => left.employeeName.localeCompare(right.employeeName, "vi-VN"));
};

const mapClosingEmployees = (
  closing: ShopWorkDaySettlementClosingType | undefined,
): SettlementListEmployee[] => {
  if (!closing) {
    return [];
  }

  return (closing.employeeSummaries ?? []).map((employeeSummary) => ({
    employeeUserId: employeeSummary.employeeUserId,
    employeeName:
      getSettlementEmployeeDisplayName(
        employeeSummary.employeeUserId,
        employeeSummary.employeeName,
      ) ?? DEFAULT_SETTLEMENT_EMPLOYEE_DISPLAY_NAME,
    attendanceCount: 1,
    closedCount: 1,
    totalRevenue: employeeSummary.totalRevenue,
  }));
};

const summarizeSettlementAttendances = (
  attendances: ShopAttendanceType[],
  employeeWorkDayClosings: ShopEmployeeWorkDayClosingType[],
) => {
  const normalizedAttendances = attendances
    .map(normalizeAttendanceForResponse)
    .filter(isSettlementAttendance);
  const incompleteAttendanceIds = getIncompleteAttendanceIds(normalizedAttendances);
  const openCount = normalizedAttendances.filter(
    (attendance) => attendance.status !== "closed",
  ).length;
  const submittedEmployeeUserIds = new Set(
    getSubmittedEmployeeUserIds(normalizedAttendances, employeeWorkDayClosings),
  );
  const responsibleEmployeeSummary = summarizeResponsibleEmployeeClosing(
    normalizedAttendances,
    employeeWorkDayClosings,
  );
  const employees = summarizeSettlementEmployees(normalizedAttendances).map((employee) => ({
    ...employee,
    closedCount: submittedEmployeeUserIds.has(employee.employeeUserId) ? 1 : 0,
  }));

  return {
    totalCount: normalizedAttendances.length,
    openCount,
    closedCount: normalizedAttendances.length - openCount,
    incompleteCount: incompleteAttendanceIds.length,
    employeeTotalCount: responsibleEmployeeSummary.responsibleTotal,
    employeeClosedCount: responsibleEmployeeSummary.responsibleClosed,
    employees,
    totalRevenue: sumMoney(normalizedAttendances.map(getAttendanceRevenueTotal)),
    totalDiscount: sumMoney(normalizedAttendances.map(getAttendanceDiscountAmount)),
    totalNetAmount: sumMoney(
      normalizedAttendances.map((attendance) => attendance.totalAmount),
    ),
  };
};

const getSettlementListItemStatus = (
  closing: ShopWorkDaySettlementClosingType | undefined,
  attendanceSummary: ReturnType<typeof summarizeSettlementAttendances>,
): SettlementListItem["status"] => {
  if (closing !== undefined) {
    return "closed";
  }

  const everyResponsibleEmployeeClosed =
    attendanceSummary.employeeTotalCount > 0 &&
    attendanceSummary.employeeClosedCount === attendanceSummary.employeeTotalCount;

  if (
    attendanceSummary.totalCount > 0 &&
    everyResponsibleEmployeeClosed &&
    attendanceSummary.incompleteCount === 0
  ) {
    return "ready";
  }

  return "open";
};

export const buildWorkDaySettlementListItem = ({
  attendances,
  closing,
  employeeWorkDayClosings,
  storeId,
  workDate,
}: {
  attendances: ShopAttendanceType[];
  closing?: ShopWorkDaySettlementClosingType;
  employeeWorkDayClosings: ShopEmployeeWorkDayClosingType[];
  storeId: string;
  workDate: string;
}): SettlementListItem | null => {
  const attendanceSummary = summarizeSettlementAttendances(
    attendances,
    employeeWorkDayClosings,
  );
  const effectiveClosing = isWorkDayClosingEffective(closing, {
    total: attendanceSummary.employeeTotalCount,
    closed: attendanceSummary.employeeClosedCount,
  })
    ? closing
    : undefined;

  if (attendanceSummary.totalCount === 0 && effectiveClosing === undefined) {
    return null;
  }

  const status = getSettlementListItemStatus(effectiveClosing, attendanceSummary);

  return {
    workDate,
    storeId,
    status,
    attendance: {
      totalCount: attendanceSummary.totalCount,
      openCount: attendanceSummary.openCount,
      closedCount: attendanceSummary.closedCount,
      incompleteCount: attendanceSummary.incompleteCount,
      employeeTotalCount: attendanceSummary.employeeTotalCount,
      employeeClosedCount: attendanceSummary.employeeClosedCount,
    },
    employees:
      attendanceSummary.totalCount > 0
        ? attendanceSummary.employees
        : mapClosingEmployees(effectiveClosing),
    totalRevenue:
      attendanceSummary.totalCount > 0
        ? attendanceSummary.totalRevenue
        : (effectiveClosing?.summary.subtotalAmount ?? 0),
    totalDiscount:
      attendanceSummary.totalCount > 0
        ? attendanceSummary.totalDiscount
        : (effectiveClosing?.summary.totalDiscountAmount ?? 0),
    totalNetAmount:
      effectiveClosing?.summary.totalNetAmount ?? attendanceSummary.totalNetAmount,
    totalOwnerNetAfterDiscount:
      effectiveClosing !== undefined
        ? effectiveClosing.summary.totalOwnerCommission -
          (effectiveClosing.summary.totalOwnerDiscountAmount ?? 0)
        : 0,
    ...(effectiveClosing !== undefined && { closedAt: effectiveClosing.closedAt }),
  };
};
