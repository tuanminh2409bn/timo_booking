import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import { DB_NOT_FOUND, FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import {
  cacheDelete,
  cacheDeleteByPrefix,
  cacheGetJson,
  cacheSetJson,
  runSingleFlight,
} from "../../cache/cache-client.js";
import type {
  ShopServiceCatalogGroupType,
  ShopServiceCatalogType,
  ShopServiceCategoryDocumentType,
  ShopServiceCategoryType,
  ShopServiceType,
} from "./shop.types.js";
import {
  isStoreScopedDocumentData,
  mapStoreScopedDocumentToShopData,
} from "../store-document-mapper.js";
import { getCollectionGroup, getStoreSubcollection } from "../collection-paths.js";

export const SERVICE_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

export const SERVICE_CATEGORIES_SUBCOLLECTION = "service_categories";
export const SERVICES_SUBCOLLECTION = "services";

export const getStoreCategories = (firestoreDB: Firestore, storeId: string) =>
  getStoreSubcollection(firestoreDB, storeId, SERVICE_CATEGORIES_SUBCOLLECTION);

export const getStoreCategoryServices = (
  firestoreDB: Firestore,
  storeId: string,
  categoryId: string,
) => getStoreCategories(firestoreDB, storeId).doc(categoryId).collection(SERVICES_SUBCOLLECTION);

const isCategoryScopedServicePath = (documentPath: string): boolean =>
  documentPath.split("/").includes(SERVICE_CATEGORIES_SUBCOLLECTION);

const SERVICE_CATEGORY_LABELS: Record<ShopServiceCategoryType, string> = {
  nail: "Nail",
  pedicure: "Pedicure",
  manicure: "Manicure",
  design: "Design",
  other: "Other",
};

const getShopServiceCatalogCachePrefix = (ownerId: string, storeId?: string) =>
  storeId ? `store:${ownerId}:service-catalog:${storeId}:` : `store:${ownerId}:service-catalog:`;

const getShopServiceCatalogCacheKey = (ownerId: string, storeId: string) =>
  `${getShopServiceCatalogCachePrefix(ownerId, storeId)}current`;

const hashValue = (value: unknown) =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex");

const slugifyGroupName = (name: string, fallback: ShopServiceCategoryType) => {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || fallback;
};

const hasStoreScopeMismatch = (
  data: Record<string, unknown> | undefined,
  ownerId: string,
  storeId: string,
) => {
  if (data === undefined) {
    return false;
  }

  return (
    (typeof data["ownerId"] === "string" && data["ownerId"] !== ownerId) ||
    (typeof data["storeId"] === "string" && data["storeId"] !== storeId)
  );
};

export const resolveShopServiceGroupName = (
  service: Pick<ShopServiceType, "groupService" | "category">,
): string => service.groupService?.trim() || SERVICE_CATEGORY_LABELS[service.category];

export const resolveShopServiceCategoryId = (name: string, category: ShopServiceCategoryType) =>
  `category_${slugifyGroupName(name, category)}`;

export const resolveShopServiceCategoryIdForService = (
  service: Pick<ShopServiceType, "groupService" | "category">,
) => resolveShopServiceCategoryId(resolveShopServiceGroupName(service), service.category);

const toServiceCategoryDocument = (
  ownerId: string,
  storeId: string,
  groupName: string,
  category: ShopServiceCategoryType,
  sortOrder: number,
): ShopServiceCategoryDocumentType => {
  const timestamp = Date.now();
  const id = resolveShopServiceCategoryId(groupName, category);

  return {
    id,
    ownerId,
    storeId,
    name: groupName,
    label: groupName,
    category,
    sortOrder,
    serviceCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const buildCatalogVersion = (
  services: ShopServiceType[],
  categories: ShopServiceCategoryDocumentType[],
) =>
  hashValue(
    {
      categories: categories
        .map((category) => ({
          id: category.id,
          name: category.name,
          label: category.label,
          category: category.category,
          sortOrder: category.sortOrder,
          updatedAt: category.updatedAt,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      services: services
        .map((service) => ({
          id: service.id,
          name: service.name,
          groupService: service.groupService,
          category: service.category,
          price: service.price,
          durationMin: service.durationMin,
          durationMax: service.durationMax,
          updatedAt: service.updatedAt,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    },
  );

const stripServiceImages = (service: ShopServiceType): ShopServiceType => {
  const { imageUrls: _imageUrls, ...serviceWithoutImages } = service;

  return serviceWithoutImages;
};

const buildShopServiceCatalog = (
  ownerId: string,
  storeId: string,
  services: ShopServiceType[],
  categories: ShopServiceCategoryDocumentType[],
): ShopServiceCatalogType => {
  const groupsByKey = new Map<string, ShopServiceCatalogGroupType>();
  const sortedServices = [...services].sort((left, right) => {
    const nameComparison = left.name.localeCompare(right.name, "vi");

    return nameComparison !== 0 ? nameComparison : left.id.localeCompare(right.id);
  });
  const createdTimestamps = [
    ...services.map((service) => service.createdAt),
    ...categories.map((category) => category.createdAt),
  ].filter((timestamp): timestamp is number => timestamp !== undefined && timestamp > 0);
  const updatedTimestamps = [
    ...services.map((service) => service.updatedAt),
    ...categories.map((category) => category.updatedAt),
  ].filter((timestamp): timestamp is number => timestamp !== undefined && timestamp > 0);
  const catalogCreatedAt = createdTimestamps.length > 0 ? Math.min(...createdTimestamps) : 0;
  const catalogUpdatedAt = updatedTimestamps.length > 0 ? Math.max(...updatedTimestamps) : 0;

  for (const category of [...categories].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    const nameComparison = left.name.localeCompare(right.name, "vi");

    return nameComparison !== 0 ? nameComparison : left.id.localeCompare(right.id);
  })) {
    groupsByKey.set(category.id, {
      id: category.id,
      name: category.name,
      label: category.label,
      category: category.category,
      sortOrder: category.sortOrder,
      serviceCount: 0,
      services: [],
    });
  }

  for (const service of sortedServices) {
    const groupName = resolveShopServiceGroupName(service);
    const groupId = resolveShopServiceCategoryId(groupName, service.category);
    const existingGroup = groupsByKey.get(groupId);

    if (existingGroup) {
      existingGroup.services.push(stripServiceImages(service));
      existingGroup.serviceCount = existingGroup.services.length;
      continue;
    }

    groupsByKey.set(groupId, {
      id: groupId,
      name: groupName,
      label: groupName,
      category: service.category,
      sortOrder: groupsByKey.size + 1,
      serviceCount: 0,
      services: [stripServiceImages(service)],
    });
  }

  const groups = Array.from(groupsByKey.values())
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }

      const nameComparison = left.name.localeCompare(right.name, "vi");

      return nameComparison !== 0 ? nameComparison : left.id.localeCompare(right.id);
    })
    .map((group, index) => ({
      ...group,
      sortOrder: index + 1,
      serviceCount: group.services.length,
    }));

  return {
    id: storeId,
    ownerId,
    storeId,
    version: buildCatalogVersion(sortedServices, categories),
    groupCount: groups.length,
    serviceCount: sortedServices.length,
    groups,
    createdAt: catalogCreatedAt,
    updatedAt: catalogUpdatedAt,
  };
};

export const ensureShopServiceCategory = async (
  firestoreDB: Firestore,
  ownerId: string,
  service: Pick<ShopServiceType, "storeId" | "groupService" | "category">,
): Promise<string> => {
  const groupName = resolveShopServiceGroupName(service);
  const categoryId = resolveShopServiceCategoryId(groupName, service.category);
  const categoryRef = getStoreCategories(firestoreDB, service.storeId).doc(categoryId);
  const categoryDoc = await categoryRef.get();

  if (categoryDoc.exists) {
    const existingCategoryData = categoryDoc.data();

    if (hasStoreScopeMismatch(existingCategoryData, ownerId, service.storeId)) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.serviceGroup);
    }

    const categoryAlreadyMatchesService =
      existingCategoryData?.["name"] === groupName &&
      existingCategoryData["label"] === groupName &&
      existingCategoryData["category"] === service.category;

    if (categoryAlreadyMatchesService) {
      return categoryId;
    }

    await categoryRef.set(
      {
        ownerId,
        storeId: service.storeId,
        name: groupName,
        label: groupName,
        category: service.category,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    return categoryId;
  }

  const existingCategories = await getStoreCategories(firestoreDB, service.storeId)
    .where("ownerId", "==", ownerId)
    .get();
  const nextCategory = toServiceCategoryDocument(
    ownerId,
    service.storeId,
    groupName,
    service.category,
    existingCategories.size + 1,
  );
  await categoryRef.set(nextCategory);
  return categoryId;
};

export const createShopServiceCategoryFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    input: {
      storeId: string;
      name: string;
      label?: string;
      category: ShopServiceCategoryType;
    },
  ): Promise<{ category: ShopServiceCategoryDocumentType; created: boolean }> => {
    const groupName = input.name.trim();
    const categoryId = resolveShopServiceCategoryId(groupName, input.category);
    const categoriesCollection = getStoreCategories(firestoreDB, input.storeId);
    const categoryRef = categoriesCollection.doc(categoryId);
    const existingCategoryDoc = await categoryRef.get();

    if (existingCategoryDoc.exists) {
      const existingCategory = mapStoreScopedDocumentToShopData<ShopServiceCategoryDocumentType>(
        existingCategoryDoc,
        ownerId,
      );

      if (hasStoreScopeMismatch(existingCategoryDoc.data(), ownerId, input.storeId)) {
        throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.serviceGroup);
      }

      return {
        category: existingCategory,
        created: false,
      };
    }

    const existingCategories = await categoriesCollection.where("ownerId", "==", ownerId).get();
    const nextCategory = toServiceCategoryDocument(
      ownerId,
      input.storeId,
      groupName,
      input.category,
      existingCategories.size + 1,
    );
    const category = {
      ...nextCategory,
      ...(input.label !== undefined && { label: input.label }),
    };

    await categoryRef.set(category);
    await invalidateShopServiceCatalog(ownerId, input.storeId);

    return { category, created: true };
  };
};

export const invalidateShopServiceCatalog = async (
  ownerId: string,
  storeId?: string,
): Promise<void> => {
  const cachePrefix = getShopServiceCatalogCachePrefix(ownerId, storeId);

  if (!storeId) {
    await cacheDeleteByPrefix(cachePrefix);
    return;
  }

  await cacheDelete(getShopServiceCatalogCacheKey(ownerId, storeId));
};

export const getShopServiceCatalogFactory = (firestoreDB: Firestore) => {
  return async (ownerId: string, storeId: string): Promise<ShopServiceCatalogType> => {
    const cacheKey = getShopServiceCatalogCacheKey(ownerId, storeId);
    const cachedCatalog = await cacheGetJson<ShopServiceCatalogType>(cacheKey);

    if (cachedCatalog) {
      return cachedCatalog;
    }

    return runSingleFlight(cacheKey, async () => {
      const catalogCachedByAnotherRequest = await cacheGetJson<ShopServiceCatalogType>(cacheKey);

      if (catalogCachedByAnotherRequest) {
        return catalogCachedByAnotherRequest;
      }

      const categorySnapshot = await getStoreCategories(firestoreDB, storeId)
        .where("ownerId", "==", ownerId)
        .get();
      const categories = categorySnapshot.docs
        .filter((doc) => isStoreScopedDocumentData(doc.data(), ownerId, storeId))
        .map((doc) =>
          mapStoreScopedDocumentToShopData<ShopServiceCategoryDocumentType>(doc, ownerId),
        );

      const serviceSnapshot = await getCollectionGroup(firestoreDB, SERVICES_SUBCOLLECTION)
        .where("ownerId", "==", ownerId)
        .where("storeId", "==", storeId)
        .where("type", "==", "predefined")
        .get();
      const services = serviceSnapshot.docs
        .filter(
          (doc) =>
            isCategoryScopedServicePath(doc.ref.path) &&
            isStoreScopedDocumentData(doc.data(), ownerId, storeId),
        )
        .map((doc) => mapStoreScopedDocumentToShopData<ShopServiceType>(doc, ownerId));
      const catalog = buildShopServiceCatalog(ownerId, storeId, services, categories);

      await cacheSetJson(cacheKey, catalog, SERVICE_CATALOG_CACHE_TTL_MS);

      return catalog;
    });
  };
};
