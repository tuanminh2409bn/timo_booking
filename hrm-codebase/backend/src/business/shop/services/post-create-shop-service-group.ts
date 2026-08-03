import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import {
  createShopServiceGroupSchema,
  normalizeShopServiceGroupPayload,
} from "./service-shared.js";
import { toShopServiceGroupItem } from "./service-response.js";

const SERVICE_GROUP_ERRORS = {
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/service-groups/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/service-groups/invalid-request",
    message: "Invalid request",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/service-groups/forbidden-store",
    message: "Forbidden: store access denied",
  },
  storeNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/service-groups/store-not-found",
    message: "Store not found",
  },
};

export const createShopServiceGroup = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (!can(authContext.role, "service:manage")) {
    return createErrorResponse(res, SERVICE_GROUP_ERRORS.forbiddenRole, {
      role: authContext.role,
    });
  }

  const createServiceGroupParseResult = createShopServiceGroupSchema.safeParse(
    mergeUrlPathStoreId(req, req.body),
  );

  if (!createServiceGroupParseResult.success) {
    return createErrorResponse(res, SERVICE_GROUP_ERRORS.invalidRequest, {
      validation: createServiceGroupParseResult.error.flatten().fieldErrors,
    });
  }

  const requestedStoreId = createServiceGroupParseResult.data.storeId;

  if (!canAccessStore(authContext, requestedStoreId)) {
    return createErrorResponse(res, SERVICE_GROUP_ERRORS.forbiddenStore, {
      role: authContext.role,
      storeId: requestedStoreId,
    });
  }

  try {
    const normalizedPayload = normalizeShopServiceGroupPayload(createServiceGroupParseResult.data);
    const store = await firestoreRepository.shop.store.getStore(
      authContext.ownerId,
      normalizedPayload.storeId,
    );

    if (store.status !== "active") {
      return createErrorResponse(res, SERVICE_GROUP_ERRORS.invalidRequest, {
        reason: "store not active",
        storeId: store.id,
      });
    }

    const serviceCategoryResult = await firestoreRepository.shop.service.createShopServiceCategory(
      authContext.ownerId,
      {
        storeId: store.id,
        name: normalizedPayload.name,
        label: normalizedPayload.label,
        category: normalizedPayload.category,
      },
    );

    if (serviceCategoryResult.created) {
      await writeShopAuditLog({
        ownerId: authContext.ownerId,
        eventType: "service_group_created",
        entityType: "service_group",
        entityId: serviceCategoryResult.category.id,
        storeId: store.id,
        actor: {
          uid: authContext.uid,
          role: authContext.role,
        },
        metadata: {
          name: serviceCategoryResult.category.name,
          category: serviceCategoryResult.category.category,
          storeId: store.id,
          storeName: store.name,
        },
      });
    }

    return res
      .status(serviceCategoryResult.created ? StatusCodes.CREATED : StatusCodes.OK)
      .json({
        item: toShopServiceGroupItem(serviceCategoryResult.category),
        meta: {
          storeId: store.id,
          created: serviceCategoryResult.created,
        },
      });
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_GROUP_ERRORS.storeNotFound, {
        storeId: createServiceGroupParseResult.data.storeId,
      });
    }

    throw error;
  }
};
