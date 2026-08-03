import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";

const ERRORS = {
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/customers/forbidden-role",
    message: "Forbidden: customer access denied",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/customers/forbidden-store",
    message: "Forbidden: store access denied",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/customers/invalid-request",
    message: "Invalid customer request",
  },
  notFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/customers/not-found",
    message: "Customer not found",
  },
};

export const unblockCustomer = async (request: Request, response: Response) => {
  const authContext = await verifyAuthorizationHeader(request.headers["authorization"]);
  if (!can(authContext.role, "customer:block")) {
    return createErrorResponse(response, ERRORS.forbiddenRole, { role: authContext.role });
  }

  const storeId = getStoreIdFromUrlPath(request);
  const customerId =
    typeof request.params["customerId"] === "string" ? request.params["customerId"].trim() : "";
  if (!storeId || !customerId) {
    return createErrorResponse(response, ERRORS.invalidRequest, { storeId, customerId });
  }
  if (!canAccessStore(authContext, storeId)) {
    return createErrorResponse(response, ERRORS.forbiddenStore, {
      storeId,
      role: authContext.role,
    });
  }

  try {
    const customer = await firestoreRepository.shop.customer.unblockShopCustomer(
      authContext.ownerId,
      storeId,
      customerId,
      { userId: authContext.uid, role: authContext.role === "manager" ? "manager" : "owner" },
    );
    return response.status(StatusCodes.OK).json({ item: customer, meta: { storeId, customerId } });
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(response, ERRORS.notFound, { customerId });
    }
    throw error;
  }
};
