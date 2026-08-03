import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { can } from "../../../helpers/permissions.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { SERVICE_CATALOG_CACHE_TTL_MS } from "../../../repository/firestore/shop/shop-service-catalog-factory.js";
import { toPublicStoreId, toStoreResponse } from "../stores/store-response.js";
import { toShopServiceListItem } from "./service-response.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";

const SERVICE_ERRORS = {
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/service-catalog/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/service-catalog/forbidden-store",
    message: "Forbidden: store access denied",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/service-catalog/invalid-request",
    message: "Invalid request",
  },
  storeNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/service-catalog/store-not-found",
    message: "Store not found",
  },
};

export const getShopServiceCatalog = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const requestedStoreId = getStoreIdFromUrlPath(req)?.trim();

  if (!can(authContext.role, "service:read")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  if (!requestedStoreId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "missing storeId",
      role: authContext.role,
    });
  }

  if (!canAccessStore(authContext, requestedStoreId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      storeId: requestedStoreId,
      role: authContext.role,
    });
  }

  try {
    const [store, catalog] = await Promise.all([
      firestoreRepository.shop.store.getStore(authContext.ownerId, requestedStoreId),
      firestoreRepository.shop.service.getShopServiceCatalog(
        authContext.ownerId,
        requestedStoreId,
      ),
    ]);
    const groups = catalog.groups.map((group) => {
      const services = group.services.map((service) => ({
        ...toShopServiceListItem(service),
        storeName: store.name,
        storeId: toPublicStoreId(store.id),
        serviceGroupId: group.id,
        serviceGroupName: group.name,
      }));

      return {
        id: group.id,
        name: group.name,
        label: group.label,
        category: group.category,
        sortOrder: group.sortOrder,
        serviceCount: services.length,
        services,
      };
    });
    const services = groups.flatMap((group) => group.services);

    return sendCacheableJson(
      req,
      res,
      {
        store: toStoreResponse(store),
        catalog: {
          id: catalog.id,
          ownerId: authContext.ownerId,
          storeId: toPublicStoreId(catalog.storeId),
          version: catalog.version,
          groupCount: groups.length,
          serviceCount: services.length,
          groups,
          updatedAt: catalog.updatedAt,
        },
        groups,
        services,
        meta: {
          ownerId: authContext.ownerId,
          storeId: toPublicStoreId(requestedStoreId),
          version: catalog.version,
          groupCount: groups.length,
          serviceCount: services.length,
          latestUpdatedAt: catalog.updatedAt,
          serverCacheTtlMs: SERVICE_CATALOG_CACHE_TTL_MS,
          httpCacheControl: "private, max-age=300, stale-while-revalidate=600",
        },
      },
      {
        cacheControl: "private, max-age=300, stale-while-revalidate=600",
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
