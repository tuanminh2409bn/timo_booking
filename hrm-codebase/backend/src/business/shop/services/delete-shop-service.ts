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
  serviceNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/services/service-not-found",
    message: "Service not found",
  },
};

export const deleteShopService = async (req: Request, res: Response) => {
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
      return createErrorResponse(res, SERVICE_ERRORS.serviceNotFound, {
        routeStoreId: requestedStoreId,
        serviceId,
      });
    }

    const store = await firestoreRepository.shop.store.getStore(
      authContext.ownerId,
      existingService.storeId,
    );

    await firestoreRepository.shop.service.deleteShopService(
      authContext.ownerId,
      serviceId,
      requestedStoreId,
    );
    await writeShopAuditLog({
      ownerId: authContext.ownerId,
      eventType: "service_deleted",
      entityType: "service",
      entityId: serviceId,
      storeId: store.id,
      actor: {
        uid: authContext.uid,
        role: authContext.role,
      },
      metadata: {
        storeId: store.id,
        storeName: store.name,
        name: existingService.name,
      },
    });

    return res.status(StatusCodes.NO_CONTENT).send();
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_ERRORS.serviceNotFound, { serviceId });
    }

    throw error;
  }
};
