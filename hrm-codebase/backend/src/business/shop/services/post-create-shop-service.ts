import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import {
  createShopServiceSchema,
  isValidShopServiceDurationRange,
  normalizeShopServicePayload,
} from "./service-shared.js";
import { toShopServiceListItem } from "./service-response.js";
import { mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";

const SERVICE_ERRORS = {
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/services/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/services/invalid-request",
    message: "Invalid service request",
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

export const createShopService = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (!can(authContext.role, "service:manage")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  const createServiceParseResult = createShopServiceSchema.safeParse(
    mergeUrlPathStoreId(req, req.body),
  );

  if (!createServiceParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: createServiceParseResult.error.flatten().fieldErrors,
    });
  }

  if (!canAccessStore(authContext, createServiceParseResult.data.storeId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      role: authContext.role,
      storeId: createServiceParseResult.data.storeId,
    });
  }

  try {
    const normalizedPayload = normalizeShopServicePayload(createServiceParseResult.data);
    const store = await firestoreRepository.shop.store.getStore(
      authContext.ownerId,
      createServiceParseResult.data.storeId,
    );

    if (store.status !== "active") {
      return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
        reason: "store not active",
        storeId: store.id,
      });
    }

    if (
      normalizedPayload.price === undefined ||
      normalizedPayload.category === undefined ||
      normalizedPayload.durationMin === undefined ||
      normalizedPayload.durationMax === undefined ||
      !isValidShopServiceDurationRange(normalizedPayload.durationMin, normalizedPayload.durationMax)
    ) {
      return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
        reason: "invalid service pricing or duration",
      });
    }

    const createdService = await firestoreRepository.shop.service.createShopService(
      authContext.ownerId,
      {
        storeId: store.id,
        name: createServiceParseResult.data.name,
        ...(normalizedPayload.displayName !== undefined && {
          displayName: normalizedPayload.displayName,
        }),
        ...(normalizedPayload.description !== undefined && {
          description: normalizedPayload.description,
        }),
        type: "predefined",
        category: normalizedPayload.category,
        price: normalizedPayload.price,
        ...(normalizedPayload.groupService !== undefined && {
          groupService: normalizedPayload.groupService,
        }),
        durationMin: normalizedPayload.durationMin,
        durationMax: normalizedPayload.durationMax,
        ...(normalizedPayload.preferredWorkerType !== undefined && {
          preferredWorkerType: normalizedPayload.preferredWorkerType,
        }),
        ...(normalizedPayload.bookingKind !== undefined && {
          bookingKind: normalizedPayload.bookingKind,
        }),
        availableForBooking: normalizedPayload.availableForBooking ?? true,
        createdByUserId: authContext.uid,
        updatedByUserId: authContext.uid,
      },
    );

    await writeShopAuditLog({
      ownerId: authContext.ownerId,
      eventType: "service_created",
      entityType: "service",
      entityId: createdService.id,
      storeId: store.id,
      actor: {
        uid: authContext.uid,
        role: authContext.role,
      },
      metadata: {
        name: createServiceParseResult.data.name,
        ...(normalizedPayload.displayName !== undefined && {
          displayName: normalizedPayload.displayName,
        }),
        storeId: store.id,
        storeName: store.name,
        ...(normalizedPayload.groupService !== undefined && {
          groupService: normalizedPayload.groupService,
        }),
        category: normalizedPayload.category,
        price: normalizedPayload.price,
        durationMin: normalizedPayload.durationMin,
        durationMax: normalizedPayload.durationMax,
      },
    });

    return res.status(StatusCodes.CREATED).json({
      item: toShopServiceListItem(createdService),
      meta: {
        storeId: store.id,
      },
    });
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_ERRORS.storeNotFound, {
        storeId: createServiceParseResult.data.storeId,
      });
    }

    throw error;
  }
};
