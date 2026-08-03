import type { Firestore } from "@google-cloud/firestore";
import { DB_NOT_FOUND, FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { getStoreSubcollection } from "../collection-paths.js";
import {
  isStoreScopedDocumentData,
  mapStoreScopedDocumentToShopData,
  toStoreScopedWritePayload,
} from "../store-document-mapper.js";
import type { ShopExpenseType } from "./shop.types.js";

const EXPENSES_SUBCOLLECTION = "expenses";

const getStoreExpenses = (firestoreDB: Firestore, storeId: string) =>
  getStoreSubcollection(firestoreDB, storeId, EXPENSES_SUBCOLLECTION);

export const createShopExpensesFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    expenses: Array<Omit<ShopExpenseType, "id" | "ownerId" | "createdAt" | "updatedAt">>,
  ): Promise<ShopExpenseType[]> => {
    const batch = firestoreDB.batch();
    const timestamp = Date.now();
    const createdExpenses = expenses.map((expense) => {
      const document = getStoreExpenses(firestoreDB, expense.storeId).doc();
      const createdExpense: ShopExpenseType = {
        id: document.id,
        ownerId,
        ...expense,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      batch.set(document, toStoreScopedWritePayload(ownerId, createdExpense));
      return createdExpense;
    });

    await batch.commit();

    return createdExpenses;
  };
};

export const getShopExpenseFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    expenseId: string,
  ): Promise<ShopExpenseType> => {
    const document = await getStoreExpenses(firestoreDB, storeId).doc(expenseId).get();

    if (!document.exists || !isStoreScopedDocumentData(document.data(), ownerId, storeId)) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.expense);
    }

    return mapStoreScopedDocumentToShopData<ShopExpenseType>(document, ownerId);
  };
};

export const listShopExpensesFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    filters: { storeId: string; fromWorkDate: string; toWorkDate: string; limit?: number },
  ): Promise<ShopExpenseType[]> => {
    let query = getStoreExpenses(firestoreDB, filters.storeId)
      .where("workDate", ">=", filters.fromWorkDate)
      .where("workDate", "<=", filters.toWorkDate);

    if (filters.limit !== undefined) {
      query = query.limit(filters.limit);
    }

    const snapshot = await query.get();

    return snapshot.docs
      .filter((document) => isStoreScopedDocumentData(document.data(), ownerId, filters.storeId))
      .map((document) => mapStoreScopedDocumentToShopData<ShopExpenseType>(document, ownerId))
      .sort((left, right) => {
        if (left.workDate !== right.workDate) {
          return right.workDate.localeCompare(left.workDate);
        }

        return right.createdAt - left.createdAt;
      });
  };
};

export const updateShopExpenseFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    expenseId: string,
    expenseData: Partial<
      Omit<ShopExpenseType, "id" | "ownerId" | "storeId" | "createdAt" | "updatedAt">
    >,
  ): Promise<ShopExpenseType> => {
    const existingDocument = await getStoreExpenses(firestoreDB, storeId).doc(expenseId).get();

    if (
      !existingDocument.exists ||
      !isStoreScopedDocumentData(existingDocument.data(), ownerId, storeId)
    ) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.expense);
    }

    const existingExpense = mapStoreScopedDocumentToShopData<ShopExpenseType>(
      existingDocument,
      ownerId,
    );
    const updatedExpense: ShopExpenseType = {
      ...existingExpense,
      ...expenseData,
      updatedAt: Date.now(),
    };

    await existingDocument.ref.update({
      ...expenseData,
      updatedAt: updatedExpense.updatedAt,
    });

    return updatedExpense;
  };
};

export const deleteShopExpenseFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    expenseId: string,
  ): Promise<ShopExpenseType> => {
    const existingDocument = await getStoreExpenses(firestoreDB, storeId).doc(expenseId).get();

    if (
      !existingDocument.exists ||
      !isStoreScopedDocumentData(existingDocument.data(), ownerId, storeId)
    ) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.expense);
    }

    const existingExpense = mapStoreScopedDocumentToShopData<ShopExpenseType>(
      existingDocument,
      ownerId,
    );

    await existingDocument.ref.delete();

    return existingExpense;
  };
};
