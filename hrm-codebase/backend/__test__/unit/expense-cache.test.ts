import { Firestore } from "@google-cloud/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheDeleteByPrefixMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/repository/cache/cache-client.js", async (importOriginal) => {
  const cacheClientModule = await importOriginal<
    typeof import("../../src/repository/cache/cache-client.js")
  >();

  return {
    ...cacheClientModule,
    cacheDeleteByPrefix: cacheDeleteByPrefixMock,
  };
});

import {
  createShopExpensesFactory,
  deleteShopExpenseFactory,
  listShopExpensesFactory,
  updateShopExpenseFactory,
} from "../../src/repository/firestore/shop/shop-expense-factory.js";

const createExpenseData = () => ({
  id: "expense-1",
  ownerId: "owner-1",
  storeId: "store-1",
  workDate: "2026-07-23",
  name: "Supplies",
  amount: 120,
  createdByUserId: "owner-user-1",
  updatedByUserId: "owner-user-1",
  createdAt: 100,
  updatedAt: 100,
});

const createExpenseDocument = () => {
  const data = createExpenseData();
  return {
    id: data.id,
    exists: true,
    ref: {
      path: "stores/store-1/expenses/expense-1",
      delete: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
    data: () => data,
  };
};

const createFirestore = (document = createExpenseDocument()) => {
  const expenseQuery = {
    get: vi.fn().mockResolvedValue({ docs: [document] }),
    limit: vi.fn(),
    where: vi.fn(),
  };
  expenseQuery.limit.mockReturnValue(expenseQuery);
  expenseQuery.where.mockReturnValue(expenseQuery);
  const expenseCollection = {
    where: vi.fn().mockReturnValue(expenseQuery),
    doc: vi.fn((id?: string) =>
      id === undefined
        ? { id: "expense-auto-1" }
        : {
            id,
            get: vi.fn().mockResolvedValue(document),
            ref: document.ref,
          },
    ),
  };
  const batch = {
    commit: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(),
  };
  const firestoreDB = new Firestore({ projectId: "test-project" });

  Reflect.set(firestoreDB, "batch", vi.fn(() => batch));
  Reflect.set(
    firestoreDB,
    "collection",
    vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => expenseCollection),
      })),
    })),
  );

  return { firestoreDB, batch, expenseCollection, document, expenseQuery };
};

describe("shop expense repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates expenses with Firestore auto ids and no public code reservation", async () => {
    const { firestoreDB, batch } = createFirestore();
    const createShopExpenses = createShopExpensesFactory(firestoreDB);

    const [createdExpense] = await createShopExpenses("owner-1", [
      {
        storeId: "store-1",
        workDate: "2026-07-23",
        name: "Supplies",
        amount: 120,
        createdByUserId: "owner-user-1",
        updatedByUserId: "owner-user-1",
      },
    ]);

    expect(createdExpense?.id).toBe("expense-auto-1");
    expect(createdExpense).not.toHaveProperty("expenseCode");
    expect(batch.commit).toHaveBeenCalledOnce();
  });

  it("queries Firestore on every list request without an expense Redis cache", async () => {
    const { firestoreDB, expenseQuery } = createFirestore();
    const listShopExpenses = listShopExpensesFactory(firestoreDB);
    const filters = {
      storeId: "store-1",
      fromWorkDate: "2026-07-01",
      toWorkDate: "2026-07-31",
    };

    await listShopExpenses("owner-1", filters);
    await listShopExpenses("owner-1", filters);

    expect(expenseQuery.get).toHaveBeenCalledTimes(2);
  });

  it("uses the store document path for update and delete", async () => {
    const updateFirestore = createFirestore();
    const updateShopExpense = updateShopExpenseFactory(updateFirestore.firestoreDB);

    await updateShopExpense("owner-1", "store-1", "expense-1", { amount: 150 });

    expect(updateFirestore.document.ref.update).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 150 }),
    );

    const deleteFirestore = createFirestore();
    const deleteShopExpense = deleteShopExpenseFactory(deleteFirestore.firestoreDB);

    await deleteShopExpense("owner-1", "store-1", "expense-1");

    expect(deleteFirestore.document.ref.delete).toHaveBeenCalledOnce();
  });

  it("rejects documents owned by another owner", async () => {
    const document = createExpenseDocument();
    document.data = () => ({ ...createExpenseData(), ownerId: "other-owner" });
    const { firestoreDB } = createFirestore(document);
    const updateShopExpense = updateShopExpenseFactory(firestoreDB);

    await expect(updateShopExpense("owner-1", "store-1", "expense-1", { amount: 150 })).rejects.toThrow(
      "Shop expense not found",
    );
  });
});
