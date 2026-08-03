import type { ShopExpenseType } from "../../../repository/firestore/shop/shop.types.js";
import { toPublicStoreId } from "../stores/store-response.js";

export const toShopExpenseResponse = (expense: ShopExpenseType) => ({
  id: expense.id,
  ownerId: expense.ownerId,
  storeId: expense.storeId,
  storeCode: toPublicStoreId(expense.storeId),
  workDate: expense.workDate,
  name: expense.name,
  ...(expense.supplierName !== undefined && { supplierName: expense.supplierName }),
  ...(expense.note !== undefined && { note: expense.note }),
  amount: expense.amount,
  ...(expense.receiptImage !== undefined && { receiptImage: expense.receiptImage }),
  createdByUserId: expense.createdByUserId,
  updatedByUserId: expense.updatedByUserId,
  createdAt: expense.createdAt,
  updatedAt: expense.updatedAt,
});

export const toShopExpenseListResponse = (expenses: ShopExpenseType[]) => ({
  items: expenses.map(toShopExpenseResponse),
  totalAmount: expenses.reduce((sum, expense) => sum + expense.amount, 0),
  count: expenses.length,
});
