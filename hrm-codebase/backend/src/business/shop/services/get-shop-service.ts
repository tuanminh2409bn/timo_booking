import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { toShopServiceListItem } from "./service-response.js";

const SERVICE_ERRORS = {
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/services/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/services/invalid-request",
    message: "Invalid request",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/services/forbidden-store",
    message: "Forbidden: store access denied",
  },
  storeNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/services/store-not-found",
    message: "Store not found",
  },
};

export const listShopServices = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const requestedStoreId = getStoreIdFromUrlPath(req)?.trim();

  if (!can(authContext.role, "service:read")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  if (!requestedStoreId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, { reason: "missing storeId" });
  }

  if (!canAccessStore(authContext, requestedStoreId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      storeId: requestedStoreId,
      role: authContext.role,
    });
  }

  try {
    const [store, servicesStoredForStore] = await Promise.all([
      firestoreRepository.shop.store.getStore(authContext.ownerId, requestedStoreId),
      firestoreRepository.shop.service.getShopServiceFactory(
        authContext.ownerId,
        requestedStoreId,
      ),
    ]);
    const responseItems = servicesStoredForStore.map(toShopServiceListItem);
    let latestUpdatedAt: number | undefined;

    for (const responseItem of responseItems) {
      if (responseItem.updatedAt === undefined) {
        continue;
      }

      if (latestUpdatedAt === undefined || responseItem.updatedAt > latestUpdatedAt) {
        latestUpdatedAt = responseItem.updatedAt;
      }
    }

    return sendCacheableJson(
      req,
      res,
      {
        items: responseItems,
        meta: {
          storeId: store.id,
          totalCount: responseItems.length,
          ...(latestUpdatedAt !== undefined && { latestUpdatedAt }),
        },
      },
      {
        cacheControl: "private, max-age=30, stale-while-revalidate=60",
      },
    );
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_ERRORS.storeNotFound, {
        storeId: requestedStoreId,
      });
    }

    throw error;
  }
};
