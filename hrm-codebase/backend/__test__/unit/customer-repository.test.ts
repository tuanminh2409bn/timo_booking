import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it, vi } from "vitest";
import {
  getShopCustomerFactory,
  listShopCustomerAttendancesFactory,
  listShopCustomersFactory,
} from "../../src/repository/firestore/shop/shop-customer-factory.js";

const createCustomerDocument = (overrides: Record<string, unknown> = {}) => ({
  id: "customer-1",
  data: () => ({
    ownerId: "owner-1",
    storeId: "store-1",
    phone: "+84123456",
    customerCode: "KH-1",
    name: "Mai Nguyen",
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  }),
});

const createFirestoreQuery = (
  documents: Array<{ id: string; data: () => Record<string, unknown> }>,
) => {
  const query = {
    select: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    startAfter: vi.fn(),
    limit: vi.fn(),
    get: vi.fn().mockResolvedValue({ docs: documents }),
  };

  query.select.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.startAfter.mockReturnValue(query);
  query.limit.mockReturnValue(query);

  return query;
};

const createFirestore = (query: ReturnType<typeof createFirestoreQuery>) => {
  const firestoreDB = new Firestore({ projectId: "test-project" });
  const customerDocument = createCustomerDocument();

  Reflect.set(
    firestoreDB,
    "collection",
    vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => query),
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: customerDocument.data,
        }),
      })),
    })),
  );

  return firestoreDB;
};

describe("customer Firestore repository", () => {
  it("projects and validates customer list documents", async () => {
    const query = createFirestoreQuery([createCustomerDocument()]);
    const firestoreDB = createFirestore(query);

    const result = await listShopCustomersFactory(firestoreDB)("owner-1", "store-1", { limit: 20 });

    expect(result.customers).toEqual([
      {
        id: "customer-1",
        ownerId: "owner-1",
        storeId: "store-1",
        phone: "+84123456",
        customerCode: "KH-1",
        name: "Mai Nguyen",
        blocked: false,
        createdAt: 100,
        updatedAt: 100,
      },
    ]);
    expect(query.select).toHaveBeenCalledWith(
      "ownerId",
      "storeId",
      "phone",
      "customerCode",
      "name",
      "blocked",
      "blockedReason",
      "blockedByUserId",
      "blockedByRole",
      "blockedAt",
      "unblockedByUserId",
      "unblockedByRole",
      "unblockedAt",
      "archivedAttendanceCounters",
      "createdAt",
      "updatedAt",
    );
  });

  it("rejects invalid customer documents at the repository boundary", async () => {
    const query = createFirestoreQuery([createCustomerDocument({ phone: "" })]);
    const firestoreDB = createFirestore(query);

    await expect(
      listShopCustomersFactory(firestoreDB)("owner-1", "store-1", { limit: 20 }),
    ).rejects.toMatchObject({
      statusCode: 500,
      type: "/database/invalid-document",
    });
  });

  it("returns only the customer attendance history projection", async () => {
    const query = createFirestoreQuery([
      {
        id: "attendance-1",
        data: () => ({
          ownerId: "owner-1",
          storeId: "store-1",
          customerId: "customer-1",
          attendanceCode: "BK-1",
          workDate: "2026-07-23",
          startTime: 600,
          endTime: 660,
          status: "closed",
          bookingStatus: "confirmed",
          services: [
            {
              id: "service-1",
              name: "Manicure",
              price: 50,
              ownerId: "owner-1",
            },
          ],
          note: "not returned",
        }),
      },
    ]);
    const firestoreDB = createFirestore(query);

    const result = await listShopCustomerAttendancesFactory(firestoreDB)(
      "owner-1",
      "store-1",
      "customer-1",
      { limit: 20 },
    );

    expect(result.attendances).toEqual([
      {
        id: "attendance-1",
        attendanceCode: "BK-1",
        workDate: "2026-07-23",
        startTime: 600,
        endTime: 660,
        status: "closed",
        bookingStatus: "confirmed",
        services: [{ id: "service-1", name: "Manicure" }],
      },
    ]);
    expect(query.select).toHaveBeenCalledWith(
      "ownerId",
      "storeId",
      "customerId",
      "attendanceCode",
      "workDate",
      "startTime",
      "endTime",
      "status",
      "bookingStatus",
      "services",
    );
  });

  it("rejects an invalid customer document lookup", async () => {
    const query = createFirestoreQuery([]);
    const firestoreDB = createFirestore(query);
    Reflect.set(
      firestoreDB,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            doc: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => createCustomerDocument({ phone: "" }).data(),
              }),
            })),
          })),
        })),
      })),
    );

    await expect(
      getShopCustomerFactory(firestoreDB)("owner-1", "store-1", "customer-1"),
    ).rejects.toMatchObject({
      statusCode: 500,
      type: "/database/invalid-document",
    });
  });
});
