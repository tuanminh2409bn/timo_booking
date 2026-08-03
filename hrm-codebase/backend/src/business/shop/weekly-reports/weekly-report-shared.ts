import { canAccessStore, isOwner } from "../../../helpers/role-access.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import type { AuthorizedAppContext } from "../../../helpers/role-access.js";
import type { StoreType } from "../../../repository/firestore/shop/shop.types.js";
import type { WeeklyReportType } from "../../../repository/firestore/shop/weekly-report.types.js";
import { DEFAULT_MONEY_CURRENCY, DEFAULT_MONEY_SCALE } from "../../../helpers/money.js";

export const WEEKLY_REPORT_ERRORS = {
  invalidRequest: {
    statusCode: 400,
    type: "/stores/weekly-reports/invalid-request",
    message: "Invalid weekly report request",
  },
  forbiddenStore: {
    statusCode: 403,
    type: "/stores/weekly-reports/forbidden-store",
    message: "Forbidden: store access denied",
  },
  notFound: {
    statusCode: 404,
    type: "/stores/weekly-reports/not-found",
    message: "Weekly report not found",
  },
  conflict: {
    statusCode: 409,
    type: "/stores/weekly-reports/already-exists",
    message: "Weekly report already exists for this week",
  },
  forbiddenRole: {
    statusCode: 403,
    type: "/stores/weekly-reports/forbidden-role",
    message: "Forbidden: only owner role can manage weekly reports",
  },
};

export const isMondayWorkDate = (workDate: string): boolean => {
  if (!isValidWorkDate(workDate)) {
    return false;
  }

  const date = new Date(`${workDate}T00:00:00.000Z`);
  return date.getUTCDay() === 1;
};

export const ensureStoreAccess = (
  authContext: Pick<AuthorizedAppContext, "role" | "storeId">,
  requestedStoreId: string,
): boolean => canAccessStore(authContext, requestedStoreId);

export const resolveEffectiveStoreId = (
  authContext: Pick<AuthorizedAppContext, "role" | "storeId">,
  requestedStoreId: string | undefined,
): string | undefined => {
  if (requestedStoreId !== undefined && requestedStoreId.trim().length > 0) {
    return requestedStoreId;
  }

  if (!isOwner(authContext.role) && authContext.storeId) {
    return authContext.storeId;
  }

  return undefined;
};

export const resolveWeeklyReportStore = async (
  ownerId: string,
  storeId: string,
): Promise<StoreType | null> => {
  try {
    return await firestoreRepository.shop.store.getStore(ownerId, storeId);
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return null;
    }

    throw error;
  }
};

export const presentWeeklyReport = (report: WeeklyReportType) => ({
  id: report.id,
  ownerId: report.ownerId,
  storeId: report.storeId,
  weekStartDate: report.weekStartDate,
  weekEndDate: report.weekEndDate,
  year: report.year,
  weekNumber: report.weekNumber,
  isPartial: report.isPartial,
  currency: report.currency ?? DEFAULT_MONEY_CURRENCY,
  moneyScale: report.moneyScale ?? DEFAULT_MONEY_SCALE,
  summary: report.summary,
  dailyMetrics: report.dailyMetrics,
  employeeBreakdowns: report.employeeBreakdowns,
  dailyEmployeeBreakdowns: report.dailyEmployeeBreakdowns ?? [],
  serviceBreakdowns: report.serviceBreakdowns,
  dailyServiceBreakdowns: report.dailyServiceBreakdowns ?? [],
  generatedAt: report.generatedAt,
  generatedByUserId: report.generatedByUserId,
  sourceClosingIds: report.sourceClosingIds,
  revision: report.revision,
  createdAt: report.createdAt,
  updatedAt: report.updatedAt,
});
