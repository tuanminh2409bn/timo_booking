import type { Request, Response } from "express";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { toStoreResponse } from "./store-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";

const SERVICE_ERRORS = {
  forbiddenStore: {
    statusCode: 403,
    type: "/stores/forbidden-store",
    message: "Forbidden: store access denied",
  },
  invalidRequest: {
    statusCode: 400,
    type: "/stores/invalid-request",
    message: "Invalid request",
  },
};

export const getStoreDetail = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const storeId = req.params["storeId"];

  if (typeof storeId !== "string" || !storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, { reason: "missing storeId" });
  }

  if (!canAccessStore(authContext, storeId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      storeId,
      role: authContext.role,
    });
  }

  const store = await firestoreRepository.shop.store.getStore(authContext.ownerId, storeId);

  return sendCacheableJson(
    req,
    res,
    {
      store: toStoreResponse(store),
    },
    {
      cacheControl: "private, max-age=30, stale-while-revalidate=60",
    },
  );
};
