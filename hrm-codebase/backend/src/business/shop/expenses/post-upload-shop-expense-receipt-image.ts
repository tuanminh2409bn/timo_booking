import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { decodeImageUpload } from "../../../helpers/image-upload.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { firebaseStorageRepository } from "../../../repository/firebase-storage/index.js";
import { EXPENSE_ERRORS, rejectUnlessCanManageStore, resolveActiveExpenseStore } from "./expense-access.js";
import { parseExpenseReceiptUploadPayload } from "./expense-shared.js";
import { mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";

const MAX_EXPENSE_RECEIPT_IMAGE_FILE_SIZE_BYTES = 8 * 1024 * 1024;

export const uploadShopExpenseReceiptImage = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (rejectUnlessCanManageStore(res, authContext.role)) {
    return;
  }

  const receiptUploadParseResult = parseExpenseReceiptUploadPayload(mergeUrlPathStoreId(req, req.body));

  if (!receiptUploadParseResult.success) {
    return createErrorResponse(res, EXPENSE_ERRORS.invalidReceiptUpload, {
      validation: receiptUploadParseResult.error.flatten().fieldErrors,
    });
  }

  const { storeId, workDate, fileName, contentType, base64 } = receiptUploadParseResult.data;
  const store = await resolveActiveExpenseStore(authContext.ownerId, storeId);

  if (!store) {
    return createErrorResponse(res, EXPENSE_ERRORS.invalidReceiptUpload, {
      reason: "store not active",
      storeId,
    });
  }

  const canonicalStoreId = store.id;

  const imageUpload = decodeImageUpload({
    base64,
    contentType,
    maxBytes: MAX_EXPENSE_RECEIPT_IMAGE_FILE_SIZE_BYTES,
  });

  if (!imageUpload.ok && imageUpload.reason === "fileTooLarge") {
    return createErrorResponse(res, EXPENSE_ERRORS.receiptFileTooLarge, { contentType });
  }

  if (!imageUpload.ok) {
    return createErrorResponse(res, EXPENSE_ERRORS.invalidReceiptUpload, {
      reason: imageUpload.reason,
    });
  }

  const uploadResult = await firebaseStorageRepository.uploadShopExpenseReceiptImage({
    ownerId: authContext.ownerId,
    storeId: canonicalStoreId,
    workDate,
    fileName,
    contentType,
    buffer: imageUpload.buffer,
  });

  await writeShopAuditLog({
    ownerId: authContext.ownerId,
    eventType: "expense_receipt_uploaded",
    entityType: "expense",
    storeId: canonicalStoreId,
    workDate,
    actor: {
      uid: authContext.uid,
      role: authContext.role,
    },
    metadata: {
      storeName: store.name,
      fileName,
      contentType,
      storagePath: uploadResult.storagePath,
      storageLifecyclePolicy: "expense-receipt-hot-cold-v1",
    },
  });

  return res.status(StatusCodes.OK).json({
    imageUrl: uploadResult.imageUrl,
    storagePath: uploadResult.storagePath,
    fileName,
    contentType,
    storageLifecyclePolicy: "expense-receipt-hot-cold-v1",
  });
};
