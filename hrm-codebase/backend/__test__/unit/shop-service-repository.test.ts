import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it, vi } from "vitest";
import { FirestoreDataNotFoundError } from "../../src/constants/firestore-error.js";
import { getShopServiceByIdFactory } from "../../src/repository/firestore/shop/shop-service-factory.js";

type RecordedServiceQuery = Array<[field: string, value: unknown]>;

const createFirestoreWithServiceLookup = () => {
  const recordedQueries: RecordedServiceQuery[] = [];
  const serviceDocument = {
    id: "service-1",
    ref: {
      path: "stores/store-1/service_categories/category_nail/services/service-1",
    },
    data: () => ({
      id: "service-1",
      serviceCode: "DV-1",
      ownerId: "owner-1",
      storeId: "store-1",
      type: "predefined",
      name: "Classic Nail",
      category: "nail",
      price: 45,
      durationMin: 60,
      durationMax: 60,
    }),
  };

  const createQuery = (filters: RecordedServiceQuery = []) => ({
    where: (field: string, _operator: string, value: unknown) =>
      createQuery([...filters, [field, value]]),
    limit: () => createQuery(filters),
    get: () => {
      recordedQueries.push(filters);
      const requestedOwnerId = filters.find(([field]) => field === "ownerId")?.[1];
      const requestedStoreId = filters.find(([field]) => field === "storeId")?.[1];
      const requestedServiceId = filters.find(([field]) => field === "id")?.[1];
      const requestedServiceCode = filters.find(([field]) => field === "serviceCode")?.[1];
      const matchesService =
        requestedOwnerId === "owner-1" &&
        requestedStoreId === "store-1" &&
        (requestedServiceId === "service-1" || requestedServiceCode === "DV-1");

      return Promise.resolve({ docs: matchesService ? [serviceDocument] : [] });
    },
  });
  const firestoreDB = new Firestore({ projectId: "test-project" });

  Reflect.set(firestoreDB, "collectionGroup", vi.fn(() => createQuery()));

  return { firestoreDB, recordedQueries };
};

describe("shop service repository", () => {
  it("scopes service lookup to the expected store", async () => {
    const { firestoreDB, recordedQueries } = createFirestoreWithServiceLookup();
    const getShopServiceById = getShopServiceByIdFactory(firestoreDB);

    const service = await getShopServiceById("owner-1", "service-1", "store-1");

    expect(service).toMatchObject({ id: "service-1", storeId: "store-1" });
    expect(recordedQueries).toContainEqual([
      ["ownerId", "owner-1"],
      ["id", "service-1"],
      ["storeId", "store-1"],
    ]);
  });

  it("does not return a service from a different store", async () => {
    const { firestoreDB, recordedQueries } = createFirestoreWithServiceLookup();
    const getShopServiceById = getShopServiceByIdFactory(firestoreDB);

    await expect(getShopServiceById("owner-1", "service-1", "store-2")).rejects.toBeInstanceOf(
      FirestoreDataNotFoundError,
    );
    expect(recordedQueries.every((query) => query.some(([field]) => field === "storeId"))).toBe(
      true,
    );
  });
});
