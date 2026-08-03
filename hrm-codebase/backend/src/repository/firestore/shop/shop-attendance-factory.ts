import type { Firestore, Query } from "@google-cloud/firestore";
import { FieldValue } from "@google-cloud/firestore";
import { DB_NOT_FOUND, FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import {
  ATTENDANCE_TRACE_CHILD_SPANS,
  ATTENDANCE_TRACE_EVENTS,
} from "../../../business/employee/attendance/attendance-tracing-contract.js";
import {
  cacheDelete,
  cacheDeleteByPrefix,
  cacheGetJson,
  cacheSetJson,
  runSingleFlight,
} from "../../cache/cache-client.js";
import {
  getAttendanceCalendarRangeCacheKey,
  getAttendanceCalendarRangeCachePrefix,
  getAttendanceDetailCacheKey,
  getAttendanceRangeCacheKey as getStoreAttendanceRangeCacheKey,
  getAttendanceRangeCachePrefix as getStoreAttendanceRangeCachePrefix,
  getEmployeeWorkDayClosingRangeCachePrefix,
  getEmployeeReportResponseCachePrefix,
  getOwnerHomeSummaryResponseCachePrefix,
} from "../../../helpers/cache-keys.js";
import type {
  ShopAttendanceAssigneeType,
  ShopAttendanceCalendarType,
  ShopAttendanceType,
  ShopServiceType,
} from "./shop.types.js";
import { isMissingCompositeIndexError } from "../firestore-errors.js";
import { getCollectionGroup, getStoreSubcollection } from "../collection-paths.js";
import {
  isStoreScopedDocumentData,
  mapStoreScopedDocumentToShopData,
  toStoreScopedWritePayload,
} from "../store-document-mapper.js";
import { reservePublicCode } from "../public-code.js";
import { logger } from "../../../modules/logger.js";
import {
  addAttendanceRepositorySpanEvent,
  readAttendanceCache,
  setAttendanceRepositorySpanAttributes,
  withAttendanceRepositorySpan,
  writeAttendanceCache,
} from "./shop-attendance-observability.js";

export type ShopAttendanceHomeSummaryType = Pick<
  ShopAttendanceType,
  | "id"
  | "storeId"
  | "storeWorkDateKey"
  | "workDate"
  | "startTime"
  | "subtotalAmount"
  | "totalAmount"
  | "bookingStatus"
>;

export type ShopAttendanceCancellationMetricType = {
  workDate: string;
  cancelledCount: number;
};

const computeAttendanceAssigneeUserIds = (
  createdBy: string,
  assignees: ShopAttendanceAssigneeType[],
  services: ShopServiceType[],
): string[] => {
  const ids = new Set<string>();
  ids.add(createdBy);
  assignees.forEach((a) => ids.add(a.employeeUserId));
  services.forEach((s) => (s.employees ?? []).forEach((e) => ids.add(e.employeeUserId)));
  return Array.from(ids);
};

const ATTENDANCES_SUBCOLLECTION = "attendances";

const getStoreAttendances = (firestoreDB: Firestore, storeId: string) =>
  getStoreSubcollection(firestoreDB, storeId, ATTENDANCES_SUBCOLLECTION);

const getAttendanceGroup = (firestoreDB: Firestore) =>
  getCollectionGroup(firestoreDB, ATTENDANCES_SUBCOLLECTION);

const ATTENDANCE_LIST_CACHE_TTL_MS = 30_000;
const ATTENDANCE_DETAIL_CACHE_TTL_MS = 30_000;

const getAttendanceListCacheKey = (ownerId: string, storeWorkDateKey: string) =>
  `store:${ownerId}:attendance:list:${storeWorkDateKey}`;
const getAttendanceWorkDateRangeCachePrefix = (ownerId: string) =>
  `store:${ownerId}:attendance:range:`;
const getAttendanceWorkDateRangeCacheKey = (ownerId: string, startDate: string, endDate: string) =>
  `${getAttendanceWorkDateRangeCachePrefix(ownerId)}${startDate}:${endDate}`;
const getStoreAttendanceSummaryRangeCacheKey = (
  ownerId: string,
  storeId: string,
  fromWorkDate: string,
  toWorkDate: string,
) => `store:${ownerId}:attendance:summary-range:${storeId}:${fromWorkDate}:${toWorkDate}`;
const getStoreAttendanceSummaryRangeCachePrefix = (ownerId: string, storeId: string) =>
  `store:${ownerId}:attendance:summary-range:${storeId}:`;
const getStoreAttendanceCancellationRangeCachePrefix = (ownerId: string, storeId: string) =>
  `store:${ownerId}:attendance:cancellation-range:${storeId}:`;
const getStoreAttendanceCancellationRangeCacheKey = (
  ownerId: string,
  storeId: string,
  fromWorkDate: string,
  toWorkDate: string,
) =>
  `${getStoreAttendanceCancellationRangeCachePrefix(ownerId, storeId)}${fromWorkDate}:${toWorkDate}`;
const getEmployeeAttendanceRangeCacheKey = (
  ownerId: string,
  storeId: string,
  employeeUserId: string,
  fromWorkDate: string,
  toWorkDate: string,
) =>
  `store:${ownerId}:attendance:employee-range:${storeId}:${employeeUserId}:${fromWorkDate}:${toWorkDate}`;
const getEmployeeAttendanceRangeCachePrefix = (ownerId: string, storeId: string) =>
  `store:${ownerId}:attendance:employee-range:${storeId}:`;
const isAttendanceInStoreDateRange = (
  data: Record<string, unknown>,
  ownerId: string,
  storeId: string,
  fromWorkDate: string,
  toWorkDate: string,
) =>
  data["ownerId"] === ownerId &&
  data["storeId"] === storeId &&
  typeof data["workDate"] === "string" &&
  data["workDate"] >= fromWorkDate &&
  data["workDate"] <= toWorkDate;

const getAttendanceStoreDateRangeSnapshot = async (
  collection: Query,
  fromWorkDate: string,
  toWorkDate: string,
) => {
  // `collection` is already scoped to one store's subcollection, so we only range
  // over workDate; the in-memory guard below revalidates owner/store defensively.
  try {
    const snapshot = await collection
      .where("workDate", ">=", fromWorkDate)
      .where("workDate", "<=", toWorkDate)
      .get();

    return {
      snapshot,
      strategy: "indexed_range" as const,
    };
  } catch (error) {
    if (!isMissingCompositeIndexError(error)) {
      throw error;
    }

    return {
      snapshot: await collection.get(),
      strategy: "full_scan_fallback" as const,
    };
  }
};

const invalidateAttendanceListCache = async (
  ownerId: string,
  storeWorkDateKey: string | undefined,
) => {
  if (!storeWorkDateKey) {
    return;
  }

  await cacheDelete(getAttendanceListCacheKey(ownerId, storeWorkDateKey));
};

const invalidateAttendanceCaches = async (
  ownerId: string,
  attendanceId: string | undefined,
  storeId: string | undefined,
  storeWorkDateKey: string | undefined,
) => {
  await withAttendanceRepositorySpan(
    ATTENDANCE_TRACE_CHILD_SPANS.cacheInvalidate,
    {
      "app.store_id": storeId,
      "attendance.post_write_phase": "cache_invalidation",
      "cache.invalidation_scope": "primary",
    },
    async (span) => {
      await Promise.all([
        invalidateAttendanceListCache(ownerId, storeWorkDateKey),
        attendanceId
          ? cacheDelete(getAttendanceDetailCacheKey(ownerId, attendanceId))
          : Promise.resolve(),
      ]);

      setAttendanceRepositorySpanAttributes(span, { "cache.status": "completed" });

      // Secondary report/calendar caches are short-lived. Do not make CRUD wait for
      // Redis SCAN + DEL across all range keys; stale entries expire within 30s.
      const secondaryInvalidation = withAttendanceRepositorySpan(
        ATTENDANCE_TRACE_CHILD_SPANS.cacheInvalidateDetached,
        {
          "app.store_id": storeId,
          "attendance.post_write_phase": "cache_invalidation",
          "cache.invalidation_scope": "secondary",
        },
        async (detachedSpan) => {
          try {
            await Promise.all([
              cacheDeleteByPrefix(getAttendanceWorkDateRangeCachePrefix(ownerId)),
              cacheDeleteByPrefix(getEmployeeReportResponseCachePrefix(ownerId)),
              cacheDeleteByPrefix(getOwnerHomeSummaryResponseCachePrefix(ownerId)),
              storeId
                ? cacheDeleteByPrefix(getStoreAttendanceRangeCachePrefix(ownerId, storeId))
                : Promise.resolve(),
              storeId
                ? cacheDeleteByPrefix(getAttendanceCalendarRangeCachePrefix(ownerId, storeId))
                : Promise.resolve(),
              storeId
                ? cacheDeleteByPrefix(getStoreAttendanceSummaryRangeCachePrefix(ownerId, storeId))
                : Promise.resolve(),
              storeId
                ? cacheDeleteByPrefix(
                    getStoreAttendanceCancellationRangeCachePrefix(ownerId, storeId),
                  )
                : Promise.resolve(),
              storeId
                ? cacheDeleteByPrefix(getEmployeeWorkDayClosingRangeCachePrefix(ownerId, storeId))
                : Promise.resolve(),
              storeId
                ? cacheDeleteByPrefix(getEmployeeAttendanceRangeCachePrefix(ownerId, storeId))
                : Promise.resolve(),
            ]);
            setAttendanceRepositorySpanAttributes(detachedSpan, {
              "cache.status": "completed",
            });
          } catch (error) {
            setAttendanceRepositorySpanAttributes(detachedSpan, { "cache.status": "failed" });
            throw error;
          }
        },
      );

      addAttendanceRepositorySpanEvent(span, ATTENDANCE_TRACE_EVENTS.cacheInvalidationScheduled, {
        "cache.invalidation_scope": "secondary",
      });
      void secondaryInvalidation.catch((error) => {
        logger.warn({ error }, "attendance secondary cache invalidation failed");
      });
    },
  );
};

export const invalidateAttendanceRetentionCaches = async (
  ownerId: string,
  storeId: string,
  storeWorkDateKeys: Iterable<string>,
) => {
  const uniqueStoreWorkDateKeys = Array.from(new Set(storeWorkDateKeys));

  await Promise.all(
    uniqueStoreWorkDateKeys.map((storeWorkDateKey) =>
      cacheDelete(getAttendanceListCacheKey(ownerId, storeWorkDateKey)),
    ),
  );

  await Promise.all([
    cacheDeleteByPrefix(getAttendanceWorkDateRangeCachePrefix(ownerId)),
    cacheDeleteByPrefix(getEmployeeReportResponseCachePrefix(ownerId)),
    cacheDeleteByPrefix(getOwnerHomeSummaryResponseCachePrefix(ownerId)),
    cacheDeleteByPrefix(getStoreAttendanceRangeCachePrefix(ownerId, storeId)),
    cacheDeleteByPrefix(getAttendanceCalendarRangeCachePrefix(ownerId, storeId)),
    cacheDeleteByPrefix(getStoreAttendanceSummaryRangeCachePrefix(ownerId, storeId)),
    cacheDeleteByPrefix(getStoreAttendanceCancellationRangeCachePrefix(ownerId, storeId)),
    cacheDeleteByPrefix(getEmployeeWorkDayClosingRangeCachePrefix(ownerId, storeId)),
    cacheDeleteByPrefix(getEmployeeAttendanceRangeCachePrefix(ownerId, storeId)),
  ]);

  return uniqueStoreWorkDateKeys.length + 9;
};

export const createShopAttendanceFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    data: Omit<ShopAttendanceType, "id" | "attendanceCode" | "ownerId" | "createdAt" | "updatedAt">,
  ): Promise<ShopAttendanceType> => {
    const attendanceDoc = getStoreAttendances(firestoreDB, data.storeId).doc();
    const attendanceCode = await reservePublicCode(firestoreDB, "attendance", ownerId);
    const timestamp = Date.now();

    const createdAttendance: ShopAttendanceType = {
      id: attendanceDoc.id,
      attendanceCode,
      ownerId,
      ...data,
      assigneeUserIds: computeAttendanceAssigneeUserIds(
        data.createdBy,
        data.assignees,
        data.services,
      ),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await attendanceDoc.set(toStoreScopedWritePayload(ownerId, createdAttendance));
    await invalidateAttendanceCaches(ownerId, undefined, data.storeId, data.storeWorkDateKey);

    return createdAttendance;
  };
};

export const getShopAttendanceFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    attendanceId: string,
  ): Promise<ShopAttendanceType> => {
    return withAttendanceRepositorySpan(
      ATTENDANCE_TRACE_CHILD_SPANS.readSource,
      { "app.store_id": storeId },
      async (readSpan) => {
        const cachedAttendance = await readAttendanceCache(
          { "app.store_id": storeId },
          () =>
            cacheGetJson<ShopAttendanceType>(getAttendanceDetailCacheKey(ownerId, attendanceId)),
          { isHit: (cached) => cached?.storeId === storeId },
        );

        if (cachedAttendance && cachedAttendance.storeId === storeId) {
          setAttendanceRepositorySpanAttributes(readSpan, {
            "cache.status": "hit",
            "attendance.returned_count": 1,
          });
          return cachedAttendance;
        }

        setAttendanceRepositorySpanAttributes(readSpan, { "cache.status": "miss" });
        const attendanceDocument = await withAttendanceRepositorySpan(
          ATTENDANCE_TRACE_CHILD_SPANS.query,
          {
            "app.store_id": storeId,
            "query.strategy": "document_lookup",
          },
          () => getStoreAttendances(firestoreDB, storeId).doc(attendanceId).get(),
        );

        if (
          !attendanceDocument.exists ||
          !isStoreScopedDocumentData(attendanceDocument.data(), ownerId, storeId)
        ) {
          throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.attendance);
        }

        const attendance = mapStoreScopedDocumentToShopData<ShopAttendanceType>(
          attendanceDocument,
          ownerId,
        );
        await writeAttendanceCache({ "app.store_id": storeId }, () =>
          cacheSetJson(
            getAttendanceDetailCacheKey(ownerId, attendanceId),
            attendance,
            ATTENDANCE_DETAIL_CACHE_TTL_MS,
          ),
        );

        setAttendanceRepositorySpanAttributes(readSpan, {
          "attendance.returned_count": 1,
          "query.strategy": "document_lookup",
        });
        return attendance;
      },
    );
  };
};

export const updateShopAttendanceFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    attendanceId: string,
    data: Partial<Omit<ShopAttendanceType, "id" | "ownerId" | "createdAt" | "updatedAt">>,
    existingAttendance?: ShopAttendanceType,
    options: {
      deleteFields?: readonly (keyof Omit<
        ShopAttendanceType,
        "id" | "ownerId" | "createdAt" | "updatedAt"
      >)[];
    } = {},
  ): Promise<void> => {
    const existingAttendanceDocument = getStoreAttendances(firestoreDB, storeId).doc(attendanceId);
    let resolvedExistingAttendance = existingAttendance;

    if (!resolvedExistingAttendance) {
      const snapshot = await existingAttendanceDocument.get();

      if (snapshot.exists && isStoreScopedDocumentData(snapshot.data(), ownerId, storeId)) {
        resolvedExistingAttendance = mapStoreScopedDocumentToShopData<ShopAttendanceType>(
          snapshot,
          ownerId,
        );
      }
    }

    if (!resolvedExistingAttendance) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.attendance);
    }

    try {
      const mergedAssignees = data.assignees ?? resolvedExistingAttendance.assignees;
      const mergedServices = data.services ?? resolvedExistingAttendance.services;
      const assigneeUserIds = computeAttendanceAssigneeUserIds(
        resolvedExistingAttendance.createdBy,
        mergedAssignees,
        mergedServices,
      );
      const deletedFields = Object.fromEntries(
        (options.deleteFields ?? []).map((field) => [field, FieldValue.delete()]),
      );
      await existingAttendanceDocument.update({
        ...toStoreScopedWritePayload(ownerId, data),
        ...deletedFields,
        assigneeUserIds,
        updatedAt: Date.now(),
      });
      const nextStoreId = data.storeId ?? resolvedExistingAttendance.storeId;
      const nextStoreWorkDateKey =
        data.storeWorkDateKey ?? resolvedExistingAttendance.storeWorkDateKey;

      await invalidateAttendanceCaches(
        ownerId,
        attendanceId,
        resolvedExistingAttendance.storeId,
        resolvedExistingAttendance.storeWorkDateKey,
      );

      if (nextStoreId !== resolvedExistingAttendance.storeId) {
        await invalidateAttendanceCaches(ownerId, attendanceId, nextStoreId, nextStoreWorkDateKey);
      } else if (nextStoreWorkDateKey !== resolvedExistingAttendance.storeWorkDateKey) {
        await invalidateAttendanceListCache(ownerId, nextStoreWorkDateKey);
      }
    } catch (error) {
      const isNotFoundError =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: number }).code === 5;

      if (isNotFoundError) {
        throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.attendance);
      }

      throw error;
    }
  };
};

export const deleteShopAttendanceFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    attendanceId: string,
    existingAttendance?: ShopAttendanceType,
  ): Promise<void> => {
    const existingAttendanceDocument = getStoreAttendances(firestoreDB, storeId).doc(attendanceId);
    let resolvedExistingAttendance = existingAttendance;

    if (!resolvedExistingAttendance) {
      const snapshot = await existingAttendanceDocument.get();

      if (snapshot.exists && isStoreScopedDocumentData(snapshot.data(), ownerId, storeId)) {
        resolvedExistingAttendance = mapStoreScopedDocumentToShopData<ShopAttendanceType>(
          snapshot,
          ownerId,
        );
      }
    }

    if (!resolvedExistingAttendance) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.attendance);
    }

    await existingAttendanceDocument.delete();
    await invalidateAttendanceCaches(
      ownerId,
      attendanceId,
      resolvedExistingAttendance.storeId,
      resolvedExistingAttendance.storeWorkDateKey,
    );
  };
};

export const listShopAttendanceByStoreWorkDateKeyFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    workDate: string,
    options: { skipCache?: boolean } = {},
  ): Promise<ShopAttendanceType[]> => {
    return withAttendanceRepositorySpan(
      ATTENDANCE_TRACE_CHILD_SPANS.readSource,
      {
        "app.store_id": storeId,
        "attendance.work_date": workDate,
      },
      async (readSpan) => {
        const storeWorkDateKey = `${storeId}__${workDate}`;

        if (options.skipCache === true) {
          setAttendanceRepositorySpanAttributes(readSpan, { "cache.status": "bypass" });
        } else {
          const cachedAttendances = await readAttendanceCache(
            {
              "app.store_id": storeId,
              "attendance.work_date": workDate,
            },
            () =>
              cacheGetJson<ShopAttendanceType[]>(
                getAttendanceListCacheKey(ownerId, storeWorkDateKey),
              ),
          );

          if (cachedAttendances !== undefined) {
            setAttendanceRepositorySpanAttributes(readSpan, {
              "cache.status": "hit",
              "attendance.returned_count": cachedAttendances.length,
            });
            return cachedAttendances;
          }

          setAttendanceRepositorySpanAttributes(readSpan, { "cache.status": "miss" });
        }

        const snapshot = await withAttendanceRepositorySpan(
          ATTENDANCE_TRACE_CHILD_SPANS.query,
          {
            "app.store_id": storeId,
            "attendance.work_date": workDate,
            "query.strategy": "exact_work_date",
          },
          () => getStoreAttendances(firestoreDB, storeId).where("workDate", "==", workDate).get(),
        );

        const attendances = snapshot.docs
          .filter((doc) => isStoreScopedDocumentData(doc.data(), ownerId, storeId))
          .map((doc) => mapStoreScopedDocumentToShopData<ShopAttendanceType>(doc, ownerId))
          .sort((left, right) => left.startTime - right.startTime);

        if (options.skipCache !== true) {
          await writeAttendanceCache(
            {
              "app.store_id": storeId,
              "attendance.work_date": workDate,
            },
            () =>
              cacheSetJson(
                getAttendanceListCacheKey(ownerId, storeWorkDateKey),
                attendances,
                ATTENDANCE_LIST_CACHE_TTL_MS,
              ),
          );
        }

        setAttendanceRepositorySpanAttributes(readSpan, {
          "attendance.returned_count": attendances.length,
          "query.strategy": "exact_work_date",
        });
        return attendances;
      },
    );
  };
};

export const listShopAttendanceByWorkDateRangeFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    startDate: string,
    endDate: string,
  ): Promise<ShopAttendanceType[]> => {
    const cacheKey = getAttendanceWorkDateRangeCacheKey(ownerId, startDate, endDate);
    const cachedAttendances = await cacheGetJson<ShopAttendanceType[]>(cacheKey);

    if (cachedAttendances) {
      return cachedAttendances;
    }

    const snapshot = await getAttendanceGroup(firestoreDB)
      .where("ownerId", "==", ownerId)
      .where("workDate", ">=", startDate)
      .where("workDate", "<=", endDate)
      .get();

    const attendances = snapshot.docs
      .map((doc) => mapStoreScopedDocumentToShopData<ShopAttendanceType>(doc, ownerId))
      .sort((left, right) => {
        const dateComparison = left.workDate.localeCompare(right.workDate);

        if (dateComparison !== 0) {
          return dateComparison;
        }

        return left.startTime - right.startTime;
      });

    await cacheSetJson(cacheKey, attendances, ATTENDANCE_LIST_CACHE_TTL_MS);

    return attendances;
  };
};

export const listShopAttendanceByStoreDateRangeFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    fromWorkDate: string,
    toWorkDate: string,
    options: { skipCache?: boolean } = {},
  ): Promise<ShopAttendanceType[]> => {
    return withAttendanceRepositorySpan(
      ATTENDANCE_TRACE_CHILD_SPANS.readSource,
      {
        "app.store_id": storeId,
        "attendance.date_range.start": fromWorkDate,
        "attendance.date_range.end": toWorkDate,
      },
      async (readSpan) => {
        const cacheKey = getStoreAttendanceRangeCacheKey(
          ownerId,
          storeId,
          fromWorkDate,
          toWorkDate,
        );

        if (options.skipCache === true) {
          setAttendanceRepositorySpanAttributes(readSpan, { "cache.status": "bypass" });
        } else {
          const cachedAttendances = await readAttendanceCache(
            {
              "app.store_id": storeId,
              "attendance.date_range.start": fromWorkDate,
              "attendance.date_range.end": toWorkDate,
            },
            () => cacheGetJson<ShopAttendanceType[]>(cacheKey),
          );

          if (cachedAttendances !== undefined) {
            setAttendanceRepositorySpanAttributes(readSpan, {
              "cache.status": "hit",
              "attendance.returned_count": cachedAttendances.length,
            });
            return cachedAttendances;
          }

          setAttendanceRepositorySpanAttributes(readSpan, { "cache.status": "miss" });
        }

        const queryResult = await withAttendanceRepositorySpan(
          ATTENDANCE_TRACE_CHILD_SPANS.query,
          {
            "app.store_id": storeId,
            "attendance.date_range.start": fromWorkDate,
            "attendance.date_range.end": toWorkDate,
          },
          async (querySpan) => {
            const result = await getAttendanceStoreDateRangeSnapshot(
              getStoreAttendances(firestoreDB, storeId).where("ownerId", "==", ownerId),
              fromWorkDate,
              toWorkDate,
            );
            setAttendanceRepositorySpanAttributes(querySpan, {
              "query.strategy": result.strategy,
            });
            return result;
          },
        );

        const attendances = queryResult.snapshot.docs
          .filter((doc) =>
            isAttendanceInStoreDateRange(doc.data(), ownerId, storeId, fromWorkDate, toWorkDate),
          )
          .map((doc) => mapStoreScopedDocumentToShopData<ShopAttendanceType>(doc, ownerId))
          .sort((left, right) =>
            left.workDate === right.workDate
              ? left.startTime - right.startTime
              : left.workDate.localeCompare(right.workDate),
          );

        if (options.skipCache !== true) {
          await writeAttendanceCache(
            {
              "app.store_id": storeId,
              "attendance.date_range.start": fromWorkDate,
              "attendance.date_range.end": toWorkDate,
            },
            () => cacheSetJson(cacheKey, attendances, ATTENDANCE_LIST_CACHE_TTL_MS),
          );
        }

        setAttendanceRepositorySpanAttributes(readSpan, {
          "attendance.returned_count": attendances.length,
          "query.strategy": queryResult.strategy,
        });
        return attendances;
      },
    );
  };
};
export const listShopAttendanceCalendarByStoreDateRangeFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    fromWorkDate: string,
    toWorkDate: string,
    options: { employeeUserId?: string; skipCache?: boolean } = {},
  ): Promise<ShopAttendanceCalendarType[]> => {
    return withAttendanceRepositorySpan(
      ATTENDANCE_TRACE_CHILD_SPANS.readSource,
      {
        "app.store_id": storeId,
        "attendance.date_range.start": fromWorkDate,
        "attendance.date_range.end": toWorkDate,
        "attendance.employee_filter_present": options.employeeUserId !== undefined,
      },
      async (readSpan) => {
        const cacheKey = getAttendanceCalendarRangeCacheKey(
          ownerId,
          storeId,
          fromWorkDate,
          toWorkDate,
        );
        const shouldUseCalendarCache =
          options.skipCache !== true && options.employeeUserId === undefined;

        if (shouldUseCalendarCache) {
          const cachedAttendances = await readAttendanceCache(
            {
              "app.store_id": storeId,
              "attendance.date_range.start": fromWorkDate,
              "attendance.date_range.end": toWorkDate,
            },
            () => cacheGetJson<ShopAttendanceCalendarType[]>(cacheKey),
          );

          if (cachedAttendances !== undefined) {
            setAttendanceRepositorySpanAttributes(readSpan, {
              "cache.status": "hit",
              "attendance.returned_count": cachedAttendances.length,
            });
            return cachedAttendances;
          }

          setAttendanceRepositorySpanAttributes(readSpan, { "cache.status": "miss" });
        } else {
          setAttendanceRepositorySpanAttributes(readSpan, { "cache.status": "bypass" });
        }

        let singleFlightKey = cacheKey;

        if (!shouldUseCalendarCache) {
          singleFlightKey = `${cacheKey}:direct`;
        }

        if (options.employeeUserId !== undefined) {
          singleFlightKey = `${cacheKey}:employee:${options.employeeUserId}:direct`;
        }

        const attendances = await runSingleFlight(
          singleFlightKey,
          async () => {
            if (shouldUseCalendarCache) {
              const cachedAttendancesAfterSingleFlight = await readAttendanceCache(
                {
                  "app.store_id": storeId,
                  "attendance.date_range.start": fromWorkDate,
                  "attendance.date_range.end": toWorkDate,
                },
                () => cacheGetJson<ShopAttendanceCalendarType[]>(cacheKey),
                { hitStatus: "hit_after_single_flight" },
              );

              if (cachedAttendancesAfterSingleFlight !== undefined) {
                setAttendanceRepositorySpanAttributes(readSpan, {
                  "cache.status": "hit_after_single_flight",
                });
                return cachedAttendancesAfterSingleFlight;
              }
            }

            const storeAttendanceCollection = getStoreAttendances(firestoreDB, storeId);
            const calendarAttendanceQuery =
              options.employeeUserId !== undefined
                ? storeAttendanceCollection.where(
                    "assigneeUserIds",
                    "array-contains",
                    options.employeeUserId,
                  )
                : storeAttendanceCollection;

            const { snapshot, strategy } = await withAttendanceRepositorySpan(
              ATTENDANCE_TRACE_CHILD_SPANS.query,
              {
                "app.store_id": storeId,
                "attendance.date_range.start": fromWorkDate,
                "attendance.date_range.end": toWorkDate,
                "attendance.employee_filter_present": options.employeeUserId !== undefined,
              },
              async (querySpan) => {
                const queryResult = await getAttendanceStoreDateRangeSnapshot(
                  calendarAttendanceQuery.select(
                    "id",
                    "attendanceCode",
                    "bookingId",
                    "ownerId",
                    "employeeUserId",
                    "mainAssigneeUserId",
                    "assistantAssigneeUserId",
                    "storeId",
                    "storeName",
                    "storeWorkDateKey",
                    "workDate",
                    "storeTimezone",
                    "settlementCutoffTime",
                    "startTimestamp",
                    "endTimestamp",
                    "startTime",
                    "endTime",
                    "customerName",
                    "customerPhone",
                    "customerId",
                    "note",
                    "bookingSource",
                    "source",
                    "assignees",
                    "services",
                    "subtotalAmount",
                    "discount",
                    "totalAmount",
                    "status",
                    "bookingStatus",
                    "assigneeUserIds",
                    "createdAt",
                    "updatedAt",
                    "createdBy",
                    "createdByType",
                    "createdByUserId",
                    "createdByRole",
                    "updatedBy",
                    "updatedByUserId",
                    "updatedByRole",
                    "closedAt",
                    "closedBy",
                  ),
                  fromWorkDate,
                  toWorkDate,
                );
                setAttendanceRepositorySpanAttributes(querySpan, {
                  "query.strategy": queryResult.strategy,
                });
                return queryResult;
              },
            );

            const queriedAttendances = snapshot.docs
              .filter((doc) =>
                isAttendanceInStoreDateRange(
                  doc.data(),
                  ownerId,
                  storeId,
                  fromWorkDate,
                  toWorkDate,
                ),
              )
              .map((doc) =>
                mapStoreScopedDocumentToShopData<ShopAttendanceCalendarType>(doc, ownerId),
              )
              .sort((left, right) =>
                left.workDate === right.workDate
                  ? left.startTime - right.startTime
                  : left.workDate.localeCompare(right.workDate),
              );

            setAttendanceRepositorySpanAttributes(readSpan, { "query.strategy": strategy });

            if (shouldUseCalendarCache) {
              await writeAttendanceCache(
                {
                  "app.store_id": storeId,
                  "attendance.date_range.start": fromWorkDate,
                  "attendance.date_range.end": toWorkDate,
                },
                () => cacheSetJson(cacheKey, queriedAttendances, ATTENDANCE_LIST_CACHE_TTL_MS),
              );
            }

            return queriedAttendances;
          },
          {
            onRole: (role) => {
              setAttendanceRepositorySpanAttributes(readSpan, {
                "cache.single_flight_role": role,
              });
            },
          },
        );

        setAttendanceRepositorySpanAttributes(readSpan, {
          "attendance.returned_count": attendances.length,
        });
        return attendances;
      },
    );
  };
};
export const listShopAttendanceSummaryByStoreDateRangeFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    fromWorkDate: string,
    toWorkDate: string,
  ): Promise<ShopAttendanceHomeSummaryType[]> => {
    const cacheKey = getStoreAttendanceSummaryRangeCacheKey(
      ownerId,
      storeId,
      fromWorkDate,
      toWorkDate,
    );
    const cachedAttendances = await cacheGetJson<ShopAttendanceHomeSummaryType[]>(cacheKey);

    if (cachedAttendances !== undefined) {
      return cachedAttendances;
    }

    const { snapshot } = await getAttendanceStoreDateRangeSnapshot(
      getStoreAttendances(firestoreDB, storeId).select(
        "id",
        "ownerId",
        "storeId",
        "storeWorkDateKey",
        "workDate",
        "startTime",
        "subtotalAmount",
        "totalAmount",
        "bookingStatus",
      ),
      fromWorkDate,
      toWorkDate,
    );

    const attendances = snapshot.docs
      .filter((doc) =>
        isAttendanceInStoreDateRange(doc.data(), ownerId, storeId, fromWorkDate, toWorkDate),
      )
      .map((doc) => mapStoreScopedDocumentToShopData<ShopAttendanceHomeSummaryType>(doc, ownerId))
      .sort((left, right) =>
        left.workDate === right.workDate
          ? left.startTime - right.startTime
          : left.workDate.localeCompare(right.workDate),
      );

    await cacheSetJson(cacheKey, attendances, ATTENDANCE_LIST_CACHE_TTL_MS);

    return attendances;
  };
};

export const listShopAttendanceCancellationsByStoreDateRangeFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    fromWorkDate: string,
    toWorkDate: string,
  ): Promise<ShopAttendanceCancellationMetricType[]> => {
    const cacheKey = getStoreAttendanceCancellationRangeCacheKey(
      ownerId,
      storeId,
      fromWorkDate,
      toWorkDate,
    );
    const cachedMetrics = await cacheGetJson<ShopAttendanceCancellationMetricType[]>(cacheKey);

    if (cachedMetrics !== undefined) {
      return cachedMetrics;
    }

    return runSingleFlight(cacheKey, async () => {
      const cachedMetricsAfterSingleFlight =
        await cacheGetJson<ShopAttendanceCancellationMetricType[]>(cacheKey);

      if (cachedMetricsAfterSingleFlight !== undefined) {
        return cachedMetricsAfterSingleFlight;
      }

      const cancelledAttendanceQuery = getStoreAttendances(firestoreDB, storeId)
        .select("ownerId", "storeId", "workDate", "bookingStatus")
        .where("bookingStatus", "==", "cancelled");
      const { snapshot } = await getAttendanceStoreDateRangeSnapshot(
        cancelledAttendanceQuery,
        fromWorkDate,
        toWorkDate,
      );
      const cancelledCountsByWorkDate = new Map<string, number>();

      for (const document of snapshot.docs) {
        const attendanceData = document.data();
        const workDate = attendanceData["workDate"];

        if (
          !isAttendanceInStoreDateRange(
            attendanceData,
            ownerId,
            storeId,
            fromWorkDate,
            toWorkDate,
          ) ||
          typeof workDate !== "string" ||
          attendanceData["bookingStatus"] !== "cancelled"
        ) {
          continue;
        }

        const currentCancelledCount = cancelledCountsByWorkDate.get(workDate) ?? 0;
        cancelledCountsByWorkDate.set(workDate, currentCancelledCount + 1);
      }

      const metrics = Array.from(cancelledCountsByWorkDate, ([workDate, cancelledCount]) => ({
        workDate,
        cancelledCount,
      })).sort((left, right) => left.workDate.localeCompare(right.workDate));

      await cacheSetJson(cacheKey, metrics, ATTENDANCE_LIST_CACHE_TTL_MS);

      return metrics;
    });
  };
};

export const listShopAttendanceByEmployeeDateRangeFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    employeeUserId: string,
    fromWorkDate: string,
    toWorkDate: string,
  ): Promise<ShopAttendanceType[]> => {
    const cacheKey = getEmployeeAttendanceRangeCacheKey(
      ownerId,
      storeId,
      employeeUserId,
      fromWorkDate,
      toWorkDate,
    );
    const cached = await cacheGetJson<ShopAttendanceType[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const snapshot = await getStoreAttendances(firestoreDB, storeId)
      .where("assigneeUserIds", "array-contains", employeeUserId)
      .where("workDate", ">=", fromWorkDate)
      .where("workDate", "<=", toWorkDate)
      .get();

    const attendances = snapshot.docs
      .filter((doc) => isStoreScopedDocumentData(doc.data(), ownerId, storeId))
      .map((doc) => mapStoreScopedDocumentToShopData<ShopAttendanceType>(doc, ownerId))
      .sort((a, b) =>
        a.workDate === b.workDate
          ? a.startTime - b.startTime
          : a.workDate.localeCompare(b.workDate),
      );

    await cacheSetJson(cacheKey, attendances, ATTENDANCE_LIST_CACHE_TTL_MS);

    return attendances;
  };
};
