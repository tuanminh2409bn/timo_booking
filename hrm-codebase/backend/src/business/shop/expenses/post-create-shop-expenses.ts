import { performance } from "node:perf_hooks";
import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { canAccessStore } from "../../../helpers/role-access.js";
import { getEmployeeReportCacheVersionKey } from "../../../helpers/cache-keys.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { cacheIncrement } from "../../../repository/cache/cache-client.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import type { ShopExpenseType } from "../../../repository/firestore/shop/shop.types.js";
import { EXPENSE_ERRORS, rejectUnlessCanManageStore } from "./expense-access.js";
import { toShopExpenseListResponse } from "./expense-response.js";
import { type ExpenseItemInput, parseExpenseBatchPayload } from "./expense-shared.js";

const toExpenseReceipt = (receiptImage: ExpenseItemInput["receiptImage"], uid: string) =>
  receiptImage
    ? {
        imageUrl: receiptImage.imageUrl,
        ...(receiptImage.storagePath !== undefined && { storagePath: receiptImage.storagePath }),
        ...(receiptImage.fileName !== undefined && { fileName: receiptImage.fileName }),
        ...(receiptImage.contentType !== undefined && { contentType: receiptImage.contentType }),
        uploadedAt: Date.now(),
        uploadedByUserId: uid,
        storageLifecyclePolicy: "expense-receipt-hot-cold-v1" as const,
      }
    : undefined;

const REPORT_CACHE_VERSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const createShopExpenses = async (req: Request, res: Response) => {
  const timing = new ServerTiming();
  const requestStartedAt = performance.now();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(req.headers["authorization"]),
  );

  if (rejectUnlessCanManageStore(res, authContext.role)) {
    return;
  }

  const createExpensesParseResult = parseExpenseBatchPayload(mergeUrlPathStoreId(req, req.body));

  if (!createExpensesParseResult.success) {
    return createErrorResponse(res, EXPENSE_ERRORS.invalidRequest, {
      validation: createExpensesParseResult.error.flatten().fieldErrors,
    });
  }

  const { storeId, workDate, items } = createExpensesParseResult.data;

  if (!canAccessStore(authContext, storeId)) {
    return createErrorResponse(res, EXPENSE_ERRORS.forbiddenStore, {
      storeId,
      role: authContext.role,
    });
  }

  const createdExpenses = await timing.measure("firestore", () =>
    firestoreRepository.shop.expense.createShopExpenses(
      authContext.ownerId,
      items.map(
        (expenseItem): Omit<ShopExpenseType, "id" | "ownerId" | "createdAt" | "updatedAt"> => {
          const receiptImage = toExpenseReceipt(expenseItem.receiptImage, authContext.uid);

          return {
            storeId,
            workDate,
            name: expenseItem.name,
            ...(expenseItem.supplierName !== undefined &&
              expenseItem.supplierName.length > 0 && {
                supplierName: expenseItem.supplierName,
              }),
            ...(expenseItem.note !== undefined &&
              expenseItem.note.length > 0 && { note: expenseItem.note }),
            amount: expenseItem.amount,
            ...(receiptImage !== undefined && { receiptImage }),
            createdByUserId: authContext.uid,
            updatedByUserId: authContext.uid,
          };
        },
      ),
    ),
  );

  await Promise.all([
    timing.measure("audit", () =>
      writeShopAuditLog({
        ownerId: authContext.ownerId,
        eventType: "expense_created",
        entityType: "expense",
        storeId,
        workDate,
        actor: {
          uid: authContext.uid,
          role: authContext.role,
        },
        metadata: {
          count: createdExpenses.length,
          totalAmount: createdExpenses.reduce((sum, expense) => sum + expense.amount, 0),
          receiptCount: createdExpenses.filter((expense) => expense.receiptImage !== undefined).length,
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

  return res.status(StatusCodes.CREATED).json({
    storeId,
    workDate,
    ...toShopExpenseListResponse(createdExpenses),
  });
};
