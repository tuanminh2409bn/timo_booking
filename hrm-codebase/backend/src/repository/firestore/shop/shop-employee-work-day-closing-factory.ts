import type { Firestore, Query } from "@google-cloud/firestore";
import { WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS } from "../../../business/employee/work-days/work-day-settlement-tracing-contract.js";
import { withWorkDaySettlementSpan } from "../../../business/employee/work-days/work-day-settlement-observability.js";
import { FirestoreDataExistingError } from "../../../constants/firestore-error.js";
import {
  getEmployeeWorkDayClosingRangeCacheKey,
  getEmployeeWorkDayClosingRangeCachePrefix,
  getEmployeeReportResponseCachePrefix,
  getOwnerHomeSummaryResponseCachePrefix,
} from "../../../helpers/cache-keys.js";
import {
  cacheDeleteByPrefix,
  cacheGetJson,
  cacheSetJson,
  runSingleFlight,
} from "../../cache/cache-client.js";
import { getStoreSubcollection } from "../collection-paths.js";
import { isMissingCompositeIndexError } from "../firestore-errors.js";
import {
  isStoreScopedDocumentData,
  mapStoreScopedDocumentToShopData,
  toStoreScopedWritePayload,
} from "../store-document-mapper.js";
import type { ShopEmployeeWorkDayClosingType } from "./shop.types.js";
import {
  notifyWorkDaySettlementCommit,
  type WorkDaySettlementCommitObserver,
  type WorkDaySettlementPersistAction,
} from "./work-day-settlement-commit-observer.js";

const EMPLOYEE_WORK_DAY_CLOSINGS_SUBCOLLECTION = "employee_work_day_closings";
export const EMPLOYEE_WORK_DAY_CLOSING_RANGE_CACHE_TTL_MS = 30_000;

const getEmployeeWorkDayClosings = (firestoreDB: Firestore, storeId: string) =>
  getStoreSubcollection(firestoreDB, storeId, EMPLOYEE_WORK_DAY_CLOSINGS_SUBCOLLECTION);

export const getEmployeeWorkDayClosingDocumentId = (
  employeeUserId: string,
  workDate: string,
): string => `${employeeUserId}__${workDate}`;

const getStoreDateRangeSnapshot = async (
  collection: Query,
  fromWorkDate: string,
  toWorkDate: string,
) => {
  try {
    return await collection
      .where("workDate", ">=", fromWorkDate)
      .where("workDate", "<=", toWorkDate)
      .get();
  } catch (error) {
    if (!isMissingCompositeIndexError(error)) throw error;
    return collection.get();
  }
};

const isClosingInScope = (
  data: Record<string, unknown>,
  ownerId: string,
  storeId: string,
  fromWorkDate: string,
  toWorkDate: string,
): boolean =>
  data["ownerId"] === ownerId &&
  data["storeId"] === storeId &&
  typeof data["workDate"] === "string" &&
  data["workDate"] >= fromWorkDate &&
  data["workDate"] <= toWorkDate;

export const getShopEmployeeWorkDayClosingFactory =
  (firestoreDB: Firestore) =>
  async (
    ownerId: string,
    storeId: string,
    workDate: string,
    employeeUserId: string,
  ): Promise<ShopEmployeeWorkDayClosingType | null> => {
    const document = await getEmployeeWorkDayClosings(firestoreDB, storeId)
      .doc(getEmployeeWorkDayClosingDocumentId(employeeUserId, workDate))
      .get();
    const data = document.data();

    if (
      !document.exists ||
      !isStoreScopedDocumentData(data, ownerId, storeId) ||
      data?.["workDate"] !== workDate ||
      data["employeeUserId"] !== employeeUserId
    ) {
      return null;
    }

    return mapStoreScopedDocumentToShopData<ShopEmployeeWorkDayClosingType>(document, ownerId);
  };

export const listShopEmployeeWorkDayClosingsByStoreWorkDateFactory = (firestoreDB: Firestore) => {
  const listEmployeeWorkDayClosingsByStoreDateRange =
    listShopEmployeeWorkDayClosingsByStoreDateRangeFactory(firestoreDB);

  return async (
    ownerId: string,
    storeId: string,
    workDate: string,
    options: { skipCache?: boolean } = {},
  ): Promise<ShopEmployeeWorkDayClosingType[]> =>
    listEmployeeWorkDayClosingsByStoreDateRange(ownerId, storeId, workDate, workDate, options);
};

export const listShopEmployeeWorkDayClosingsByStoreDateRangeFactory =
  (firestoreDB: Firestore) =>
  async (
    ownerId: string,
    storeId: string,
    fromWorkDate: string,
    toWorkDate: string,
    options: { skipCache?: boolean } = {},
  ): Promise<ShopEmployeeWorkDayClosingType[]> => {
    const cacheKey = getEmployeeWorkDayClosingRangeCacheKey(
      ownerId,
      storeId,
      fromWorkDate,
      toWorkDate,
    );

    if (options.skipCache !== true) {
      const cachedClosings = await cacheGetJson<ShopEmployeeWorkDayClosingType[]>(cacheKey);

      if (cachedClosings !== undefined) {
        return cachedClosings;
      }
    }

    const singleFlightKey = options.skipCache === true ? `${cacheKey}:direct` : cacheKey;

    return runSingleFlight(singleFlightKey, async () => {
      if (options.skipCache !== true) {
        const closingsCachedByAnotherRequest =
          await cacheGetJson<ShopEmployeeWorkDayClosingType[]>(cacheKey);

        if (closingsCachedByAnotherRequest !== undefined) {
          return closingsCachedByAnotherRequest;
        }
      }

      const snapshot = await getStoreDateRangeSnapshot(
        getEmployeeWorkDayClosings(firestoreDB, storeId).where("ownerId", "==", ownerId),
        fromWorkDate,
        toWorkDate,
      );

      const closings = snapshot.docs
        .filter((document) =>
          isClosingInScope(document.data(), ownerId, storeId, fromWorkDate, toWorkDate),
        )
        .map((document) =>
          mapStoreScopedDocumentToShopData<ShopEmployeeWorkDayClosingType>(document, ownerId),
        )
        .sort(
          (left, right) =>
            left.workDate.localeCompare(right.workDate) ||
            left.employeeUserId.localeCompare(right.employeeUserId),
        );

      if (options.skipCache !== true) {
        await cacheSetJson(cacheKey, closings, EMPLOYEE_WORK_DAY_CLOSING_RANGE_CACHE_TTL_MS);
      }

      return closings;
    });
  };

export const closeShopEmployeeWorkDayFactory =
  (firestoreDB: Firestore) =>
  async (
    ownerId: string,
    data: Omit<ShopEmployeeWorkDayClosingType, "id" | "ownerId" | "createdAt" | "updatedAt">,
    options: {
      onCommitted?: WorkDaySettlementCommitObserver;
      persistAction?: WorkDaySettlementPersistAction;
    } = {},
  ): Promise<ShopEmployeeWorkDayClosingType> => {
    const timestamp = Date.now();
    const id = getEmployeeWorkDayClosingDocumentId(data.employeeUserId, data.workDate);
    const closing: ShopEmployeeWorkDayClosingType = {
      id,
      ownerId,
      ...data,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await withWorkDaySettlementSpan(
      WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.employeeClosingPersist,
      {
        "app.store_id": data.storeId,
        "settlement.work_date": data.workDate,
      },
      async () => {
        const closingDocument = getEmployeeWorkDayClosings(firestoreDB, data.storeId).doc(id);
        const writePayload = toStoreScopedWritePayload(ownerId, closing);

        try {
          if (options.persistAction === "create") {
            await closingDocument.create(writePayload);
            return;
          }

          await closingDocument.set(writePayload);
        } catch (error) {
          if (options.persistAction === "create" && (error as { code?: number }).code === 6) {
            throw new FirestoreDataExistingError("Employee work-day closing already exists");
          }

          throw error;
        }
      },
    );

    notifyWorkDaySettlementCommit(options.onCommitted, {
      stage: "employee_closing",
      persistAction: options.persistAction ?? "overwrite",
    });

    await withWorkDaySettlementSpan(
      WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.cacheInvalidate,
      {
        "app.store_id": data.storeId,
        "settlement.work_date": data.workDate,
        "settlement.post_write_phase": "cache_invalidation",
        "settlement.cache_group_count": 3,
      },
      async () => {
        await Promise.all([
          cacheDeleteByPrefix(getEmployeeWorkDayClosingRangeCachePrefix(ownerId, data.storeId)),
          cacheDeleteByPrefix(getEmployeeReportResponseCachePrefix(ownerId)),
          cacheDeleteByPrefix(getOwnerHomeSummaryResponseCachePrefix(ownerId)),
        ]);
      },
    );

    return closing;
  };

export const deleteShopEmployeeWorkDayClosingFactory =
  (firestoreDB: Firestore) =>
  async (
    ownerId: string,
    storeId: string,
    workDate: string,
    employeeUserId: string,
  ): Promise<void> => {
    const id = getEmployeeWorkDayClosingDocumentId(employeeUserId, workDate);
    const closingDocument = getEmployeeWorkDayClosings(firestoreDB, storeId).doc(id);
    const snapshot = await closingDocument.get();
    const data = snapshot.data();

    if (
      !snapshot.exists ||
      !isStoreScopedDocumentData(data, ownerId, storeId) ||
      data?.["workDate"] !== workDate ||
      data?.["employeeUserId"] !== employeeUserId
    ) {
      return;
    }

    await closingDocument.delete();
    await Promise.all([
      cacheDeleteByPrefix(getEmployeeWorkDayClosingRangeCachePrefix(ownerId, storeId)),
      cacheDeleteByPrefix(getEmployeeReportResponseCachePrefix(ownerId)),
      cacheDeleteByPrefix(getOwnerHomeSummaryResponseCachePrefix(ownerId)),
    ]);
  };
