import type { Request, Response } from "express";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { invalidateWeeklyReportsByStore } from "../../../helpers/weekly-report-cache.js";
import {
  WEEKLY_REPORT_ERRORS,
  ensureStoreAccess,
  isMondayWorkDate,
  presentWeeklyReport,
  resolveEffectiveStoreId,
  resolveWeeklyReportStore,
} from "./weekly-report-shared.js";
import { generateAndPersistWeeklyReport } from "../../../helpers/weekly-report-provider.js";
import { USER_ROLE } from "../../../helpers/user-roles.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";

export const generateWeeklyReportEndpoint = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (authContext.role !== USER_ROLE.OWNER) {
    return createErrorResponse(res, WEEKLY_REPORT_ERRORS.forbiddenRole, { role: authContext.role });
  }

  const weekStartDate = typeof req.body?.weekStartDate === "string" ? req.body.weekStartDate : "";
  const requestedStoreId = getStoreIdFromUrlPath(req);

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

  const existing = await firestoreRepository.shop.weeklyReport.getWeeklyReport(
    authContext.ownerId,
    store.id,
    weekStartDate,
  );

  if (existing) {
    return createErrorResponse(res, WEEKLY_REPORT_ERRORS.conflict, {
      storeId: store.id,
      weekStartDate,
    });
  }

  const report = await generateAndPersistWeeklyReport(
    authContext.ownerId,
    store.id,
    weekStartDate,
    authContext.uid,
  );

  await invalidateWeeklyReportsByStore(authContext.ownerId, store.id);

  return sendCacheableJson(
    req,
    res,
    {
      item: presentWeeklyReport(report),
      meta: {
        ownerId: authContext.ownerId,
        storeId: store.id,
        weekStartDate,
        generated: true,
      },
    },
    { statusCode: 201 },
  );
};
