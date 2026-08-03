import { Firestore } from "@google-cloud/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cachedValues = vi.hoisted(() => new Map<string, unknown>());
const cacheGetJsonMock = vi.hoisted(() => vi.fn());
const cacheSetJsonMock = vi.hoisted(() => vi.fn());
const cacheDeleteMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/repository/cache/cache-client.js", async (importOriginal) => {
  const cacheClientModule =
    await importOriginal<typeof import("../../src/repository/cache/cache-client.js")>();

  return {
    ...cacheClientModule,
    cacheDelete: cacheDeleteMock,
    cacheDeleteByPrefix: vi.fn().mockResolvedValue(undefined),
    cacheGetJson: cacheGetJsonMock,
    cacheSetJson: cacheSetJsonMock,
  };
});

import {
  getShopServiceCatalogFactory,
  invalidateShopServiceCatalog,
  SERVICE_CATALOG_CACHE_TTL_MS,
} from "../../src/repository/firestore/shop/shop-service-catalog-factory.js";
import { getShopServiceFactory } from "../../src/repository/firestore/shop/shop-service-factory.js";

const createFirestoreWithServiceCatalog = (
  options: { categoryName?: string; categoryUpdatedAt?: number } = {},
) => {
  const categoryName = options.categoryName ?? "Nail";
  const categoryUpdatedAt = options.categoryUpdatedAt ?? 100;
  const getCategoryDocuments = vi.fn().mockResolvedValue({
    docs: [
      {
        id: "category_nail",
        ref: { path: "stores/store-1/service_categories/category_nail" },
        data: () => ({
          id: "category_nail",
          ownerId: "owner-1",
          storeId: "store-1",
          name: categoryName,
          label: categoryName,
          category: "nail",
          sortOrder: 1,
          serviceCount: 1,
          createdAt: 100,
          updatedAt: categoryUpdatedAt,
        }),
      },
    ],
  });
  const getServiceDocuments = vi.fn().mockResolvedValue({
    docs: [
      {
        id: "service-1",
        ref: {
          path: "stores/store-1/service_categories/category_nail/services/service-1",
        },
        data: () => ({
          id: "service-1",
          ownerId: "owner-1",
          storeId: "store-1",
          serviceCategoryId: "category_nail",
          type: "predefined",
          name: "Classic Nail",
          category: "nail",
          groupService: "Nail",
          price: 45,
          durationMin: 60,
          durationMax: 60,
          createdAt: 100,
          updatedAt: 100,
        }),
      },
    ],
  });
  const serviceCollection = {
    where: vi.fn(() => serviceCollection),
    get: getServiceDocuments,
  };
  const categoryCollection = {
    where: vi.fn(() => categoryCollection),
    get: getCategoryDocuments,
    doc: vi.fn(() => ({
      collection: vi.fn(() => serviceCollection),
    })),
  };
  const firestoreDB = new Firestore({ projectId: "test-project" });

  Reflect.set(
    firestoreDB,
    "collection",
    vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => categoryCollection),
      })),
    })),
  );
  Reflect.set(
    firestoreDB,
    "collectionGroup",
    vi.fn(() => serviceCollection),
  );

  return { firestoreDB, getCategoryDocuments, getServiceDocuments };
};

describe("service catalog cache", () => {
  beforeEach(() => {
    cachedValues.clear();
    vi.clearAllMocks();
    cacheGetJsonMock.mockImplementation((key: string) => Promise.resolve(cachedValues.get(key)));
    cacheSetJsonMock.mockImplementation((key: string, value: unknown) => {
      cachedValues.set(key, value);
      return Promise.resolve();
    });
    cacheDeleteMock.mockImplementation((key: string) => {
      cachedValues.delete(key);
      return Promise.resolve();
    });
  });

  it("shares one canonical catalog cache with the flat service list", async () => {
    const { firestoreDB, getCategoryDocuments, getServiceDocuments } =
      createFirestoreWithServiceCatalog();
    const getServiceCatalog = getShopServiceCatalogFactory(firestoreDB);
    const getServices = getShopServiceFactory(firestoreDB);

    const catalog = await getServiceCatalog("owner-1", "store-1");
    const services = await getServices("owner-1", "store-1");

    expect(catalog.serviceCount).toBe(1);
    expect(catalog.createdAt).toBe(100);
    expect(catalog.updatedAt).toBe(100);
    expect(services).toHaveLength(1);
    expect(services[0]?.name).toBe("Classic Nail");
    expect(getCategoryDocuments).toHaveBeenCalledOnce();
    expect(getServiceDocuments).toHaveBeenCalledOnce();
    expect(cacheSetJsonMock).toHaveBeenCalledWith(
      "store:owner-1:service-catalog:store-1:current",
      expect.objectContaining({ serviceCount: 1 }),
      SERVICE_CATALOG_CACHE_TTL_MS,
    );
  });

  it("reloads Firestore after the store catalog is invalidated", async () => {
    const { firestoreDB, getCategoryDocuments, getServiceDocuments } =
      createFirestoreWithServiceCatalog();
    const getServiceCatalog = getShopServiceCatalogFactory(firestoreDB);

    await getServiceCatalog("owner-1", "store-1");
    await invalidateShopServiceCatalog("owner-1", "store-1");
    await getServiceCatalog("owner-1", "store-1");

    expect(cacheDeleteMock).toHaveBeenCalledWith("store:owner-1:service-catalog:store-1:current");
    expect(getCategoryDocuments).toHaveBeenCalledTimes(2);
    expect(getServiceDocuments).toHaveBeenCalledTimes(2);
  });

  it("changes the catalog version when service-group metadata changes", async () => {
    const firstFirestore = createFirestoreWithServiceCatalog();
    const firstCatalog = await getShopServiceCatalogFactory(firstFirestore.firestoreDB)(
      "owner-1",
      "store-1",
    );

    await invalidateShopServiceCatalog("owner-1", "store-1");

    const renamedCategoryFirestore = createFirestoreWithServiceCatalog({
      categoryName: "Nail Premium",
      categoryUpdatedAt: 200,
    });
    const renamedCategoryCatalog = await getShopServiceCatalogFactory(
      renamedCategoryFirestore.firestoreDB,
    )("owner-1", "store-1");

    expect(renamedCategoryCatalog.version).not.toBe(firstCatalog.version);
    expect(renamedCategoryCatalog.updatedAt).toBe(200);
  });

  it("deduplicates concurrent catalog cache misses in one process", async () => {
    const { firestoreDB, getCategoryDocuments, getServiceDocuments } =
      createFirestoreWithServiceCatalog();
    const getServiceCatalog = getShopServiceCatalogFactory(firestoreDB);

    const [firstCatalog, secondCatalog] = await Promise.all([
      getServiceCatalog("owner-1", "store-1"),
      getServiceCatalog("owner-1", "store-1"),
    ]);

    expect(firstCatalog.version).toBe(secondCatalog.version);
    expect(getCategoryDocuments).toHaveBeenCalledOnce();
    expect(getServiceDocuments).toHaveBeenCalledOnce();
  });
});
