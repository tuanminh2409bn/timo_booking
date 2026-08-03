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
import { toShopExpenseResponse } from "./expense-response.js";
import { parseUpdateExpensePayload } from "./expense-shared.js";
import { mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";

const REPORT_CACHE_VERSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const updateShopExpense = async (req: Request, res: Response) => {
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
  const updateExpenseParseResult = parseUpdateExpensePayload(mergeUrlPathStoreId(req, req.body));

  if (
    typeof expenseId !== "string" ||
    expenseId.trim().length === 0 ||
    storeId === undefined ||
    !updateExpenseParseResult.success
  ) {
    return createErrorResponse(res, EXPENSE_ERRORS.invalidRequest, {
      ...(updateExpenseParseResult.success
        ? {}
        : { validation: updateExpenseParseResult.error.flatten().fieldErrors }),
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
    const updatedExpense = await timing.measure("firestore", () =>
      firestoreRepository.shop.expense.updateShopExpense(authContext.ownerId, storeId, expenseId, {
        ...(updateExpenseParseResult.data.workDate !== undefined && {
          workDate: updateExpenseParseResult.data.workDate,
        }),
        ...(updateExpenseParseResult.data.name !== undefined && {
          name: updateExpenseParseResult.data.name,
        }),
        ...(updateExpenseParseResult.data.supplierName !== undefined && {
          supplierName: updateExpenseParseResult.data.supplierName,
        }),
        ...(updateExpenseParseResult.data.note !== undefined && {
          note: updateExpenseParseResult.data.note,
        }),
        ...(updateExpenseParseResult.data.amount !== undefined && {
          amount: updateExpenseParseResult.data.amount,
        }),
        ...(updateExpenseParseResult.data.receiptImage !== undefined && {
          receiptImage: {
            imageUrl: updateExpenseParseResult.data.receiptImage.imageUrl,
            ...(updateExpenseParseResult.data.receiptImage.storagePath !== undefined && {
              storagePath: updateExpenseParseResult.data.receiptImage.storagePath,
            }),
            ...(updateExpenseParseResult.data.receiptImage.fileName !== undefined && {
              fileName: updateExpenseParseResult.data.receiptImage.fileName,
            }),
            ...(updateExpenseParseResult.data.receiptImage.contentType !== undefined && {
              contentType: updateExpenseParseResult.data.receiptImage.contentType,
            }),
            uploadedAt: Date.now(),
            uploadedByUserId: authContext.uid,
            storageLifecyclePolicy: "expense-receipt-hot-cold-v1",
          },
        }),
        updatedByUserId: authContext.uid,
      }),
    );

    await Promise.all([
      timing.measure("audit", () =>
        writeShopAuditLog({
          ownerId: authContext.ownerId,
          eventType: "expense_updated",
          entityType: "expense",
          entityId: updatedExpense.id,
          storeId: updatedExpense.storeId,
          workDate: updatedExpense.workDate,
          actor: {
            uid: authContext.uid,
            role: authContext.role,
          },
          metadata: {
            amount: updatedExpense.amount,
            hasReceipt: updatedExpense.receiptImage !== undefined,
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
      item: toShopExpenseResponse(updatedExpense),
    });
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, EXPENSE_ERRORS.notFound, { expenseId, storeId });
    }

    throw error;
  }
};
