import type { Request, Response } from "express";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { isOwner } from "../../../helpers/role-access.js";
import { toStoreListResponse } from "./store-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";

export const getStore = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const stores = await firestoreRepository.shop.store.getStoreSummaryList(authContext.ownerId);
  const storesWithinCallerScope = !isOwner(authContext.role)
    ? stores.filter((store) => store.id === authContext.storeId)
    : stores;
  const responseStores = storesWithinCallerScope.map((store) => toStoreListResponse(store));

  return sendCacheableJson(
    req,
    res,
    {
      stores: responseStores,
    },
    {
      cacheControl: "private, max-age=30, stale-while-revalidate=60",
    },
  );
};
