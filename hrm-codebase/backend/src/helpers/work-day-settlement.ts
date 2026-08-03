import {
  ShopAttendanceAssigneeType,
  ShopAttendanceType,
  ShopDiscountOwnerCoverageRateType,
  ShopEmployeeCompensationModelType,
  ShopEmployeeWorkDayClosingType,
  ShopServiceType,
  ShopWorkDayEmployeeSummaryType,
  ShopWorkDayServiceSummaryType,
} from "../repository/firestore/shop/shop.types.js";
import {
  addMoney,
  allocateMoneyMinorUnits,
  fromMoneyMinorUnit,
  subtractMoney,
  sumMoney,
  toMoneyMinorUnit,
} from "./money.js";

const PERCENT_SCALE = 100;
const FULL_PERCENT_UNITS = 100 * PERCENT_SCALE;
const DEFAULT_OWNER_COMMISSION_RATE = 50;

const toPercentUnits = (value: number): number => Math.max(0, Math.round(value * PERCENT_SCALE));

const fromPercentUnits = (value: number): number => value / PERCENT_SCALE;

const getPercentFromMinorUnits = (partMinorUnit: number, totalMinorUnit: number): number =>
  totalMinorUnit > 0
    ? fromPercentUnits(Math.round((partMinorUnit * FULL_PERCENT_UNITS) / totalMinorUnit))
    : 0;

type EmployeeCompensationConfig = {
  uid: string;
  name?: string | undefined;
  compensationModel?: ShopEmployeeCompensationModelType | undefined;
  ownerCommissionRate?: number | undefined;
  fixedSalary?: number | undefined;
  hourlyRate?: number | undefined;
};

type NormalizedAttendanceEmployee = Required<
  Pick<ShopAttendanceAssigneeType, "employeeUserId" | "employeeName" | "percentage" | "shareAmount">
>;

type NormalizedAttendanceService = ShopServiceType & {
  employees: NormalizedAttendanceEmployee[];
};

type WorkDayDiscountAllocationResult = {
  employeeAmount: number;
  ownerAmount: number;
  unallocatedAmount: number;
  targetEmployeeUserIds: string[];
  discountEligibleEmployeeUserIds: string[];
  allocationError?: string | undefined;
};

const normalizeAttendanceEmployees = (
  employees: ShopAttendanceAssigneeType[],
  servicePrice: number,
): NormalizedAttendanceEmployee[] => {
  if (employees.length === 0) {
    return [];
  }

  const hasExplicitPercentages = employees.some((employee) => employee.percentage !== undefined);
  const servicePriceMinor = toMoneyMinorUnit(servicePrice);
  const weights = hasExplicitPercentages
    ? employees.map((employee) => toPercentUnits(employee.percentage ?? 0))
    : employees.map(() => 1);
  const totalPercentUnits = weights.reduce((sum, weight) => sum + weight, 0);
  const shouldNormalizeToFullAmount =
    !hasExplicitPercentages || Math.abs(totalPercentUnits - FULL_PERCENT_UNITS) <= 1;
  const allocationTotalMinor = shouldNormalizeToFullAmount
    ? servicePriceMinor
    : Math.round((servicePriceMinor * totalPercentUnits) / FULL_PERCENT_UNITS);
  const shareMinorUnits = allocateMoneyMinorUnits(allocationTotalMinor, weights);
  const percentageUnits = shouldNormalizeToFullAmount
    ? allocateMoneyMinorUnits(FULL_PERCENT_UNITS, weights)
    : weights;

  return employees.map((employee, index) => {
    const percentage = fromPercentUnits(percentageUnits[index] ?? 0);
    const computedShareAmount = fromMoneyMinorUnit(shareMinorUnits[index] ?? 0);
    const shareAmount =
      hasExplicitPercentages || employee.shareAmount === undefined
        ? computedShareAmount
        : fromMoneyMinorUnit(toMoneyMinorUnit(Math.max(0, employee.shareAmount)));

    return {
      employeeUserId: employee.employeeUserId,
      employeeName: employee.employeeName?.trim() || employee.employeeUserId,
      percentage,
      shareAmount,
    };
  });
};

const getAttendanceDiscountAmount = (attendance: ShopAttendanceType) => {
  if (attendance.discount?.amount !== undefined) {
    return fromMoneyMinorUnit(toMoneyMinorUnit(attendance.discount.amount));
  }

  return sumMoney(attendance.services.map((service) => service.discountAmount ?? 0));
};

const getAttendanceRevenueTotal = (attendance: ShopAttendanceType) => {
  const servicesTotalMinor = attendance.services.reduce(
    (sum, service) => sum + toMoneyMinorUnit(service.price),
    0,
  );

  return servicesTotalMinor > 0
    ? fromMoneyMinorUnit(servicesTotalMinor)
    : fromMoneyMinorUnit(toMoneyMinorUnit(attendance.totalAmount));
};

const resolveCompensationModel = (
  employeeConfig: EmployeeCompensationConfig | undefined,
): ShopEmployeeCompensationModelType =>
  employeeConfig?.compensationModel ??
  (employeeConfig?.hourlyRate !== undefined ? "hourly" : "commission");

const resolveOwnerCommissionRate = (
  employeeConfig: EmployeeCompensationConfig | undefined,
): number =>
  Math.min(100, Math.max(0, employeeConfig?.ownerCommissionRate ?? DEFAULT_OWNER_COMMISSION_RATE));

const isNonCommissionEmployee = (employeeSummary: ShopWorkDayEmployeeSummaryType) =>
  employeeSummary.compensationModel !== "commission";

export const isRevenueBearingAttendance = (
  attendance: Pick<ShopAttendanceType, "bookingStatus">,
): boolean => (attendance.bookingStatus ?? "confirmed") === "confirmed";

// Bản tạo nhanh còn rỗng chưa phải dữ liệu làm việc để tính hoặc chốt sổ.
// Dịch vụ có giá 0 vẫn hợp lệ vì vẫn ghi nhận công việc thực tế của nhân viên.
export const isSettlementAttendance = (
  attendance: Pick<
    ShopAttendanceType,
    "bookingStatus" | "services" | "subtotalAmount" | "totalAmount"
  >,
): boolean =>
  isRevenueBearingAttendance(attendance) &&
  (attendance.services.length > 0 ||
    toMoneyMinorUnit(attendance.subtotalAmount) !== 0 ||
    toMoneyMinorUnit(attendance.totalAmount) !== 0);

export const getAttendanceServices = (
  attendance: ShopAttendanceType,
): NormalizedAttendanceService[] => {
  const fallbackEmployees = normalizeAttendanceEmployees(
    attendance.assignees,
    attendance.subtotalAmount,
  );

  return attendance.services.map((service) => ({
    ...service,
    employees: service.employees?.length
      ? normalizeAttendanceEmployees(service.employees, service.price)
      : fallbackEmployees,
  }));
};

export const getAttendanceServiceEmployees = (attendance: ShopAttendanceType) => {
  const employeeMap = new Map<string, NormalizedAttendanceEmployee>();

  getAttendanceServices(attendance).forEach((service) => {
    service.employees.forEach((employee) => {
      const existingEmployee = employeeMap.get(employee.employeeUserId);

      if (existingEmployee) {
        employeeMap.set(employee.employeeUserId, {
          ...existingEmployee,
          shareAmount: addMoney(existingEmployee.shareAmount, employee.shareAmount ?? 0),
        });
        return;
      }

      employeeMap.set(employee.employeeUserId, {
        employeeUserId: employee.employeeUserId,
        employeeName: employee.employeeName ?? employee.employeeUserId,
        percentage: employee.percentage ?? 0,
        shareAmount: fromMoneyMinorUnit(toMoneyMinorUnit(employee.shareAmount ?? 0)),
      });
    });
  });

  const totalRevenueMinor = Array.from(employeeMap.values()).reduce(
    (sum, employee) => sum + toMoneyMinorUnit(employee.shareAmount),
    0,
  );

  return Array.from(employeeMap.values()).map((employee) => ({
    ...employee,
    percentage: getPercentFromMinorUnits(toMoneyMinorUnit(employee.shareAmount), totalRevenueMinor),
  }));
};

export const getResponsibleEmployeeUserId = (
  attendance: ShopAttendanceType,
): string | undefined => {
  const primaryEmployeeUserId = attendance.employeeUserId?.trim();

  if (primaryEmployeeUserId) {
    return primaryEmployeeUserId;
  }

  const serviceEmployees = getAttendanceServiceEmployees(attendance);
  // Fall back to top-level assignees when there are no service-level employees yet
  // (e.g. an incomplete attendance with empty services still belongs to someone).
  const candidates =
    serviceEmployees.length > 0
      ? serviceEmployees
      : attendance.assignees.map((assignee) => ({
          employeeUserId: assignee.employeeUserId,
          shareAmount: assignee.shareAmount ?? 0,
        }));

  const createdBy = attendance.createdBy;

  if (createdBy && candidates.some((candidate) => candidate.employeeUserId === createdBy)) {
    return createdBy;
  }

  if (candidates.length === 0) {
    // An incomplete attendance with no services/assignees still belongs to its creator,
    // who must complete or close it — keep it inside the creator's close-day scope.
    return createdBy || undefined;
  }

  // Owner-created attendance: the assignee with the highest revenue share is responsible,
  // tie-break by first appearance (the candidate order is preserved).
  return candidates.reduce((best, current) =>
    toMoneyMinorUnit(current.shareAmount) > toMoneyMinorUnit(best.shareAmount) ? current : best,
  ).employeeUserId;
};

export const getResponsibleEmployeeUserIdsForAttendance = (
  attendance: ShopAttendanceType,
): string[] => {
  const employeeUserIds = new Set<string>();
  const addEmployeeUserId = (employeeUserId: string | undefined): void => {
    const normalizedEmployeeUserId = employeeUserId?.trim();
    if (normalizedEmployeeUserId) employeeUserIds.add(normalizedEmployeeUserId);
  };

  addEmployeeUserId(attendance.employeeUserId);
  getAttendanceServiceEmployees(attendance).forEach((employee) =>
    addEmployeeUserId(employee.employeeUserId),
  );
  attendance.assignees.forEach((employee) => addEmployeeUserId(employee.employeeUserId));

  return Array.from(employeeUserIds);
};

const getResponsibleEmployeeAttendanceVersions = (
  attendances: ShopAttendanceType[],
): Map<string, Map<string, number>> => {
  const attendanceVersionsByEmployee = new Map<string, Map<string, number>>();

  attendances.filter(isSettlementAttendance).forEach((attendance) => {
    getResponsibleEmployeeUserIdsForAttendance(attendance).forEach((employeeUserId) => {
      const attendanceVersions =
        attendanceVersionsByEmployee.get(employeeUserId) ?? new Map<string, number>();
      attendanceVersions.set(attendance.id, attendance.updatedAt);
      attendanceVersionsByEmployee.set(employeeUserId, attendanceVersions);
    });
  });

  return attendanceVersionsByEmployee;
};

const isEmployeeWorkDayClosingCurrent = (
  closing: ShopEmployeeWorkDayClosingType,
  attendanceVersions: Map<string, number>,
): boolean => {
  const relevantClosingAttendanceIds = closing.attendanceIds.filter((attendanceId) =>
    attendanceVersions.has(attendanceId),
  );

  return (
    relevantClosingAttendanceIds.length === attendanceVersions.size &&
    relevantClosingAttendanceIds.every(
      (attendanceId) =>
        closing.attendanceVersions[attendanceId] === attendanceVersions.get(attendanceId),
    )
  );
};

const getSubmittedEmployeeUserIdsFromClosings = (
  attendances: ShopAttendanceType[],
  employeeWorkDayClosings: ShopEmployeeWorkDayClosingType[],
): string[] => {
  const attendanceVersionsByEmployee = getResponsibleEmployeeAttendanceVersions(attendances);
  const closingByEmployee = new Map(
    employeeWorkDayClosings.map((closing) => [closing.employeeUserId, closing]),
  );

  return Array.from(attendanceVersionsByEmployee.entries())
    .filter(([employeeUserId, attendanceVersions]) => {
      const closing = closingByEmployee.get(employeeUserId);
      return closing !== undefined && isEmployeeWorkDayClosingCurrent(closing, attendanceVersions);
    })
    .map(([employeeUserId]) => employeeUserId);
};

export const summarizeResponsibleEmployeeClosing = (
  attendances: ShopAttendanceType[],
  employeeWorkDayClosings?: ShopEmployeeWorkDayClosingType[],
) => {
  if (employeeWorkDayClosings === undefined) {
    const responsibleStatus = new Map<string, { total: number; closed: number }>();

    attendances.filter(isSettlementAttendance).forEach((attendance) => {
      const responsibleUserId = getResponsibleEmployeeUserId(attendance);

      if (!responsibleUserId) {
        return;
      }

      const entry = responsibleStatus.get(responsibleUserId) ?? { total: 0, closed: 0 };
      entry.total += 1;
      entry.closed += attendance.status === "closed" ? 1 : 0;
      responsibleStatus.set(responsibleUserId, entry);
    });

    return Array.from(responsibleStatus.values()).reduce(
      (summary, entry) => ({
        responsibleTotal: summary.responsibleTotal + 1,
        responsibleClosed:
          summary.responsibleClosed + (entry.total > 0 && entry.closed === entry.total ? 1 : 0),
      }),
      { responsibleTotal: 0, responsibleClosed: 0 },
    );
  }

  const responsibleEmployeeUserIds = getResponsibleEmployeeUserIds(attendances);
  const submittedEmployeeUserIds = getSubmittedEmployeeUserIds(
    attendances,
    employeeWorkDayClosings,
  );

  return {
    responsibleTotal: responsibleEmployeeUserIds.length,
    responsibleClosed: submittedEmployeeUserIds.length,
  };
};

export const getResponsibleEmployeeUserIds = (attendances: ShopAttendanceType[]): string[] =>
  Array.from(getResponsibleEmployeeAttendanceVersions(attendances).keys());

export const getPendingResponsibleEmployeeUserIds = (
  attendances: ShopAttendanceType[],
  employeeWorkDayClosings: ShopEmployeeWorkDayClosingType[],
): string[] => {
  const responsibleEmployeeUserIds = getResponsibleEmployeeUserIds(attendances);
  const submittedEmployeeUserIds = new Set(
    getSubmittedEmployeeUserIds(attendances, employeeWorkDayClosings),
  );

  return responsibleEmployeeUserIds.filter(
    (employeeUserId) => !submittedEmployeeUserIds.has(employeeUserId),
  );
};

export const getSubmittedEmployeeUserIds = (
  attendances: ShopAttendanceType[],
  employeeWorkDayClosings: ShopEmployeeWorkDayClosingType[],
): string[] => getSubmittedEmployeeUserIdsFromClosings(attendances, employeeWorkDayClosings);

export const isWorkDayClosingEffective = (
  closing: { id: string } | null | undefined,
  employeeCount: { total: number; closed: number },
): boolean =>
  closing !== null &&
  closing !== undefined &&
  (employeeCount.total === 0 || employeeCount.closed === employeeCount.total);

export const getIncompleteAttendanceIds = (attendances: ShopAttendanceType[]) =>
  attendances
    .filter(isSettlementAttendance)
    .filter((attendance) =>
      getAttendanceServices(attendance).some((service) => {
        const totalPercentageUnits = service.employees.reduce(
          (sum, employee) => sum + toPercentUnits(employee.percentage ?? 0),
          0,
        );

        return service.employees.length === 0 || totalPercentageUnits !== FULL_PERCENT_UNITS;
      }),
    )
    .map((attendance) => attendance.id);

export const buildWorkDayServiceSummaries = (
  attendances: ShopAttendanceType[],
): ShopWorkDayServiceSummaryType[] => {
  const serviceMap = new Map<
    string,
    {
      serviceName: string;
      category: string;
      count: number;
      totalRevenueMinor: number;
    }
  >();

  attendances.filter(isSettlementAttendance).forEach((attendance) => {
    getAttendanceServices(attendance).forEach((service) => {
      if (service.type !== "predefined") {
        return;
      }

      const existing = serviceMap.get(service.id) ?? {
        serviceName: service.name,
        category: service.category ?? "other",
        count: 0,
        totalRevenueMinor: 0,
      };

      existing.count += 1;
      existing.totalRevenueMinor += toMoneyMinorUnit(service.price);
      serviceMap.set(service.id, existing);
    });
  });

  return Array.from(serviceMap.entries())
    .map(([serviceId, service]) => {
      const averagePriceMinor =
        service.count > 0 ? Math.round(service.totalRevenueMinor / service.count) : 0;

      return {
        serviceId,
        serviceName: service.serviceName,
        category: service.category,
        count: service.count,
        totalRevenue: fromMoneyMinorUnit(service.totalRevenueMinor),
        totalRevenueMinor: service.totalRevenueMinor,
        averagePrice: fromMoneyMinorUnit(averagePriceMinor),
        averagePriceMinor,
      };
    })
    .sort((left, right) => right.totalRevenue - left.totalRevenue);
};

type WorkInterval = {
  startTime: number;
  endTime: number;
};

const getUniqueWorkedMinutes = (intervals: WorkInterval[]): number => {
  const sortedIntervals = intervals
    .map(({ startTime, endTime }) => ({
      startTime,
      endTime: Math.max(endTime, startTime + 1),
    }))
    .sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime);
  const firstInterval = sortedIntervals[0];

  if (!firstInterval) {
    return 0;
  }

  let totalMinutes = 0;
  let currentStart = firstInterval.startTime;
  let currentEnd = firstInterval.endTime;

  sortedIntervals.slice(1).forEach((interval) => {
    if (interval.startTime <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.endTime);
      return;
    }

    totalMinutes += currentEnd - currentStart;
    currentStart = interval.startTime;
    currentEnd = interval.endTime;
  });

  return totalMinutes + currentEnd - currentStart;
};

const createEmployeeSummaryMap = (
  attendances: ShopAttendanceType[],
  options: {
    employeeConfigs?: EmployeeCompensationConfig[] | undefined;
  },
) => {
  const employeeSummaryMap = new Map<string, ShopWorkDayEmployeeSummaryType>();
  const employeeWorkIntervals = new Map<string, WorkInterval[]>();
  const employeeConfigMap = new Map(
    (options.employeeConfigs ?? []).map((employeeConfig) => [employeeConfig.uid, employeeConfig]),
  );

  attendances.forEach((attendance) => {
    const processedEmployeeIds = new Set<string>();

    getAttendanceServices(attendance).forEach((service) => {
      service.employees.forEach((employee) => {
        const employeeConfig = employeeConfigMap.get(employee.employeeUserId);
        const compensationModel = resolveCompensationModel(employeeConfig);
        const existingSummary = employeeSummaryMap.get(employee.employeeUserId);

        if (existingSummary) {
          existingSummary.totalRevenue = addMoney(
            existingSummary.totalRevenue,
            employee.shareAmount ?? 0,
          );
          if (
            existingSummary.compensationModel === "commission" &&
            existingSummary.ownerCommissionRate === undefined
          ) {
            existingSummary.ownerCommissionRate = resolveOwnerCommissionRate(employeeConfig);
          }
          existingSummary.employeeName =
            employeeConfig?.name ??
            existingSummary.employeeName ??
            employee.employeeName ??
            employee.employeeUserId;
          if (!processedEmployeeIds.has(employee.employeeUserId)) {
            const intervals = employeeWorkIntervals.get(employee.employeeUserId) ?? [];
            intervals.push({ startTime: attendance.startTime, endTime: attendance.endTime });
            employeeWorkIntervals.set(employee.employeeUserId, intervals);
            processedEmployeeIds.add(employee.employeeUserId);
          }
          return;
        }

        employeeSummaryMap.set(employee.employeeUserId, {
          employeeUserId: employee.employeeUserId,
          employeeName: employeeConfig?.name ?? employee.employeeName ?? employee.employeeUserId,
          totalRevenue: fromMoneyMinorUnit(toMoneyMinorUnit(employee.shareAmount ?? 0)),
          discountAllocated: 0,
          ownerDiscountSupported: 0,
          revenueAfterDiscount: 0,
          ownerCommission: 0,
          employeeEarning: 0,
          compensationModel,
          ...(compensationModel === "commission" && {
            ownerCommissionRate: resolveOwnerCommissionRate(employeeConfig),
          }),
          ...(employeeConfig?.hourlyRate !== undefined && {
            hourlyRate: employeeConfig.hourlyRate,
          }),
          ...(employeeConfig?.fixedSalary !== undefined && {
            fixedSalary: employeeConfig.fixedSalary,
          }),
          workedMinutes: 0,
          isSelectedForDiscount: false,
        });
        employeeWorkIntervals.set(employee.employeeUserId, [
          { startTime: attendance.startTime, endTime: attendance.endTime },
        ]);
        processedEmployeeIds.add(employee.employeeUserId);
      });
    });
  });

  employeeSummaryMap.forEach((summary, employeeUserId) => {
    summary.workedMinutes = getUniqueWorkedMinutes(employeeWorkIntervals.get(employeeUserId) ?? []);
  });

  return employeeSummaryMap;
};

const getDiscountParts = (
  discountAmount: number,
  ownerSharePercent: ShopDiscountOwnerCoverageRateType,
) => {
  const discountMinor = toMoneyMinorUnit(discountAmount);
  const employeeDiscountMinor = Math.round((discountMinor * (100 - ownerSharePercent)) / 100);
  const ownerDiscountMinor = Math.max(0, discountMinor - employeeDiscountMinor);

  return {
    employeeDiscount: fromMoneyMinorUnit(employeeDiscountMinor),
    ownerDiscount: fromMoneyMinorUnit(ownerDiscountMinor),
  };
};

const allocateRevenueShareDiscount = (
  employeeMap: Map<string, ShopWorkDayEmployeeSummaryType>,
  totalRevenue: number,
  totalDiscount: number,
  ownerDiscountCoverageRate: ShopDiscountOwnerCoverageRateType,
): WorkDayDiscountAllocationResult => {
  const { employeeDiscount, ownerDiscount } = getDiscountParts(
    totalDiscount,
    ownerDiscountCoverageRate,
  );

  if (employeeDiscount <= 0) {
    return {
      employeeAmount: 0,
      ownerAmount: ownerDiscount,
      unallocatedAmount: 0,
      targetEmployeeUserIds: [],
      discountEligibleEmployeeUserIds: [],
    };
  }

  const employeeSummaries = Array.from(employeeMap.values()).filter(
    (employeeSummary) => toMoneyMinorUnit(employeeSummary.totalRevenue) > 0,
  );
  const totalRevenueMinor = toMoneyMinorUnit(totalRevenue);

  if (totalRevenueMinor <= 0 || employeeSummaries.length === 0) {
    return {
      employeeAmount: 0,
      ownerAmount: ownerDiscount,
      unallocatedAmount: employeeDiscount,
      targetEmployeeUserIds: [],
      discountEligibleEmployeeUserIds: [],
      allocationError: "invalid_revenue_share_basis",
    };
  }

  const allocations = allocateMoneyMinorUnits(
    toMoneyMinorUnit(employeeDiscount),
    employeeSummaries.map((employeeSummary) => toMoneyMinorUnit(employeeSummary.totalRevenue)),
  );
  let employeeDiscountAllocatedMinor = 0;
  let ownerSupportedDiscountMinor = 0;
  const targetEmployeeUserIds = new Set<string>();
  const discountEligibleEmployeeUserIds = new Set<string>();

  employeeSummaries.forEach((employeeSummary, index) => {
    const allocationMinor = allocations[index] ?? 0;
    const allocation = fromMoneyMinorUnit(allocationMinor);

    if (allocationMinor <= 0) {
      return;
    }

    targetEmployeeUserIds.add(employeeSummary.employeeUserId);

    if (isNonCommissionEmployee(employeeSummary)) {
      employeeSummary.ownerDiscountSupported = addMoney(
        employeeSummary.ownerDiscountSupported,
        allocation,
      );
      ownerSupportedDiscountMinor += allocationMinor;
      return;
    }

    employeeSummary.discountAllocated = addMoney(employeeSummary.discountAllocated, allocation);
    employeeSummary.isSelectedForDiscount = true;
    employeeDiscountAllocatedMinor += allocationMinor;
    discountEligibleEmployeeUserIds.add(employeeSummary.employeeUserId);
  });

  const totalAllocatedMinor = employeeDiscountAllocatedMinor + ownerSupportedDiscountMinor;

  return {
    employeeAmount: fromMoneyMinorUnit(employeeDiscountAllocatedMinor),
    ownerAmount: addMoney(ownerDiscount, fromMoneyMinorUnit(ownerSupportedDiscountMinor)),
    unallocatedAmount: fromMoneyMinorUnit(toMoneyMinorUnit(employeeDiscount) - totalAllocatedMinor),
    targetEmployeeUserIds: Array.from(targetEmployeeUserIds),
    discountEligibleEmployeeUserIds: Array.from(discountEligibleEmployeeUserIds),
  };
};

const finalizeEmployeeSummaries = (
  employeeSummaryMap: Map<string, ShopWorkDayEmployeeSummaryType>,
) =>
  Array.from(employeeSummaryMap.values())
    .map((employeeSummary) => {
      const totalRevenueMinor = toMoneyMinorUnit(employeeSummary.totalRevenue);
      const discountAllocatedMinor = toMoneyMinorUnit(employeeSummary.discountAllocated);
      const revenueAfterDiscountMinor = totalRevenueMinor - discountAllocatedMinor;
      const revenueAfterDiscount = fromMoneyMinorUnit(revenueAfterDiscountMinor);
      const isNonCommission = isNonCommissionEmployee(employeeSummary);
      const ownerCommissionRate =
        employeeSummary.ownerCommissionRate ?? DEFAULT_OWNER_COMMISSION_RATE;
      // Ăn chia TRÊN doanh thu gốc R, RỒI mới trừ phần giảm giá thợ gánh (D):
      //   ownerCommission = R × rate;  employeeEarning = R − ownerCommission − D = R×(1−rate) − D.
      // (Trước đây trừ D trước khi chia → (R−D)×(1−rate), khiến chủ gánh nhiều hơn mức đã chọn.)
      const ownerCommissionMinor = isNonCommission
        ? totalRevenueMinor
        : Math.round((totalRevenueMinor * ownerCommissionRate) / 100);

      return {
        ...employeeSummary,
        ...(isNonCommission ? {} : { ownerCommissionRate }),
        revenueAfterDiscount,
        ownerCommission: fromMoneyMinorUnit(ownerCommissionMinor),
        employeeEarning: isNonCommission
          ? 0
          : fromMoneyMinorUnit(totalRevenueMinor - ownerCommissionMinor - discountAllocatedMinor),
      };
    })
    .sort((left, right) => left.employeeName.localeCompare(right.employeeName, "vi-VN"));

export type CompensationConfigurationError = {
  employeeUserId: string;
  reason:
    | "hourly_rate_missing"
    | "fixed_salary_missing"
    | "owner_commission_rate_missing"
    | "compensation_model_missing"
    | "employee_missing";
};

export const buildWorkDaySettlementPreview = (
  attendances: ShopAttendanceType[],
  options: {
    ownerDiscountCoverageRate: ShopDiscountOwnerCoverageRateType;
    employeeConfigs?: EmployeeCompensationConfig[];
    employeeWorkDayClosings?: ShopEmployeeWorkDayClosingType[];
  },
) => {
  const revenueAttendances = attendances.filter(isSettlementAttendance);
  const employeeSummaryMap = createEmployeeSummaryMap(revenueAttendances, {
    employeeConfigs: options.employeeConfigs,
  });
  const employeeConfigMap = new Map(
    (options.employeeConfigs ?? []).map((employeeConfig) => [employeeConfig.uid, employeeConfig]),
  );
  const compensationConfigurationErrors: CompensationConfigurationError[] = Array.from(
    employeeSummaryMap.keys(),
  ).flatMap<CompensationConfigurationError>((employeeUserId) => {
    const employeeConfig = employeeConfigMap.get(employeeUserId);

    if (employeeConfig?.compensationModel === "hourly") {
      return employeeConfig.hourlyRate === undefined
        ? [{ employeeUserId, reason: "hourly_rate_missing" as const }]
        : [];
    }

    if (employeeConfig?.compensationModel === "fixed") {
      return employeeConfig.fixedSalary === undefined
        ? [{ employeeUserId, reason: "fixed_salary_missing" as const }]
        : [];
    }

    if (employeeConfig?.compensationModel === "commission") {
      return employeeConfig.ownerCommissionRate === undefined
        ? [{ employeeUserId, reason: "owner_commission_rate_missing" as const }]
        : [];
    }

    return [
      {
        employeeUserId,
        reason: employeeConfig
          ? ("compensation_model_missing" as const)
          : ("employee_missing" as const),
      },
    ];
  });

  const totalDiscount = sumMoney(
    revenueAttendances.map((attendance) => getAttendanceDiscountAmount(attendance)),
  );
  const totalRevenue = sumMoney(
    revenueAttendances.map((attendance) => getAttendanceRevenueTotal(attendance)),
  );
  const discountAllocation = allocateRevenueShareDiscount(
    employeeSummaryMap,
    totalRevenue,
    totalDiscount,
    options.ownerDiscountCoverageRate,
  );

  const finalizedEmployeeSummaries = finalizeEmployeeSummaries(employeeSummaryMap);
  const totalOwnerCommission = sumMoney(
    finalizedEmployeeSummaries.map((employeeSummary) => employeeSummary.ownerCommission),
  );
  const totalEmployeeEarning = sumMoney(
    finalizedEmployeeSummaries.map((employeeSummary) => employeeSummary.employeeEarning),
  );
  const totalOwnerDiscount = fromMoneyMinorUnit(toMoneyMinorUnit(discountAllocation.ownerAmount));
  const totalEmployeeDiscount = fromMoneyMinorUnit(
    toMoneyMinorUnit(discountAllocation.employeeAmount),
  );
  const totalUnallocatedDiscount = fromMoneyMinorUnit(
    toMoneyMinorUnit(discountAllocation.unallocatedAmount),
  );

  return {
    employeeSummaries: finalizedEmployeeSummaries,
    compensationConfigurationErrors,
    totalRevenue,
    totalDiscount,
    totalEmployeeDiscount,
    totalOwnerDiscount,
    totalOwnerDiscountAbsorbed: totalOwnerDiscount,
    totalEmployeeDiscountAllocated: totalEmployeeDiscount,
    totalUnallocatedDiscount,
    totalNetAmount: subtractMoney(totalRevenue, totalDiscount),
    totalOwnerCommission,
    totalOwnerNetAfterDiscount: subtractMoney(totalOwnerCommission, totalOwnerDiscount),
    totalEmployeeEarning,
    allocationSource: "workday",
    discountAllocationError: discountAllocation.allocationError,
    discountTargetEmployeeUserIds: discountAllocation.targetEmployeeUserIds,
    discountEligibleEmployeeUserIds: discountAllocation.discountEligibleEmployeeUserIds,
    submittedEmployeeUserIds: getSubmittedEmployeeUserIds(
      revenueAttendances,
      options.employeeWorkDayClosings ?? [],
    ),
    incompleteAttendanceIds: getIncompleteAttendanceIds(revenueAttendances),
  };
};
