import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { getWeeklySalaryResponseCacheKey } from "../../../helpers/cache-keys.js";
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
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import {
  cacheGetJson,
  cacheSetJson,
  runSingleFlight,
} from "../../../repository/cache/cache-client.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import type { ShopEmployeeListItem } from "../../../repository/firestore/user/user-factory.js";
import { toPublicStoreId } from "../../shop/stores/store-response.js";

const CURRENT_WEEK_CACHE_TTL_MS = 60_000;
const COMPLETED_WEEK_CACHE_TTL_MS = 10 * 60 * 1000;

const WEEKLY_SALARY_SERVICE_ERRORS = {
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/salaries/weekly/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/salaries/weekly/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/salaries/weekly/invalid-request",
    message: "weekStart must be a Monday-aligned ISO date",
  },
};

type WeeklySalaryEmployeeResponseItem = {
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

const getFixedSalaryForWeek = (monthlySalary: number | undefined, weekStartDate: Date): number => {
  if (monthlySalary === undefined) {
    return 0;
  }

  let total = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(weekStartDate);
    date.setUTCDate(date.getUTCDate() + offset);
    const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    total += monthlySalary / daysInMonth;
  }

  return Math.round(total * 100) / 100;
};

export const getWeeklySalary = async (request: Request, response: Response) => {
  const authContext = await verifyAuthorizationHeader(request.headers["authorization"]);

  if (!can(authContext.role, "salary:view")) {
    return createErrorResponse(response, WEEKLY_SALARY_SERVICE_ERRORS.forbiddenRole, {
      role: authContext.role,
    });
  }

  const requestedStoreId = getStoreIdFromUrlPath(request)?.trim();
  const queryParseResult = z
    .object({
      weekStart: z.string().refine(isValidWorkDate),
    })
    .safeParse(request.query);

  if (!requestedStoreId || !queryParseResult.success) {
    return createErrorResponse(response, WEEKLY_SALARY_SERVICE_ERRORS.invalidRequest, {
      requestedStoreId,
      ...(!queryParseResult.success && {
        validation: queryParseResult.error.flatten().fieldErrors,
      }),
    });
  }

  const { weekStart } = queryParseResult.data;
  const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
  if (weekStartDate.getUTCDay() !== 1) {
    return createErrorResponse(response, WEEKLY_SALARY_SERVICE_ERRORS.invalidRequest, {
      requestedStoreId,
      weekStart,
    });
  }

  if (!canAccessStore(authContext, requestedStoreId)) {
    return createErrorResponse(response, WEEKLY_SALARY_SERVICE_ERRORS.forbiddenStore, {
      requestedStoreId,
      role: authContext.role,
    });
  }

  const responseCacheKey = getWeeklySalaryResponseCacheKey(authContext.ownerId, {
    storeId: requestedStoreId,
    weekStart,
  });
  const cachedResponse = await cacheGetJson<unknown>(responseCacheKey);

  if (cachedResponse !== undefined) {
    return sendCacheableJson(request, response, cachedResponse, {
      cacheControl: "private, max-age=30, stale-while-revalidate=60",
    });
  }

  const responsePayload = await runSingleFlight(responseCacheKey, async () => {
    const cachedResponseAfterWait = await cacheGetJson<unknown>(responseCacheKey);
    if (cachedResponseAfterWait !== undefined) {
      return cachedResponseAfterWait;
    }

    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
    const weekEnd = weekEndDate.toISOString().slice(0, 10);
    const previousWeekStartDate = new Date(weekStartDate);
    previousWeekStartDate.setUTCDate(previousWeekStartDate.getUTCDate() - 7);
    const previousWeekStart = previousWeekStartDate.toISOString().slice(0, 10);
    const previousWeekEndDate = new Date(previousWeekStartDate);
    previousWeekEndDate.setUTCDate(previousWeekEndDate.getUTCDate() + 6);
    const previousWeekEnd = previousWeekEndDate.toISOString().slice(0, 10);

    const [currentSettlements, previousSettlements, storeEmployees, store] = await Promise.all([
      firestoreRepository.shop.settlement.listClosedWorkDaySettlementFinancialProjectionByStoreDateRange(
        authContext.ownerId,
        requestedStoreId,
        weekStart,
        weekEnd,
      ),
      firestoreRepository.shop.settlement.listClosedWorkDaySettlementFinancialProjectionByStoreDateRange(
        authContext.ownerId,
        requestedStoreId,
        previousWeekStart,
        previousWeekEnd,
      ),
      firestoreRepository.user.listShopEmployees(authContext.ownerId, {
        storeId: requestedStoreId,
      }),
      firestoreRepository.shop.store.getStore(authContext.ownerId, requestedStoreId),
    ]);

    const employeeLookup = new Map<string, ShopEmployeeListItem>();
    for (const employee of storeEmployees) {
      employeeLookup.set(employee.uid, employee);
    }

    const employeeMap = new Map<string, WeeklySalaryEmployeeResponseItem>();
    for (const employee of storeEmployees) {
      let compensationModel = employee.compensationModel;
      if (compensationModel === undefined) {
        compensationModel = employee.hourlyRate === undefined ? "commission" : "hourly";
      }

      let employeeName = employee.name?.trim();
      if (!employeeName || employeeName === employee.uid) {
        employeeName = employee.displayName?.trim();
      }
      if (!employeeName || employeeName === employee.uid) {
        employeeName = employee.email;
      }
      if (!employeeName || employeeName === employee.uid) {
        employeeName = "Employee";
      }

      employeeMap.set(employee.uid, {
        employeeUserId: employee.uid,
        name: employeeName,
        ...(employee.position !== undefined && { position: employee.position }),
        compensationModel,
        ...(employee.fixedSalary !== undefined && { fixedSalary: employee.fixedSalary }),
        ...(employee.hourlyRate !== undefined && { hourlyRate: employee.hourlyRate }),
        totalRevenue: 0,
        discountAllocated: 0,
        ownerCommission: 0,
        commissionEarning: 0,
        fixedEarning: compensationModel === "fixed"
          ? getFixedSalaryForWeek(employee.fixedSalary, weekStartDate)
          : 0,
        hourlyEarning: 0,
        totalSalary: compensationModel === "fixed"
          ? getFixedSalaryForWeek(employee.fixedSalary, weekStartDate)
          : 0,
        workedMinutes: 0,
        closedDayCount: 0,
      });
    }

    for (const settlement of currentSettlements) {
      for (const employeeSummary of settlement.preview.employeeSummaries) {
        const employee = employeeLookup.get(employeeSummary.employeeUserId);
        let currentEmployee = employeeMap.get(employeeSummary.employeeUserId);

        if (!currentEmployee) {
          let employeeName = employeeSummary.employeeName.trim();
          if (!employeeName || employeeName === employeeSummary.employeeUserId) {
            employeeName = "Employee";
          }

          currentEmployee = {
            employeeUserId: employeeSummary.employeeUserId,
            name: employeeName,
            ...(employee?.position !== undefined && { position: employee.position }),
            compensationModel: employeeSummary.compensationModel,
            ...(employeeSummary.fixedSalary !== undefined && {
              fixedSalary: employeeSummary.fixedSalary,
            }),
            ...(employeeSummary.hourlyRate !== undefined && {
              hourlyRate: employeeSummary.hourlyRate,
            }),
            totalRevenue: 0,
            discountAllocated: 0,
            ownerCommission: 0,
            commissionEarning: 0,
            fixedEarning:
              employeeSummary.compensationModel === "fixed"
                ? getFixedSalaryForWeek(employeeSummary.fixedSalary ?? employee?.fixedSalary, weekStartDate)
                : 0,
            hourlyEarning: 0,
            totalSalary:
              employeeSummary.compensationModel === "fixed"
                ? getFixedSalaryForWeek(employeeSummary.fixedSalary ?? employee?.fixedSalary, weekStartDate)
                : 0,
            workedMinutes: 0,
            closedDayCount: 0,
          };
        }

        let hourlyRate = employeeSummary.hourlyRate;
        if (hourlyRate === undefined && employee?.hourlyRate !== undefined) {
          hourlyRate = employee.hourlyRate;
        }

        const hourlyEarning =
          employeeSummary.compensationModel === "hourly" && hourlyRate !== undefined
            ? fromMoneyMinorUnit(
                Math.round((toMoneyMinorUnit(hourlyRate) * employeeSummary.workedMinutes) / 60),
              )
            : 0;
        const commissionEarning =
          employeeSummary.compensationModel === "commission" ? employeeSummary.employeeEarning : 0;

        currentEmployee.compensationModel = employeeSummary.compensationModel;
        if (hourlyRate !== undefined) {
          currentEmployee.hourlyRate = hourlyRate;
        }
        currentEmployee.totalRevenue = addMoney(
          currentEmployee.totalRevenue,
          employeeSummary.totalRevenue,
        );
        currentEmployee.discountAllocated = addMoney(
          currentEmployee.discountAllocated,
          employeeSummary.discountAllocated,
        );
        currentEmployee.ownerCommission = addMoney(
          currentEmployee.ownerCommission,
          employeeSummary.ownerCommission,
        );
        currentEmployee.commissionEarning = addMoney(
          currentEmployee.commissionEarning,
          commissionEarning,
        );
        currentEmployee.hourlyEarning = addMoney(currentEmployee.hourlyEarning, hourlyEarning);
        currentEmployee.totalSalary = addMoney(
          addMoney(currentEmployee.commissionEarning, currentEmployee.fixedEarning),
          currentEmployee.hourlyEarning,
        );
        currentEmployee.workedMinutes += employeeSummary.workedMinutes;
        currentEmployee.closedDayCount += 1;
        if (
          currentEmployee.lastClosedWorkDate === undefined ||
          settlement.workDate > currentEmployee.lastClosedWorkDate
        ) {
          currentEmployee.lastClosedWorkDate = settlement.workDate;
        }
        employeeMap.set(employeeSummary.employeeUserId, currentEmployee);
      }
    }

    const employees = Array.from(employeeMap.values()).sort((left, right) =>
      left.name.localeCompare(right.name, "vi-VN"),
    );

    let previousTotalSalary = sumMoney(
      storeEmployees.map((employee) =>
        employee.compensationModel === "fixed"
          ? getFixedSalaryForWeek(employee.fixedSalary, previousWeekStartDate)
          : 0,
      ),
    );
    for (const settlement of previousSettlements) {
      for (const employeeSummary of settlement.preview.employeeSummaries) {
        const employee = employeeLookup.get(employeeSummary.employeeUserId);
        let hourlyRate = employeeSummary.hourlyRate;
        if (hourlyRate === undefined && employee?.hourlyRate !== undefined) {
          hourlyRate = employee.hourlyRate;
        }

        const hourlyEarning =
          employeeSummary.compensationModel === "hourly" && hourlyRate !== undefined
            ? fromMoneyMinorUnit(
                Math.round((toMoneyMinorUnit(hourlyRate) * employeeSummary.workedMinutes) / 60),
              )
            : 0;
        const commissionEarning =
          employeeSummary.compensationModel === "commission" ? employeeSummary.employeeEarning : 0;
        if (employeeSummary.compensationModel === "fixed") {
          continue;
        }
        previousTotalSalary = addMoney(
          previousTotalSalary,
          addMoney(commissionEarning, hourlyEarning),
        );
      }
    }

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

    const payload = {
      period: {
        mode: "week",
        fromWorkDate: weekStart,
        toWorkDate: weekEnd,
      },
      store: {
        id: store.id,
        storeId: toPublicStoreId(store.id),
        name: store.name,
      },
      employees,
      summary: {
        totalSalary,
      totalCommissionEarning: sumMoney(employees.map((employee) => employee.commissionEarning)),
      totalFixedEarning: sumMoney(employees.map((employee) => employee.fixedEarning)),
        totalHourlyEarning: sumMoney(employees.map((employee) => employee.hourlyEarning)),
        totalRevenue: sumMoney(employees.map((employee) => employee.totalRevenue)),
        totalDiscount: sumMoney(employees.map((employee) => employee.discountAllocated)),
        totalOwnerCommission: sumMoney(employees.map((employee) => employee.ownerCommission)),
        totalEmployees,
        paidEmployeeCount: 0,
        closedDayCount: currentSettlements.length,
        averageSalary: divideMoney(totalSalary, totalEmployees),
        previousTotalSalary,
        salaryGrowthPercent,
      },
      meta: {
        source: "closed_work_day",
        currency: "EUR",
        generatedAt: Date.now(),
      },
    };

    const now = new Date();
    const currentWeekStartDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const dayOfWeek = currentWeekStartDate.getUTCDay();
    currentWeekStartDate.setUTCDate(
      currentWeekStartDate.getUTCDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek),
    );
    const cacheTtl =
      currentWeekStartDate.toISOString().slice(0, 10) === weekStart
        ? CURRENT_WEEK_CACHE_TTL_MS
        : COMPLETED_WEEK_CACHE_TTL_MS;

    await cacheSetJson(responseCacheKey, payload, cacheTtl);
    return payload;
  });

  return sendCacheableJson(request, response, responsePayload, {
    cacheControl: "private, max-age=30, stale-while-revalidate=60",
  });
};
