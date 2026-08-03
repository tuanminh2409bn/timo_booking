import { randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import dotenv from "dotenv";
import APIResponseError from "../../constants/api-response-error.js";
import { firebaseAdminApp } from "../firebase-auth/index.js";
import { StatusCodes } from "http-status-codes";
import { logger } from "../../modules/logger.js";

dotenv.config();

const getStorageBucketName = () =>
  process.env["FIREBASE_STORAGE_BUCKET"]?.trim() ||
  (process.env["GCP_PROJECT_ID"]
    ? `${process.env["GCP_PROJECT_ID"]}.firebasestorage.app`
    : undefined);


const sanitizeFileName = (fileName: string) =>
  fileName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^\.+$/, "file");

const createDownloadUrl = (bucketName: string, filePath: string, token: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
    filePath,
  )}?alt=media&token=${token}`;

type UploadImageResult = {
  imageUrl: string;
  storagePath: string;
};

const throwStorageUploadError = (error: unknown, errorType: string): never => {
  const errorCode =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;

  logger.error(
    {
      event: "storage.upload_failed",
      ...(errorCode !== undefined && { errorCode }),
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    },
    "Firebase Storage upload failed",
  );

  throw new APIResponseError(
    errorCode === "404" ? "Storage bucket is unavailable" : "Cannot upload image",
    errorType,
    StatusCodes.BAD_GATEWAY,
  );
};

const uploadImageFactory = ({
  errorType,
  getFilePath,
}: {
  errorType: string;
  getFilePath: (fileName: string) => string;
}) => {
  return async ({
    fileName,
    contentType,
    buffer,
  }: {
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }) => {
    const bucketName = getStorageBucketName();

    if (!bucketName) {
      throw new APIResponseError(
        "Firebase Storage bucket is not configured",
        "/storage/bucket-not-configured",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    const bucket = getStorage(firebaseAdminApp).bucket(bucketName);
    const filePath = getFilePath(fileName);
    const file = bucket.file(filePath);
    const token = randomUUID();

    try {
      await file.save(buffer, {
        resumable: false,
        metadata: {
          contentType,
          metadata: {
            firebaseStorageDownloadTokens: token,
          },
        },
      });
    } catch (error) {
      throwStorageUploadError(error, errorType);
    }

    return createDownloadUrl(bucketName, filePath, token);
  };
};

const uploadReceiptImageFactory = ({
  errorType,
  getFilePath,
  getLifecyclePrefix,
}: {
  errorType: string;
  getFilePath: (fileName: string) => string;
  getLifecyclePrefix: () => string;
}) => {
  return async ({
    fileName,
    contentType,
    buffer,
  }: {
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }): Promise<UploadImageResult> => {
    const bucketName = getStorageBucketName();

    if (!bucketName) {
      throw new APIResponseError(
        "Firebase Storage bucket is not configured",
        "/storage/bucket-not-configured",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    const bucket = getStorage(firebaseAdminApp).bucket(bucketName);
    const filePath = getFilePath(fileName);
    const file = bucket.file(filePath);
    const token = randomUUID();
    const uploadedAtIso = new Date().toISOString();

    try {
      await file.save(buffer, {
        resumable: false,
        metadata: {
          contentType,
          cacheControl: "private, max-age=3600",
          customTime: uploadedAtIso,
          metadata: {
            firebaseStorageDownloadTokens: token,
            storageLifecyclePolicy: "expense-receipt-hot-cold-v1",
            storageLifecyclePrefix: getLifecyclePrefix(),
          },
        },
      });
    } catch (error) {
      throwStorageUploadError(error, errorType);
    }

    return {
      imageUrl: createDownloadUrl(bucketName, filePath, token),
      storagePath: filePath,
    };
  };
};

export const firebaseStorageRepository = {
  uploadShopServiceImage: ({
    ownerId,
    fileName,
    contentType,
    buffer,
  }: {
    ownerId: string;
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }) =>
    uploadImageFactory({
      errorType: "/storage/service-image-upload-failed",
      getFilePath: (nextFileName) =>
        `shops/${ownerId}/services/${Date.now()}-${sanitizeFileName(nextFileName)}`,
    })({ fileName, contentType, buffer }),
  uploadShopExpenseReceiptImage: ({
    ownerId,
    storeId,
    workDate,
    fileName,
    contentType,
    buffer,
  }: {
    ownerId: string;
    storeId: string;
    workDate: string;
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }) =>
    uploadReceiptImageFactory({
      errorType: "/storage/expense-receipt-upload-failed",
      getLifecyclePrefix: () => "expense-receipts/",
      getFilePath: (nextFileName) =>
        `expense-receipts/${ownerId}/${storeId}/${workDate}/${Date.now()}-${sanitizeFileName(nextFileName)}`,
    })({ fileName, contentType, buffer }),
};
