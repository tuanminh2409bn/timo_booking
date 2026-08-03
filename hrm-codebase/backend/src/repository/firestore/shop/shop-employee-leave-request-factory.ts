import type { Firestore, Query } from "@google-cloud/firestore";
import { DB_NOT_FOUND, FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { getStoreSubcollection } from "../collection-paths.js";
import {
  isStoreScopedDocumentData,
  mapStoreScopedDocumentToShopData,
  toStoreScopedWritePayload,
} from "../store-document-mapper.js";
import type { ShopEmployeeLeaveRequestType } from "./shop.types.js";

const EMPLOYEE_LEAVE_REQUESTS_SUBCOLLECTION = "employee_leave_requests";

const getStoreEmployeeLeaveRequests = (firestoreDB: Firestore, storeId: string) =>
  getStoreSubcollection(firestoreDB, storeId, EMPLOYEE_LEAVE_REQUESTS_SUBCOLLECTION);

export const createEmployeeLeaveRequestFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    data: Omit<ShopEmployeeLeaveRequestType, "id" | "ownerId" | "createdAt" | "updatedAt">,
  ): Promise<ShopEmployeeLeaveRequestType> => {
    const leaveRequestDocument = getStoreEmployeeLeaveRequests(firestoreDB, data.storeId).doc();
    const timestamp = Date.now();
    const leaveRequest: ShopEmployeeLeaveRequestType = {
      id: leaveRequestDocument.id,
      ownerId,
      ...data,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await leaveRequestDocument.set(toStoreScopedWritePayload(ownerId, leaveRequest));

    return leaveRequest;
  };
};

export const listEmployeeLeaveRequestsFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    filters: {
      storeId: string;
      employeeUserId: string;
      limit: number;
      beforeCreatedAt?: number;
    },
  ): Promise<ShopEmployeeLeaveRequestType[]> => {
    // Cursor pagination: sắp theo createdAt desc, `beforeCreatedAt` lấy các đơn cũ hơn con trỏ.
    let query: Query = getStoreEmployeeLeaveRequests(firestoreDB, filters.storeId)
      .where("employeeUserId", "==", filters.employeeUserId)
      .orderBy("createdAt", "desc");

    if (filters.beforeCreatedAt !== undefined) {
      query = query.startAfter(filters.beforeCreatedAt);
    }

    const snapshot = await query.limit(filters.limit).get();

    return snapshot.docs
      .filter(
        (document) =>
          isStoreScopedDocumentData(document.data(), ownerId, filters.storeId) &&
          document.data()["employeeUserId"] === filters.employeeUserId,
      )
      .map((document) =>
        mapStoreScopedDocumentToShopData<ShopEmployeeLeaveRequestType>(document, ownerId),
      );
  };
};

export const deleteEmployeeLeaveRequestFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    filters: { storeId: string; employeeUserId: string; leaveRequestId: string },
  ): Promise<ShopEmployeeLeaveRequestType> => {
    const leaveRequestDocument = await getStoreEmployeeLeaveRequests(firestoreDB, filters.storeId)
      .doc(filters.leaveRequestId)
      .get();

    const leaveRequestData = leaveRequestDocument.data();

    if (
      !leaveRequestDocument.exists ||
      !isStoreScopedDocumentData(leaveRequestData, ownerId, filters.storeId) ||
      leaveRequestData?.["employeeUserId"] !== filters.employeeUserId
    ) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.leaveRequest);
    }

    const leaveRequest = mapStoreScopedDocumentToShopData<ShopEmployeeLeaveRequestType>(
      leaveRequestDocument,
      ownerId,
    );

    await leaveRequestDocument.ref.delete();

    return leaveRequest;
  };
};
