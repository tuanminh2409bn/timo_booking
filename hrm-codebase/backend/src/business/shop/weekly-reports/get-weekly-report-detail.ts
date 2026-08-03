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
import { getOrGenerate } from "../../../helpers/weekly-report-provider.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";

const DETAIL_CACHE_TTL_MS = 5 * 60_000;

const getDetailCacheKey = (
  ownerId: string,
  storeId: string,
  weekStartDate: string,
  generateIfMissing: boolean,
) =>
  `store:${ownerId}:response:weekly-report:detail:${storeId}:${weekStartDate}:${generateIfMissing}`;

export const getWeeklyReportDetail = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  const weekStartDate =
    typeof req.params["weekStartDate"] === "string" ? req.params["weekStartDate"] : "";
  const requestedStoreId = getStoreIdFromUrlPath(req);
  const generateIfMissing = req.query["generateIfMissing"] === "true";

  if (!isValidWorkDate(weekStartDate) || !isMondayWorkDate(weekStartDate)) {
    return createErrorResponse(
      res,
      {
        ...WEEKLY_REPORT_ERRORS.invalidRequest,
        message: "weekStartDate must be a Monday-aligned ISO date",
      },
      { weekStartDate },
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

  const cacheKey = getDetailCacheKey(
    authContext.ownerId,
    store.id,
    weekStartDate,
    generateIfMissing,
  );

  const existing = await firestoreRepository.shop.weeklyReport.getWeeklyReport(
    authContext.ownerId,
    store.id,
    weekStartDate,
  );

  if (!existing && !generateIfMissing) {
    return createErrorResponse(res, WEEKLY_REPORT_ERRORS.notFound, {
      storeId: store.id,
      weekStartDate,
    });
  }

  return getOrSetCacheableResponse({
    request: req,
    response: res,
    cacheKey,
    ttlMs: DETAIL_CACHE_TTL_MS,
    cacheControl: "private, max-age=60, stale-while-revalidate=120",
    producer: async () => {
      const report =
        existing ??
        (await getOrGenerate(authContext.ownerId, store.id, weekStartDate, authContext.uid));

      return {
        item: presentWeeklyReport(report),
        meta: {
          ownerId: authContext.ownerId,
          storeId: store.id,
          weekStartDate,
          generated: !existing,
        },
      };
    },
  });
};
