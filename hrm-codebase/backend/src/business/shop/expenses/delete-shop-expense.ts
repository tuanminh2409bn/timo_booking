import { performance } from "node:perf_hooks";
import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { getEmployeeReportCacheVersionKey } from "../../../helpers/cache-keys.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { cacheIncrement } from "../../../repository/cache/cache-client.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { EXPENSE_ERRORS, rejectUnlessCanManageStore } from "./expense-access.js";

const REPORT_CACHE_VERSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const deleteShopExpense = async (req: Request, res: Response) => {
  const timing = new ServerTiming();
  const requestStartedAt = performance.now();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(req.headers["authorization"]),
  );

  if (rejectUnlessCanManageStore(res, authContext.role)) {
    return;
  }

  const expenseId = req.params["expenseId"];
  const storeId = getStoreIdFromUrlPath(req);

  if (typeof expenseId !== "string" || expenseId.trim().length === 0 || storeId === undefined) {
    return createErrorResponse(res, EXPENSE_ERRORS.invalidRequest, {
      reason: "missing expenseId or storeId",
      expenseId,
      storeId,
    });
  }

  if (!canAccessStore(authContext, storeId)) {
    return createErrorResponse(res, EXPENSE_ERRORS.forbiddenStore, {
      storeId,
      role: authContext.role,
    });
  }

  try {
    const deletedExpense = await timing.measure("firestore", () =>
      firestoreRepository.shop.expense.deleteShopExpense(authContext.ownerId, storeId, expenseId),
    );

    await Promise.all([
      timing.measure("audit", () =>
        writeShopAuditLog({
          ownerId: authContext.ownerId,
          eventType: "expense_deleted",
          entityType: "expense",
          entityId: deletedExpense.id,
          storeId: deletedExpense.storeId,
          workDate: deletedExpense.workDate,
          actor: {
            uid: authContext.uid,
            role: authContext.role,
          },
          metadata: {
            name: deletedExpense.name,
            amount: deletedExpense.amount,
            hadReceipt: deletedExpense.receiptImage !== undefined,
          },
        }),
      ),
      timing.measure("report_cache", () =>
        cacheIncrement(
          getEmployeeReportCacheVersionKey(authContext.ownerId),
          REPORT_CACHE_VERSION_TTL_MS,
        ),
      ),
    ]);

    timing.add("total", performance.now() - requestStartedAt);
    res.setHeader("Server-Timing", timing.header());
    res.locals["serverTiming"] = timing.toObject();

    return res.status(StatusCodes.OK).json({
      id: deletedExpense.id,
      deleted: true,
      storeId: deletedExpense.storeId,
      workDate: deletedExpense.workDate,
    });
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, EXPENSE_ERRORS.notFound, { expenseId, storeId });
    }

    throw error;
  }
};
