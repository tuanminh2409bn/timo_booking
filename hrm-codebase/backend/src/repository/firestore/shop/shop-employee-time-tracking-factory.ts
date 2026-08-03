import type { Firestore } from "@google-cloud/firestore";
import { cacheDeleteByPrefix } from "../../cache/cache-client.js";
import {
  getEmployeeReportResponseCachePrefix,
  getOwnerHomeSummaryResponseCachePrefix,
} from "../../../helpers/cache-keys.js";
import { getStoreSubcollection } from "../collection-paths.js";
import {
  isStoreScopedDocumentData,
  mapStoreScopedDocumentToShopData,
  toStoreScopedWritePayload,
} from "../store-document-mapper.js";
import type { ShopEmployeeTimeTrackingType } from "./shop.types.js";
import {
  notifyEmployeeTimeTrackingCommit,
  type EmployeeTimeTrackingCommitObserver,
  type EmployeeTimeTrackingPersistAction,
} from "./employee-time-tracking-commit-observer.js";
import { withEmployeeTimeTrackingSpan } from "../../../business/employee/time-tracking/employee-time-tracking-observability.js";
import { EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS } from "../../../business/employee/time-tracking/employee-time-tracking-tracing-contract.js";

const EMPLOYEE_TIME_TRACKING_SUBCOLLECTION = "employee_time_tracking";

const getEmployeeTimeTrackingCollection = (firestoreDB: Firestore, storeId: string) =>
  getStoreSubcollection(firestoreDB, storeId, EMPLOYEE_TIME_TRACKING_SUBCOLLECTION);

export const getEmployeeTimeTrackingDocumentId = (employeeUserId: string, workDate: string) =>
  `${employeeUserId}__${workDate}`;

export const getShopEmployeeTimeTrackingFactory =
  (firestoreDB: Firestore) =>
  async (
    ownerId: string,
    storeId: string,
    employeeUserId: string,
    workDate: string,
  ): Promise<ShopEmployeeTimeTrackingType | null> => {
    const document = await getEmployeeTimeTrackingCollection(firestoreDB, storeId)
      .doc(getEmployeeTimeTrackingDocumentId(employeeUserId, workDate))
      .get();
    const data = document.data();

    if (
      !document.exists ||
      !data ||
      !isStoreScopedDocumentData(data, ownerId, storeId) ||
      data["employeeUserId"] !== employeeUserId ||
      data["workDate"] !== workDate
    ) {
      return null;
    }

    return mapStoreScopedDocumentToShopData<ShopEmployeeTimeTrackingType>(document, ownerId);
  };

export const listOpenShopEmployeeTimeTrackingFactory =
  (firestoreDB: Firestore) =>
  async (
    ownerId: string,
    storeId: string,
    employeeUserId: string,
    beforeWorkDate?: string,
  ): Promise<ShopEmployeeTimeTrackingType[]> => {
    const snapshot = await getEmployeeTimeTrackingCollection(firestoreDB, storeId)
      .where("employeeUserId", "==", employeeUserId)
      .get();

    return snapshot.docs
      .map((document) => {
        const data = document.data();

        if (
          !isStoreScopedDocumentData(data, ownerId, storeId) ||
          data["employeeUserId"] !== employeeUserId ||
          data["status"] !== "working" ||
          (beforeWorkDate !== undefined &&
            (typeof data["workDate"] !== "string" || data["workDate"] >= beforeWorkDate))
        ) {
          return null;
        }

        return mapStoreScopedDocumentToShopData<ShopEmployeeTimeTrackingType>(document, ownerId);
      })
      .filter((item): item is ShopEmployeeTimeTrackingType => item !== null)
      .sort((left, right) => right.workDate.localeCompare(left.workDate));
  };

export const upsertShopEmployeeTimeTrackingFactory =
  (firestoreDB: Firestore) =>
  async (
    ownerId: string,
    data: Omit<ShopEmployeeTimeTrackingType, "id" | "ownerId" | "createdAt" | "updatedAt">,
    options: { onCommitted?: EmployeeTimeTrackingCommitObserver } = {},
  ): Promise<ShopEmployeeTimeTrackingType> => {
    const timestamp = Date.now();
    const id = getEmployeeTimeTrackingDocumentId(data.employeeUserId, data.workDate);
    const document = getEmployeeTimeTrackingCollection(firestoreDB, data.storeId).doc(id);
    const existing = await document.get();
    const existingData = existing.data();
    const tracking: ShopEmployeeTimeTrackingType = {
      id,
      ownerId,
      ...data,
      createdAt:
        typeof existingData?.["createdAt"] === "number" ? existingData["createdAt"] : timestamp,
      updatedAt: timestamp,
    };
    const statusBefore =
      existingData?.["status"] === "working" || existingData?.["status"] === "completed"
        ? existingData["status"]
        : "missing";
    const persistAction: EmployeeTimeTrackingPersistAction = existing.exists ? "update" : "create";
    const action = tracking.status === "working" ? "check_in" : "check_out";

    await withEmployeeTimeTrackingSpan(
      EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.sessionPersist,
      {
        "app.store_id": tracking.storeId,
        "time_tracking.action": action,
        "time_tracking.work_date": tracking.workDate,
        "time_tracking.status.before": statusBefore,
        "time_tracking.status.after": tracking.status,
        "time_tracking.persist_action": persistAction,
      },
      () => document.set(toStoreScopedWritePayload(ownerId, tracking)),
    );

    notifyEmployeeTimeTrackingCommit(options.onCommitted, {
      action,
      persistAction,
      statusBefore,
      statusAfter: tracking.status,
      storeId: tracking.storeId,
      workDate: tracking.workDate,
    });

    await withEmployeeTimeTrackingSpan(
      EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.cacheInvalidate,
      {
        "app.store_id": tracking.storeId,
        "time_tracking.work_date": tracking.workDate,
        "time_tracking.post_write_phase": "cache_invalidation",
        "cache.group_count": 2,
      },
      async () => {
        await Promise.all([
          cacheDeleteByPrefix(getEmployeeReportResponseCachePrefix(ownerId)),
          cacheDeleteByPrefix(getOwnerHomeSummaryResponseCachePrefix(ownerId)),
        ]);
      },
    );

    return tracking;
  };
