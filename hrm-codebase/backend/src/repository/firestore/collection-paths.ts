import type { Firestore } from "@google-cloud/firestore";

// Nested data model: store-owned operational data lives below stores/{storeId}.
// Most domains use stores/{storeId}/<name>; services are deeper under
// stores/{storeId}/service_categories/{categoryId}/services.
// Owner-level cross-store queries use collection groups on the leaf collection id.

export const STORES_COLLECTION = "stores";

export const getStoreSubcollection = (
  firestoreDB: Firestore,
  storeId: string,
  subcollection: string,
) => firestoreDB.collection(STORES_COLLECTION).doc(storeId).collection(subcollection);

export const getCollectionGroup = (firestoreDB: Firestore, subcollection: string) =>
  firestoreDB.collectionGroup(subcollection);
