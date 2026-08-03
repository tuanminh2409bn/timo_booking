import { FieldValue, type DocumentSnapshot, type Firestore } from "@google-cloud/firestore";
import { DB_NOT_FOUND, FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import {
  cacheDelete,
  cacheDeleteByPrefix,
  cacheGetJson,
  cacheSetJson,
} from "../../cache/cache-client.js";
import { getOwnerHomeSummaryResponseCachePrefix } from "../../../helpers/cache-keys.js";
import { logger } from "../../../modules/logger.js";
import type { StoreType } from "./shop.types.js";
import { reservePublicCode } from "../public-code.js";
import { mapStoreDocumentToStore } from "../store-document-mapper.js";

// A store's Firestore doc id IS its public code (e.g. `S-1`), so a store is resolved by a
// direct owner-scoped doc lookup — no separate code field / code query needed.
const resolveOwnerScopedStoreDocument = async (
  firestoreDB: Firestore,
  ownerId: string,
  storeId: string,
): Promise<DocumentSnapshot | undefined> => {
  const storeDocument = await getStoreCollection(firestoreDB).doc(storeId).get();

  if (!storeDocument.exists) {
    return undefined;
  }

  const data = storeDocument.data() as { ownerId?: string } | undefined;
  return data?.ownerId === ownerId ? storeDocument : undefined;
};

const STORE_CACHE_TTL_MS = 60_000;
const getStoreCacheKey = (ownerId: string) => `store:${ownerId}:store:list`;
const getStoreSummaryCacheKey = (ownerId: string) => `store:${ownerId}:store:summary-list`;

const invalidateStoreCache = (ownerId: string) =>
  Promise.all([
    cacheDelete(getStoreCacheKey(ownerId)),
    cacheDelete(getStoreSummaryCacheKey(ownerId)),
    cacheDeleteByPrefix(getOwnerHomeSummaryResponseCachePrefix(ownerId)),
  ]);

const getStoreCollection = (firestoreDB: Firestore) => firestoreDB.collection("stores");

export const createStoreFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeData: Omit<StoreType, "id" | "ownerId" | "createdAt" | "updatedAt">,
  ): Promise<string> => {
    // The reserved public code (e.g. `S-1`) is used directly as the store's Firestore doc id.
    const code = await reservePublicCode(firestoreDB, "shop");
    const storeDocument = getStoreCollection(firestoreDB).doc(code);
    const timestamp = Date.now();

    await storeDocument.set({
      id: storeDocument.id,
      storeId: storeDocument.id,
      ownerId,
      ...storeData,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await invalidateStoreCache(ownerId);

    return storeDocument.id;
  };
};

export type StoreListCacheStatus = "hit" | "miss";

export type StoreListResult = {
  stores: StoreType[];
  cacheStatus: StoreListCacheStatus;
};

export const getStoreListWithMetadataFactory = (firestoreDB: Firestore) => {
  return async (ownerId: string): Promise<StoreListResult> => {
    const start = performance.now();
    const cachedStores = await cacheGetJson<StoreType[]>(getStoreCacheKey(ownerId));

    if (cachedStores !== undefined) {
      logger.info(
        {
          ownerId,
          source: "cache",
          storeCount: cachedStores.length,
          durationMs: Math.round((performance.now() - start) * 100) / 100,
        },
        "store list loaded",
      );

      return { stores: cachedStores, cacheStatus: "hit" };
    }

    const snapshot = await getStoreCollection(firestoreDB).where("ownerId", "==", ownerId).get();
    const stores = snapshot.docs
      .map((doc) => mapStoreDocumentToStore<StoreType>(doc, ownerId))
      .sort((left, right) => left.name.localeCompare(right.name));

    await cacheSetJson(getStoreCacheKey(ownerId), stores, STORE_CACHE_TTL_MS);

    logger.info(
      {
        ownerId,
        source: "firestore",
        storeCount: stores.length,
        durationMs: Math.round((performance.now() - start) * 100) / 100,
      },
      "store list loaded",
    );

    return { stores, cacheStatus: "miss" };
  };
};

export const getStoreListFactory = (firestoreDB: Firestore) => {
  const getStoreListWithMetadata = getStoreListWithMetadataFactory(firestoreDB);

  return async (ownerId: string): Promise<StoreType[]> => {
    const result = await getStoreListWithMetadata(ownerId);
    return result.stores;
  };
};

export const getStoreSummaryListFactory = (firestoreDB: Firestore) => {
  return async (ownerId: string): Promise<StoreType[]> => {
    const cacheKey = getStoreSummaryCacheKey(ownerId);
    const cachedStores = await cacheGetJson<StoreType[]>(cacheKey);

    if (cachedStores !== undefined) {
      return cachedStores;
    }

    const snapshot = await getStoreCollection(firestoreDB)
      .where("ownerId", "==", ownerId)
      .select(
        "id",
        "ownerId",
        "name",
        "address",
        "openTime",
        "closeTime",
        "settlementCutoffTime",
        "timezone",
        "status",
        "employeeCount",
        "createdAt",
        "updatedAt",
      )
      .get();

    const stores = snapshot.docs
      .map((doc) => mapStoreDocumentToStore<StoreType>(doc, ownerId))
      .sort((left, right) => left.name.localeCompare(right.name));

    await cacheSetJson(cacheKey, stores, STORE_CACHE_TTL_MS);

    return stores;
  };
};

export const getStoreFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    options: { skipCache?: boolean } = {},
  ): Promise<StoreType> => {
    if (options.skipCache !== true) {
      const cachedStores = await cacheGetJson<StoreType[]>(getStoreCacheKey(ownerId));
      const cachedStore = cachedStores?.find((store) => store.id === storeId);

      if (cachedStore) {
        return cachedStore;
      }
    }

    const storeDocument = await resolveOwnerScopedStoreDocument(firestoreDB, ownerId, storeId);

    if (!storeDocument) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.store);
    }

    return mapStoreDocumentToStore<StoreType>(storeDocument, ownerId);
  };
};

export const updateStoreFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    storeData: Partial<Omit<StoreType, "id" | "ownerId" | "createdAt" | "updatedAt">>,
  ): Promise<void> => {
    const storeDocument = await resolveOwnerScopedStoreDocument(firestoreDB, ownerId, storeId);

    if (!storeDocument) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.store);
    }

    try {
      await storeDocument.ref.update({
        ...storeData,
        updatedAt: Date.now(),
      });

      await invalidateStoreCache(ownerId);
    } catch (error) {
      const isNotFoundError =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: number }).code === 5;

      if (isNotFoundError) {
        throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.store);
      }

      throw error;
    }
  };
};

export type StoreEmployeeCountDelta = {
  employeeCount?: number;
  activeEmployeeCount?: number;
  inactiveEmployeeCount?: number;
};

export const adjustStoreEmployeeCountsFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    delta: StoreEmployeeCountDelta,
  ): Promise<void> => {
    const storeDocument = await resolveOwnerScopedStoreDocument(firestoreDB, ownerId, storeId);

    if (!storeDocument) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.store);
    }

    const updatePayload: Record<string, FieldValue | number> = {
      updatedAt: Date.now(),
    };

    if (delta.employeeCount) {
      updatePayload["employeeCount"] = FieldValue.increment(delta.employeeCount);
    }

    if (delta.activeEmployeeCount) {
      updatePayload["activeEmployeeCount"] = FieldValue.increment(delta.activeEmployeeCount);
    }

    if (delta.inactiveEmployeeCount) {
      updatePayload["inactiveEmployeeCount"] = FieldValue.increment(delta.inactiveEmployeeCount);
    }

    if (Object.keys(updatePayload).length === 1) {
      return;
    }

    try {
      await storeDocument.ref.update(updatePayload);
      await invalidateStoreCache(ownerId);
    } catch (error) {
      const isNotFoundError =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: number }).code === 5;

      if (isNotFoundError) {
        throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.store);
      }

      throw error;
    }
  };
};
