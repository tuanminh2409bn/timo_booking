import { performance } from "node:perf_hooks";
import type { Request, Response } from "express";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { EXPENSE_ERRORS, rejectUnlessCanManageStore } from "./expense-access.js";
import { parseExpenseListQuery } from "./expense-shared.js";
import { toShopExpenseListResponse } from "./expense-response.js";
import { mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";

const MAX_EXPENSE_RANGE_DAYS = 31;

const getRangeDayCount = (fromWorkDate: string, toWorkDate: string) => {
  const fromDate = new Date(`${fromWorkDate}T00:00:00.000Z`);
  const toDate = new Date(`${toWorkDate}T00:00:00.000Z`);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
};

export const getShopExpenses = async (req: Request, res: Response) => {
  const timing = new ServerTiming();
  const requestStartedAt = performance.now();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(req.headers["authorization"]),
  );

  if (rejectUnlessCanManageStore(res, authContext.role)) {
    return;
  }

  const listExpensesQueryParseResult = parseExpenseListQuery(mergeUrlPathStoreId(req, req.query));

  if (!listExpensesQueryParseResult.success) {
    return createErrorResponse(res, EXPENSE_ERRORS.invalidRequest, {
      validation: listExpensesQueryParseResult.error.flatten().fieldErrors,
    });
  }

  const { storeId, fromWorkDate, toWorkDate, limit } = listExpensesQueryParseResult.data;
  const rangeDayCount = getRangeDayCount(fromWorkDate, toWorkDate);

  if (fromWorkDate > toWorkDate || rangeDayCount < 1 || rangeDayCount > MAX_EXPENSE_RANGE_DAYS) {
    return createErrorResponse(res, EXPENSE_ERRORS.invalidRequest, {
      reason: "invalid work date range",
      fromWorkDate,
      toWorkDate,
      rangeDayCount,
    });
  }

  if (!canAccessStore(authContext, storeId)) {
    return createErrorResponse(res, EXPENSE_ERRORS.forbiddenStore, {
      storeId,
      role: authContext.role,
    });
  }

  const expenses = await timing.measure("firestore", () =>
    firestoreRepository.shop.expense.listShopExpenses(authContext.ownerId, {
      storeId,
      fromWorkDate,
      toWorkDate,
      ...(limit !== undefined && { limit }),
    }),
  );

  timing.add("total", performance.now() - requestStartedAt);
  res.setHeader("Server-Timing", timing.header());
  res.locals["serverTiming"] = timing.toObject();

  return sendCacheableJson(
    req,
    res,
    {
      storeId,
      fromWorkDate,
      toWorkDate,
      rangeDayCount,
      ...(limit !== undefined && { limit }),
      ...toShopExpenseListResponse(expenses),
    },
    {
      cacheControl: "private, max-age=30, stale-while-revalidate=60",
    },
  );
};
