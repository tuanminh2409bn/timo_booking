import type { DocumentSnapshot, QueryDocumentSnapshot } from "@google-cloud/firestore";

type StoreDocumentSnapshot = DocumentSnapshot | QueryDocumentSnapshot;

const getParentStoreId = (document: StoreDocumentSnapshot): string | undefined => {
  const pathSegments = document.ref.path.split("/");
  const storesIndex = pathSegments.lastIndexOf("stores");
  const parentStoreId = storesIndex >= 0 ? pathSegments[storesIndex + 1] : undefined;

  return typeof parentStoreId === "string" && parentStoreId.length > 0 ? parentStoreId : undefined;
};

export const isStoreScopedDocumentData = (
  data: Record<string, unknown> | undefined,
  ownerId: string,
  storeId: string,
) => data !== undefined && data["ownerId"] === ownerId && data["storeId"] === storeId;

export const mapStoreDocumentToStore = <T extends Record<string, unknown>>(
  document: StoreDocumentSnapshot,
  ownerId: string,
): T => {
  const data = (document.data() ?? {}) as T;

  return {
    ...data,
    id: typeof data["id"] === "string" ? data["id"] : document.id,
    ownerId: typeof data["ownerId"] === "string" ? data["ownerId"] : ownerId,
    storeId: typeof data["storeId"] === "string" ? data["storeId"] : document.id,
  };
};

export const mapStoreScopedDocumentToShopData = <T extends Record<string, unknown>>(
  document: StoreDocumentSnapshot,
  ownerId: string,
): T => {
  const data = (document.data() ?? {}) as T;
  const storeId = data["storeId"];
  const resolvedStoreId = typeof storeId === "string" ? storeId : getParentStoreId(document);
  const storeName = data["storeName"];
  const storeWorkDateKey =
    typeof data["storeWorkDateKey"] === "string" ? data["storeWorkDateKey"] : undefined;

  return {
    ...data,
    id: typeof data["id"] === "string" ? data["id"] : document.id,
    ownerId: ownerId,
    storeId: resolvedStoreId,
    ...(typeof storeName === "string" && { storeName: storeName }),
    ...(typeof storeWorkDateKey === "string" && { storeWorkDateKey: storeWorkDateKey }),
  };
};

export const toStoreScopedWritePayload = <T extends object>(ownerId: string, data: T) => {
  const next: Record<string, unknown> = Object.fromEntries(Object.entries(data));
  const storeId = next["storeId"];
  const storeName = next["storeName"];
  const storeWorkDateKey = next["storeWorkDateKey"];

  delete next["ownerId"];
  delete next["storeId"];
  delete next["storeName"];
  delete next["storeWorkDateKey"];

  return {
    ...next,
    ownerId,
    ...(typeof storeId === "string" && { storeId }),
    ...(typeof storeName === "string" && { storeName }),
    ...(typeof storeWorkDateKey === "string" && { storeWorkDateKey }),
  };
};
