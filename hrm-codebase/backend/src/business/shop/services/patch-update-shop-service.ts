import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import {
  isValidShopServiceDurationRange,
  normalizeShopServicePayload,
  updateShopServiceSchema,
} from "./service-shared.js";
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
    message: "Invalid service request",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/services/forbidden-store",
    message: "Forbidden: store access denied",
  },
  serviceNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/services/service-not-found",
    message: "Service not found",
  },
};

export const updateShopService = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const serviceIdParameter = req.params["serviceId"];
  const serviceId = typeof serviceIdParameter === "string" ? serviceIdParameter.trim() : undefined;
  const requestedStoreId = getStoreIdFromUrlPath(req)?.trim();

  if (!can(authContext.role, "service:manage")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  if (!serviceId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, { reason: "missing serviceId" });
  }

  if (!requestedStoreId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, { reason: "missing storeId" });
  }

  const updateServiceParseResult = updateShopServiceSchema.safeParse(req.body);

  if (!updateServiceParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: updateServiceParseResult.error.flatten().fieldErrors,
    });
  }

  if (!canAccessStore(authContext, requestedStoreId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      storeId: requestedStoreId,
      role: authContext.role,
    });
  }

  try {
    const existingService = await firestoreRepository.shop.service.getShopService(
      authContext.ownerId,
      serviceId,
      requestedStoreId,
    );

    if (requestedStoreId !== existingService.storeId) {
      return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
        routeStoreId: requestedStoreId,
        serviceStoreId: existingService.storeId,
      });
    }

    const store = await firestoreRepository.shop.store.getStore(
      authContext.ownerId,
      existingService.storeId,
    );

    if (store.status !== "active") {
      return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
        reason: "store not active",
        storeId: store.id,
      });
    }

    const normalizedPayload = normalizeShopServicePayload(updateServiceParseResult.data);
    const nextDurationMin = normalizedPayload.durationMin ?? existingService.durationMin;
    const nextDurationMax = normalizedPayload.durationMax ?? existingService.durationMax;

    if (!isValidShopServiceDurationRange(nextDurationMin, nextDurationMax)) {
      return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
        reason: "invalid duration range",
      });
    }

    const updatedService = await firestoreRepository.shop.service.updateShopService(
      authContext.ownerId,
      serviceId,
      {
        ...(normalizedPayload.name !== undefined && { name: normalizedPayload.name }),
        ...(normalizedPayload.description !== undefined && {
          description: normalizedPayload.description,
        }),
        ...(normalizedPayload.groupService !== undefined && {
          groupService: normalizedPayload.groupService,
        }),
        ...(normalizedPayload.price !== undefined && { price: normalizedPayload.price }),
        ...(normalizedPayload.category !== undefined && { category: normalizedPayload.category }),
        ...(normalizedPayload.durationMin !== undefined && {
          durationMin: normalizedPayload.durationMin,
        }),
        ...(normalizedPayload.durationMax !== undefined && {
          durationMax: normalizedPayload.durationMax,
        }),
        updatedByUserId: authContext.uid,
      },
      requestedStoreId,
    );
    const updatedFields = Object.keys(updateServiceParseResult.data).filter(
      (field) => !["image", "images", "imageUrls"].includes(field),
    );

    await writeShopAuditLog({
      ownerId: authContext.ownerId,
      eventType: "service_updated",
      entityType: "service",
      entityId: serviceId,
      storeId: store.id,
      actor: {
        uid: authContext.uid,
        role: authContext.role,
      },
      metadata: {
        updatedFields,
        storeId: store.id,
        storeName: store.name,
        ...(normalizedPayload.name !== undefined && { name: normalizedPayload.name }),
        ...(normalizedPayload.groupService !== undefined && {
          groupService: normalizedPayload.groupService,
        }),
        ...(normalizedPayload.category !== undefined && { category: normalizedPayload.category }),
        ...(normalizedPayload.price !== undefined && { price: normalizedPayload.price }),
        ...(normalizedPayload.durationMin !== undefined && {
          durationMin: normalizedPayload.durationMin,
        }),
        ...(normalizedPayload.durationMax !== undefined && {
          durationMax: normalizedPayload.durationMax,
        }),
      },
    });

    return res.status(StatusCodes.OK).json({
      item: toShopServiceListItem(updatedService),
      meta: {
        storeId: store.id,
        updatedFields,
      },
    });
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_ERRORS.serviceNotFound, { serviceId });
    }

    throw error;
  }
};
