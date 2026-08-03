import type { Firestore } from "@google-cloud/firestore";
import type { ShopServiceType } from "./shop.types.js";
import { DB_NOT_FOUND, FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import {
  ensureShopServiceCategory,
  getShopServiceCatalogFactory,
  getStoreCategories,
  getStoreCategoryServices,
  invalidateShopServiceCatalog,
  resolveShopServiceCategoryIdForService,
} from "./shop-service-catalog-factory.js";
import { reservePublicCode } from "../public-code.js";
import { normalizePublicCode } from "../../../helpers/public-code.js";
import { getCollectionGroup } from "../collection-paths.js";
import {
  isStoreScopedDocumentData,
  mapStoreScopedDocumentToShopData,
  toStoreScopedWritePayload,
} from "../store-document-mapper.js";

const getServiceGroup = (firestoreDB: Firestore) => getCollectionGroup(firestoreDB, "services");

const isCategoryScopedServicePath = (path: string) =>
  path.split("/").includes("service_categories");

const resolveShopServiceDocument = async (
  firestoreDB: Firestore,
  ownerId: string,
  idOrCode: string,
  expectedStoreId?: string,
) => {
  const group = getServiceGroup(firestoreDB);
  const byIdQuery = group.where("ownerId", "==", ownerId).where("id", "==", idOrCode);
  const byId =
    expectedStoreId === undefined
      ? await byIdQuery.get()
      : await byIdQuery.where("storeId", "==", expectedStoreId).get();
  const directMatch = byId.docs.find((doc) => isCategoryScopedServicePath(doc.ref.path));

  if (directMatch) {
    return directMatch;
  }

  const normalizedCode = normalizePublicCode(idOrCode);
  const byCodeQuery = group
    .where("ownerId", "==", ownerId)
    .where("serviceCode", "==", normalizedCode);
  const byCode =
    expectedStoreId === undefined
      ? await byCodeQuery.limit(1).get()
      : await byCodeQuery.where("storeId", "==", expectedStoreId).limit(1).get();

  return byCode.docs.find((doc) => isCategoryScopedServicePath(doc.ref.path));
};

const syncServiceCategoryCount = async (
  firestoreDB: Firestore,
  ownerId: string,
  storeId: string,
  categoryId: string,
) => {
  const services = await getStoreCategoryServices(firestoreDB, storeId, categoryId)
    .where("type", "==", "predefined")
    .get();

  await getStoreCategories(firestoreDB, storeId)
    .doc(categoryId)
    .set(
      {
        serviceCount: services.docs.filter((doc) =>
          isStoreScopedDocumentData(doc.data(), ownerId, storeId),
        ).length,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
};

export const createShopServiceFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    serviceData: Omit<ShopServiceType, "id" | "ownerId" | "createdAt" | "updatedAt">,
  ): Promise<ShopServiceType> => {
    const categoryId = await ensureShopServiceCategory(firestoreDB, ownerId, serviceData);
    const newShopServiceRef = getStoreCategoryServices(
      firestoreDB,
      serviceData.storeId,
      categoryId,
    ).doc();
    const serviceCode = await reservePublicCode(firestoreDB, "service", ownerId);
    const timestamp = Date.now();
    const newService: ShopServiceType = {
      id: newShopServiceRef.id,
      serviceCode,
      ownerId,
      ...serviceData,
      serviceCategoryId: categoryId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await newShopServiceRef.set(toStoreScopedWritePayload(ownerId, newService));
    await invalidateShopServiceCatalog(ownerId, serviceData.storeId);
    await syncServiceCategoryCount(firestoreDB, ownerId, serviceData.storeId, categoryId);

    return newService;
  };
};

export const getShopServiceFactory = (firestoreDB: Firestore) => {
  const getShopServiceCatalog = getShopServiceCatalogFactory(firestoreDB);

  return async (ownerId: string, storeId: string): Promise<ShopServiceType[]> => {
    const catalog = await getShopServiceCatalog(ownerId, storeId);
    const services = catalog.groups.flatMap((group) => group.services);

    return services.sort((left, right) => {
      const nameComparison = left.name.localeCompare(right.name, "vi");

      return nameComparison !== 0 ? nameComparison : left.id.localeCompare(right.id);
    });
  };
};

export const getShopServiceByIdFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    serviceId: string,
    expectedStoreId?: string,
  ): Promise<ShopServiceType> => {
    const serviceDocument = await resolveShopServiceDocument(
      firestoreDB,
      ownerId,
      serviceId,
      expectedStoreId,
    );

    if (!serviceDocument) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.service);
    }

    return mapStoreScopedDocumentToShopData<ShopServiceType>(serviceDocument, ownerId);
  };
};

export const updateShopServiceFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    serviceId: string,
    serviceData: Partial<
      Omit<ShopServiceType, "id" | "ownerId" | "storeId" | "createdAt" | "updatedAt">
    >,
    expectedStoreId?: string,
  ): Promise<ShopServiceType> => {
    const existingServiceDocument = await resolveShopServiceDocument(
      firestoreDB,
      ownerId,
      serviceId,
      expectedStoreId,
    );

    if (!existingServiceDocument) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.service);
    }

    try {
      const existingServiceData = mapStoreScopedDocumentToShopData<ShopServiceType>(
        existingServiceDocument,
        ownerId,
      );
      const updatedAt = Date.now();
      const nextServiceData = {
        ...existingServiceData,
        ...serviceData,
        updatedAt,
      };

      const nextCategoryId = await ensureShopServiceCategory(firestoreDB, ownerId, nextServiceData);
      const updatedService = {
        ...nextServiceData,
        serviceCategoryId: nextCategoryId,
      };
      const currentCategoryId = resolveShopServiceCategoryIdForService(existingServiceData);
      const shouldMoveCategory = nextCategoryId !== currentCategoryId;

      if (shouldMoveCategory) {
        const nextRef = getStoreCategoryServices(
          firestoreDB,
          existingServiceData.storeId,
          nextCategoryId,
        ).doc(existingServiceData.id);
        const serviceCategoryMoveBatch = firestoreDB.batch();
        serviceCategoryMoveBatch.set(nextRef, toStoreScopedWritePayload(ownerId, updatedService));
        serviceCategoryMoveBatch.delete(existingServiceDocument.ref);
        await serviceCategoryMoveBatch.commit();
      } else {
        await existingServiceDocument.ref.update({
          ...serviceData,
          serviceCategoryId: nextCategoryId,
          updatedAt,
        });
      }

      await invalidateShopServiceCatalog(ownerId, existingServiceData.storeId);

      if (shouldMoveCategory) {
        await Promise.all([
          syncServiceCategoryCount(
            firestoreDB,
            ownerId,
            existingServiceData.storeId,
            currentCategoryId,
          ),
          syncServiceCategoryCount(
            firestoreDB,
            ownerId,
            existingServiceData.storeId,
            nextCategoryId,
          ),
        ]);
      } else {
        await syncServiceCategoryCount(
          firestoreDB,
          ownerId,
          existingServiceData.storeId,
          nextCategoryId,
        );
      }

      return updatedService;
    } catch (error) {
      let isNotFoundError = false;

      if (typeof error === "object" && error !== null && "code" in error) {
        isNotFoundError = error.code === 5;
      }

      if (isNotFoundError) {
        throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.service);
      }

      throw error;
    }
  };
};

export const deleteShopServiceFactory = (firestoreDB: Firestore) => {
  return async (ownerId: string, serviceId: string, expectedStoreId?: string): Promise<void> => {
    const existingService = await resolveShopServiceDocument(
      firestoreDB,
      ownerId,
      serviceId,
      expectedStoreId,
    );

    if (!existingService) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.service);
    }

    const existingServiceData = mapStoreScopedDocumentToShopData<ShopServiceType>(
      existingService,
      ownerId,
    );

    const categoryId = resolveShopServiceCategoryIdForService(existingServiceData);

    await existingService.ref.delete();
    await invalidateShopServiceCatalog(ownerId, existingServiceData.storeId);
    await syncServiceCategoryCount(firestoreDB, ownerId, existingServiceData.storeId, categoryId);
  };
};
