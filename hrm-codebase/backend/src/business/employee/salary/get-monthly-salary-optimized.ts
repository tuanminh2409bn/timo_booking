import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import {
  addMoney,
  divideMoney,
  fromMoneyMinorUnit,
  roundMoney,
  subtractMoney,
  sumMoney,
  toMoneyMinorUnit,
} from "../../../helpers/money.js";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { getMonthWorkDateRange } from "../../../helpers/work-date-utils.js";
import { getMonthlySalaryResponseCacheKey } from "../../../helpers/cache-keys.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import {
  cacheGetJson,
  cacheSetJson,
  runSingleFlight,
} from "../../../repository/cache/cache-client.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { toPublicStoreId } from "../../shop/stores/store-response.js";

const COMPLETED_MONTH_CACHE_TTL_MS = 10 * 60 * 1000;
const CURRENT_MONTH_CACHE_TTL_MS = 60_000;

const MONTHLY_SALARY_SERVICE_ERRORS = {
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/salaries/monthly/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/salaries/monthly/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/salaries/monthly/invalid-request",
    message: "year and month must be valid calendar values",
  },
};

type MonthlySalaryEmployeeResponseItem = {
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

const buildMonthlySalaryResponsePayloadOptimized = async (
  ownerId: string,
  storeId: string,
  year: number,
  month: number,
) => {
  const currentRange = getMonthWorkDateRange(year, month);
  let previousYear = year;
  let previousMonth = month - 1;

  if (previousMonth === 0) {
    previousYear -= 1;
    previousMonth = 12;
  }

  const previousRange = getMonthWorkDateRange(previousYear, previousMonth);
  const [currentClosedSettlements, previousClosedSettlements, storeEmployees, store] =
    await Promise.all([
      firestoreRepository.shop.settlement.listClosedWorkDaySettlementFinancialProjectionByStoreDateRange(
        ownerId,
        storeId,
        currentRange.fromWorkDate,
        currentRange.toWorkDate,
      ),
      firestoreRepository.shop.settlement.listClosedWorkDaySettlementFinancialProjectionByStoreDateRange(
        ownerId,
        storeId,
        previousRange.fromWorkDate,
        previousRange.toWorkDate,
      ),
      firestoreRepository.user.listShopEmployees(ownerId, { storeId }),
      firestoreRepository.shop.store.getStore(ownerId, storeId),
    ]);
  const employeeProfilesByUserId = new Map(
    storeEmployees.map((storeEmployee) => [storeEmployee.uid, storeEmployee]),
  );
  const salaryEmployeesByUserId = new Map<string, MonthlySalaryEmployeeResponseItem>();

  for (const storeEmployee of storeEmployees) {
    let employeeDisplayName = "Nhan vien";
    const configuredEmployeeName = storeEmployee.name?.trim();
    const configuredEmployeeDisplayName = storeEmployee.displayName?.trim();

    if (configuredEmployeeName && configuredEmployeeName !== storeEmployee.uid) {
      employeeDisplayName = configuredEmployeeName;
    } else if (
      configuredEmployeeDisplayName &&
      configuredEmployeeDisplayName !== storeEmployee.uid
    ) {
      employeeDisplayName = configuredEmployeeDisplayName;
    }

    let employeeCompensationModel = storeEmployee.compensationModel;

    if (employeeCompensationModel === undefined) {
      employeeCompensationModel = storeEmployee.hourlyRate !== undefined ? "hourly" : "commission";
    }

    salaryEmployeesByUserId.set(storeEmployee.uid, {
      employeeUserId: storeEmployee.uid,
      name: employeeDisplayName,
      ...(storeEmployee.position !== undefined && { position: storeEmployee.position }),
      compensationModel: employeeCompensationModel,
      ...(storeEmployee.fixedSalary !== undefined && { fixedSalary: storeEmployee.fixedSalary }),
      ...(storeEmployee.hourlyRate !== undefined && { hourlyRate: storeEmployee.hourlyRate }),
      totalRevenue: 0,
      discountAllocated: 0,
      ownerCommission: 0,
      commissionEarning: 0,
      fixedEarning:
        employeeCompensationModel === "fixed" ? (storeEmployee.fixedSalary ?? 0) : 0,
      hourlyEarning: 0,
      totalSalary:
        employeeCompensationModel === "fixed" ? (storeEmployee.fixedSalary ?? 0) : 0,
      workedMinutes: 0,
      closedDayCount: 0,
    });
  }

  for (const closedSettlement of currentClosedSettlements) {
    for (const employeeSummary of closedSettlement.preview.employeeSummaries) {
      const employeeProfile = employeeProfilesByUserId.get(employeeSummary.employeeUserId);
      let salaryEmployee = salaryEmployeesByUserId.get(employeeSummary.employeeUserId);

      if (salaryEmployee === undefined) {
        let employeeDisplayName = "Nhan vien";
        const configuredEmployeeName = employeeProfile?.name?.trim();
        const configuredEmployeeDisplayName = employeeProfile?.displayName?.trim();
        const settlementEmployeeName = employeeSummary.employeeName.trim();

        if (configuredEmployeeName && configuredEmployeeName !== employeeSummary.employeeUserId) {
          employeeDisplayName = configuredEmployeeName;
        } else if (
          configuredEmployeeDisplayName &&
          configuredEmployeeDisplayName !== employeeSummary.employeeUserId
        ) {
          employeeDisplayName = configuredEmployeeDisplayName;
        } else if (settlementEmployeeName !== employeeSummary.employeeUserId) {
          employeeDisplayName = settlementEmployeeName;
        }

        salaryEmployee = {
          employeeUserId: employeeSummary.employeeUserId,
          name: employeeDisplayName,
          ...(employeeProfile?.position !== undefined && { position: employeeProfile.position }),
          compensationModel: employeeSummary.compensationModel,
          ...(employeeSummary.fixedSalary !== undefined && {
            fixedSalary: employeeSummary.fixedSalary,
          }),
          totalRevenue: 0,
          discountAllocated: 0,
          ownerCommission: 0,
          commissionEarning: 0,
          fixedEarning:
            employeeSummary.compensationModel === "fixed"
              ? (employeeSummary.fixedSalary ?? employeeProfile?.fixedSalary ?? 0)
              : 0,
          hourlyEarning: 0,
          totalSalary:
            employeeSummary.compensationModel === "fixed"
              ? (employeeSummary.fixedSalary ?? employeeProfile?.fixedSalary ?? 0)
              : 0,
          workedMinutes: 0,
          closedDayCount: 0,
        };
      }

      const employeeHourlyRate = employeeSummary.hourlyRate ?? employeeProfile?.hourlyRate;
      let employeeCommissionEarning = 0;
      let employeeHourlyEarning = 0;

      if (employeeSummary.compensationModel === "hourly") {
        if (employeeHourlyRate !== undefined) {
          employeeHourlyEarning = fromMoneyMinorUnit(
            Math.round(
              (toMoneyMinorUnit(employeeHourlyRate) * employeeSummary.workedMinutes) / 60,
            ),
          );
        }
      } else if (employeeSummary.compensationModel === "commission") {
        employeeCommissionEarning = employeeSummary.employeeEarning;
      }

      salaryEmployee.compensationModel = employeeSummary.compensationModel;
      salaryEmployee.totalRevenue = addMoney(
        salaryEmployee.totalRevenue,
        employeeSummary.totalRevenue,
      );
      salaryEmployee.discountAllocated = addMoney(
        salaryEmployee.discountAllocated,
        employeeSummary.discountAllocated,
      );
      salaryEmployee.ownerCommission = addMoney(
        salaryEmployee.ownerCommission,
        employeeSummary.ownerCommission,
      );
      salaryEmployee.commissionEarning = addMoney(
        salaryEmployee.commissionEarning,
        employeeCommissionEarning,
      );
      salaryEmployee.hourlyEarning = addMoney(
        salaryEmployee.hourlyEarning,
        employeeHourlyEarning,
      );
      salaryEmployee.totalSalary = addMoney(
        addMoney(salaryEmployee.commissionEarning, salaryEmployee.fixedEarning),
        salaryEmployee.hourlyEarning,
      );
      salaryEmployee.workedMinutes += employeeSummary.workedMinutes;
      salaryEmployee.closedDayCount += 1;

      if (
        salaryEmployee.lastClosedWorkDate === undefined ||
        salaryEmployee.lastClosedWorkDate < closedSettlement.workDate
      ) {
        salaryEmployee.lastClosedWorkDate = closedSettlement.workDate;
      }

      if (employeeHourlyRate !== undefined) {
        salaryEmployee.hourlyRate = employeeHourlyRate;
      }

      const employeeFixedSalary = employeeSummary.fixedSalary ?? employeeProfile?.fixedSalary;
      if (employeeFixedSalary !== undefined) {
        salaryEmployee.fixedSalary = employeeFixedSalary;
        salaryEmployee.fixedEarning =
          employeeSummary.compensationModel === "fixed" ? employeeFixedSalary : 0;
        salaryEmployee.totalSalary = addMoney(
          addMoney(salaryEmployee.commissionEarning, salaryEmployee.fixedEarning),
          salaryEmployee.hourlyEarning,
        );
      }

      salaryEmployeesByUserId.set(employeeSummary.employeeUserId, salaryEmployee);
    }
  }

  const previousFixedEmployeeIds = new Set<string>();
  let previousTotalSalary = sumMoney(
    storeEmployees.map((employee) => {
      if (employee.compensationModel !== "fixed") {
        return 0;
      }

      previousFixedEmployeeIds.add(employee.uid);
      return employee.fixedSalary ?? 0;
    }),
  );

  for (const closedSettlement of previousClosedSettlements) {
    for (const employeeSummary of closedSettlement.preview.employeeSummaries) {
      if (employeeSummary.compensationModel === "commission") {
        previousTotalSalary = addMoney(previousTotalSalary, employeeSummary.employeeEarning);
        continue;
      }

      if (employeeSummary.compensationModel === "fixed") {
        if (!previousFixedEmployeeIds.has(employeeSummary.employeeUserId)) {
          previousFixedEmployeeIds.add(employeeSummary.employeeUserId);
          previousTotalSalary = addMoney(
            previousTotalSalary,
            employeeSummary.fixedSalary ??
              employeeProfilesByUserId.get(employeeSummary.employeeUserId)?.fixedSalary ??
              0,
          );
        }
        continue;
      }

      const employeeHourlyRate =
        employeeSummary.hourlyRate ??
        employeeProfilesByUserId.get(employeeSummary.employeeUserId)?.hourlyRate;

      if (employeeHourlyRate !== undefined) {
        previousTotalSalary = addMoney(
          previousTotalSalary,
          fromMoneyMinorUnit(
            Math.round(
              (toMoneyMinorUnit(employeeHourlyRate) * employeeSummary.workedMinutes) / 60,
            ),
          ),
        );
      }
    }
  }

  const employees = Array.from(salaryEmployeesByUserId.values()).sort((left, right) =>
    left.name.localeCompare(right.name, "vi-VN"),
  );
  const totalSalary = sumMoney(employees.map((employee) => employee.totalSalary));
  const totalEmployees = employees.length;
  let salaryGrowthPercent = 0;

  if (previousTotalSalary > 0) {
    salaryGrowthPercent = roundMoney(
      (subtractMoney(totalSalary, previousTotalSalary) / previousTotalSalary) * 100,
    );
  } else if (totalSalary > 0) {
    salaryGrowthPercent = 100;
  }

  return {
    period: {
      mode: "month",
      year,
      month,
      ...currentRange,
    },
    store: {
      id: store.id,
      storeId: toPublicStoreId(store.id),
      name: store.name,
    },
    employees,
    summary: {
      totalSalary,
      totalCommissionEarning: sumMoney(
        employees.map((employee) => employee.commissionEarning),
      ),
      totalFixedEarning: sumMoney(employees.map((employee) => employee.fixedEarning)),
      totalHourlyEarning: sumMoney(employees.map((employee) => employee.hourlyEarning)),
      totalRevenue: sumMoney(employees.map((employee) => employee.totalRevenue)),
      totalDiscount: sumMoney(employees.map((employee) => employee.discountAllocated)),
      totalOwnerCommission: sumMoney(employees.map((employee) => employee.ownerCommission)),
      totalEmployees,
      paidEmployeeCount: 0,
      closedDayCount: currentClosedSettlements.length,
      averageSalary: divideMoney(totalSalary, totalEmployees),
      previousTotalSalary,
      salaryGrowthPercent,
    },
    meta: {
      source: "closed_work_day",
      currency: "EUR",
      generatedAt: Date.now(),
      realTimeClosingsUsed: currentClosedSettlements.length,
    },
  };
};

export const getMonthlySalaryOptimized = async (request: Request, response: Response) => {
  const authContext = await verifyAuthorizationHeader(request.headers["authorization"]);

  if (!can(authContext.role, "salary:view")) {
    return createErrorResponse(response, MONTHLY_SALARY_SERVICE_ERRORS.forbiddenRole, {
      role: authContext.role,
    });
  }

  const requestedStoreId = getStoreIdFromUrlPath(request)?.trim();
  const queryParseResult = z
    .object({
      year: z.coerce.number().int().min(2000).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    })
    .safeParse(request.query);

  if (!requestedStoreId || !queryParseResult.success) {
    return createErrorResponse(response, MONTHLY_SALARY_SERVICE_ERRORS.invalidRequest, {
      requestedStoreId,
      ...(!queryParseResult.success && {
        validation: queryParseResult.error.flatten().fieldErrors,
      }),
    });
  }

  const { year, month } = queryParseResult.data;

  if (!canAccessStore(authContext, requestedStoreId)) {
    return createErrorResponse(response, MONTHLY_SALARY_SERVICE_ERRORS.forbiddenStore, {
      requestedStoreId,
      role: authContext.role,
    });
  }

  const responseCacheKey = getMonthlySalaryResponseCacheKey(authContext.ownerId, {
    storeId: requestedStoreId,
    year,
    month,
  });
  const cachedResponse = await cacheGetJson<unknown>(responseCacheKey);

  if (cachedResponse !== undefined) {
    return sendCacheableJson(request, response, cachedResponse, {
      cacheControl: "private, max-age=30, stale-while-revalidate=60",
    });
  }

  const responsePayload = await runSingleFlight(responseCacheKey, async () => {
    const cachedAfterWait = await cacheGetJson<unknown>(responseCacheKey);

    if (cachedAfterWait !== undefined) {
      return cachedAfterWait;
    }

    const payload = await buildMonthlySalaryResponsePayloadOptimized(
      authContext.ownerId,
      requestedStoreId,
      year,
      month,
    );
    const currentDate = new Date();
    const isCurrentMonth =
      currentDate.getUTCFullYear() === year && currentDate.getUTCMonth() + 1 === month;
    const cacheTtl = isCurrentMonth
      ? CURRENT_MONTH_CACHE_TTL_MS
      : COMPLETED_MONTH_CACHE_TTL_MS;

    await cacheSetJson(responseCacheKey, payload, cacheTtl);
    return payload;
  });

  return sendCacheableJson(request, response, responsePayload, {
    cacheControl: "private, max-age=30, stale-while-revalidate=60",
  });
};
