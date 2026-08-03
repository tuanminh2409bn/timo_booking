import type { Request, Response } from "express";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { getOrSetCacheableResponse } from "../../../modules/cacheable-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import {
  WEEKLY_REPORT_ERRORS,
  ensureStoreAccess,
  isMondayWorkDate,
  presentWeeklyReport,
  resolveEffectiveStoreId,
  resolveWeeklyReportStore,
} from "./weekly-report-shared.js";
import { aggregateWeeklyReports, getWeeksInRange } from "../../../helpers/weekly-report-generator.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";

const LIST_CACHE_TTL_MS = 5 * 60_000;

const getListCacheKey = (
  ownerId: string,
  scope: { storeId: string; fromWeek: string; toWeek: string; aggregate: boolean },
) =>
  `store:${ownerId}:response:weekly-report:list:${scope.storeId}:${scope.fromWeek}:${scope.toWeek}:${scope.aggregate}`;

export const listWeeklyReports = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  const fromWeek = typeof req.query["fromWeek"] === "string" ? req.query["fromWeek"] : "";
  const toWeek = typeof req.query["toWeek"] === "string" ? req.query["toWeek"] : "";
  const requestedStoreId = getStoreIdFromUrlPath(req);
  const aggregate = req.query["aggregate"] === "true";

  if (!isValidWorkDate(fromWeek) || !isValidWorkDate(toWeek) || fromWeek > toWeek) {
    return createErrorResponse(res, WEEKLY_REPORT_ERRORS.invalidRequest, {
      reason: "invalid week range",
      fromWeek,
      toWeek,
    });
  }

  if (!isMondayWorkDate(fromWeek) || !isMondayWorkDate(toWeek)) {
    return createErrorResponse(
      res,
      {
        ...WEEKLY_REPORT_ERRORS.invalidRequest,
        message: "fromWeek and toWeek must be Monday-aligned ISO dates",
      },
      { fromWeek, toWeek },
    );
  }

  const effectiveStoreId = resolveEffectiveStoreId(authContext, requestedStoreId);

  if (!effectiveStoreId) {
    return createErrorResponse(res, WEEKLY_REPORT_ERRORS.forbiddenStore, {
      reason: "missing storeId",
      role: authContext.role,
    });
  }

  const store = await resolveWeeklyReportStore(authContext.ownerId, effectiveStoreId);

  if (!store || !ensureStoreAccess(authContext, store.id)) {
    return createErrorResponse(res, WEEKLY_REPORT_ERRORS.forbiddenStore, {
      storeId: effectiveStoreId,
      role: authContext.role,
    });
  }

  const cacheKey = getListCacheKey(authContext.ownerId, {
    storeId: store.id,
    fromWeek,
    toWeek,
    aggregate,
  });

  return getOrSetCacheableResponse({
    request: req,
    response: res,
    cacheKey,
    ttlMs: LIST_CACHE_TTL_MS,
    cacheControl: "private, max-age=60, stale-while-revalidate=120",
    producer: async () => {
      const reports = await firestoreRepository.shop.weeklyReport.listWeeklyReports(
        authContext.ownerId,
        store.id,
        fromWeek,
        toWeek,
      );

      const items = reports.map(presentWeeklyReport);
      const expectedWeeks = getWeeksInRange(fromWeek, toWeek);
      const presentWeeks = new Set(reports.map((report) => report.weekStartDate));
      const missingWeeks = expectedWeeks.filter((week) => !presentWeeks.has(week));

      const payload: {
        items: ReturnType<typeof presentWeeklyReport>[];
        meta: {
          ownerId: string;
          storeId: string;
          fromWeek: string;
          toWeek: string;
          totalCount: number;
          missingWeeks: string[];
          expectedWeeks: number;
        };
        aggregate?: ReturnType<typeof aggregateWeeklyReports>;
      } = {
        items,
        meta: {
          ownerId: authContext.ownerId,
          storeId: store.id,
          fromWeek,
          toWeek,
          totalCount: items.length,
          missingWeeks,
          expectedWeeks: expectedWeeks.length,
        },
      };

      if (aggregate) {
        payload.aggregate = aggregateWeeklyReports(reports);
      }

      return payload;
    },
  });
};
