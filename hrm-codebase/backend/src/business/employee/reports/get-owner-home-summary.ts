import type { Request, Response } from "express";
import { getOwnerHomeSummaryResponseCacheKey } from "../../../helpers/cache-keys.js";
import { addMoney, roundMoney } from "../../../helpers/money.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { can } from "../../../helpers/permissions.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { getOrSetCacheableResponse } from "../../../modules/cacheable-response.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import type {
  ShopAttendanceType,
  StoreType,
} from "../../../repository/firestore/shop/shop.types.js";
import {
  normalizeBusinessTimeZone,
  normalizeSettlementCutoffTime,
  resolveBusinessWorkDate,
} from "../../../helpers/business-day.js";
import { isRevenueBearingAttendance } from "../../../helpers/work-day-settlement.js";

const HOME_SUMMARY_CACHE_TTL_MS = 5 * 60_000;
const MAX_HOME_MONTH_RANGE_DAYS = 31;

const SERVICE_ERRORS = {
  forbiddenStore: {
    statusCode: 403,
    type: "/reports/home-summary/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenRole: {
    statusCode: 403,
    type: "/reports/home-summary/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: 400,
    type: "/reports/home-summary/invalid-request",
    message: "Invalid request",
  },
};

const toDateFromWorkDate = (workDate: string) => new Date(`${workDate}T00:00:00.000Z`);

const getRangeDayCount = (fromWorkDate: string, toWorkDate: string) =>
  Math.floor(
    (toDateFromWorkDate(toWorkDate).getTime() - toDateFromWorkDate(fromWorkDate).getTime()) /
      86_400_000,
  ) + 1;

const toHomeStoreResponse = (
  store: StoreType,
  employeeCount: number = store.employeeCount ?? 0,
) => ({
  id: store.id,
  name: store.name,
  employeeCount,
  ...(store.openTime !== undefined && { openTime: store.openTime }),
  ...(store.closeTime !== undefined && { closeTime: store.closeTime }),
  settlementCutoffTime: normalizeSettlementCutoffTime(store.settlementCutoffTime),
});

const getFirstActiveStore = async (ownerId: string) => {
  const stores = await firestoreRepository.shop.store.getStoreSummaryList(ownerId);

  return stores.find((store) => store.status === "active");
};

const resolveSelectedHomeStore = async (ownerId: string, requestedStoreId: string) => {
  if (!requestedStoreId) {
    return getFirstActiveStore(ownerId);
  }

  try {
    const store = await firestoreRepository.shop.store.getStore(ownerId, requestedStoreId, {
      skipCache: true,
    });

    return store.status === "active" ? store : getFirstActiveStore(ownerId);
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return getFirstActiveStore(ownerId);
    }

    throw error;
  }
};

const HOME_UPCOMING_SERVICE_LIMIT = 4;

const getCurrentStoreMinutes = (timeZone: string | undefined) => {
  const normalizedTimeZone = normalizeBusinessTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizedTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(Date.now());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);

  return hour * 60 + minute;
};

const getHomeTodayMetrics = (
  attendances: ShopAttendanceType[],
  store: StoreType,
  workDate: string,
) => {
  const currentStoreWorkDate = resolveBusinessWorkDate(Date.now(), {
    timeZone: store.timezone,
    settlementCutoffTime: normalizeSettlementCutoffTime(store.settlementCutoffTime),
  });
  const currentStoreMinutes = getCurrentStoreMinutes(store.timezone);
  let revenueTotal = 0;
  let upcomingServiceCount = 0;

  for (const attendance of attendances) {
    if (isRevenueBearingAttendance(attendance)) {
      revenueTotal = addMoney(revenueTotal, attendance.subtotalAmount || attendance.totalAmount);
    }

    if (upcomingServiceCount >= HOME_UPCOMING_SERVICE_LIMIT) {
      continue;
    }

    const isDifferentWorkDate = workDate !== currentStoreWorkDate;
    const isInProgress =
      attendance.status === "open" &&
      attendance.startTime <= currentStoreMinutes &&
      attendance.endTime >= currentStoreMinutes;

    if (isDifferentWorkDate || attendance.startTime >= currentStoreMinutes || isInProgress) {
      upcomingServiceCount = Math.min(
        HOME_UPCOMING_SERVICE_LIMIT,
        upcomingServiceCount + attendance.services.length,
      );
    }
  }

  return {
    revenueTotal: roundMoney(revenueTotal),
    upcomingServiceCount,
    totalCount: attendances.length,
  };
};

export const getOwnerHomeSummary = async (req: Request, res: Response) => {
  const timing = new ServerTiming();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(req.headers["authorization"]),
  );

  if (!can(authContext.role, "homeSummary:view")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  const requestedStoreId =
    typeof req.query["storeId"] === "string" ? req.query["storeId"].trim() : "";
  const workDate = typeof req.query["workDate"] === "string" ? req.query["workDate"] : "";
  const monthStart = typeof req.query["monthStart"] === "string" ? req.query["monthStart"] : "";
  const monthEnd = typeof req.query["monthEnd"] === "string" ? req.query["monthEnd"] : "";
  const monthRangeDays =
    isValidWorkDate(monthStart) && isValidWorkDate(monthEnd)
      ? getRangeDayCount(monthStart, monthEnd)
      : 0;

  if (
    !isValidWorkDate(workDate) ||
    !isValidWorkDate(monthStart) ||
    !isValidWorkDate(monthEnd) ||
    monthRangeDays < 1 ||
    monthRangeDays > MAX_HOME_MONTH_RANGE_DAYS
  ) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "invalid date range",
      workDate,
      monthStart,
      monthEnd,
    });
  }

  const ownerId = authContext.ownerId;
  const selectedStore = await timing.measure("store_scope", () =>
    resolveSelectedHomeStore(ownerId, requestedStoreId),
  );

  if (!selectedStore || !canAccessStore(authContext, selectedStore.id)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      storeId: selectedStore?.id,
      role: authContext.role,
    });
  }

  const storeId = selectedStore.id;
  const responseCacheKey = getOwnerHomeSummaryResponseCacheKey(ownerId, {
    userId: authContext.uid,
    role: authContext.role,
    responseVersion: "home-summary-v7",
    storeId,
    workDate,
    monthStart,
    monthEnd,
  });

  return getOrSetCacheableResponse({
    request: req,
    response: res,
    cacheKey: responseCacheKey,
    ttlMs: HOME_SUMMARY_CACHE_TTL_MS,
    cacheControl: "private, max-age=60, stale-while-revalidate=300",
    timing,
    producer: async () => {
      const [todayAttendances, pendingSettlementCount, employeeCount] = await Promise.all([
        timing.measure("today_attendance", () =>
          firestoreRepository.shop.attendance.listShopAttendanceByStoreDateRange(
            ownerId,
            storeId,
            workDate,
            workDate,
          ),
        ),
        timing.measure("settlement_count", () =>
          firestoreRepository.shop.settlement.countOpenWorkDaySettlementsByStore(ownerId, storeId),
        ),
        timing.measure("employee_count", () =>
          firestoreRepository.user.countShopEmployees(ownerId, { storeId, active: true }),
        ),
      ]);
      const todayMetrics = getHomeTodayMetrics(todayAttendances, selectedStore, workDate);

      return {
        store: toHomeStoreResponse(selectedStore, employeeCount),
        today: todayMetrics,
        summary: {
          pendingSettlementCount,
        },
        meta: {
          storeId,
          workDate,
          monthStart,
          monthEnd,
          cachedAt: new Date().toISOString(),
        },
      };
    },
  });
};
