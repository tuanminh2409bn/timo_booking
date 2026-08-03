import express from "express";
import { handleErrorFunction } from "../../modules/verify-error-function.js";
import { createShopExpenses } from "./expenses/post-create-shop-expenses.js";
import { deleteShopExpense } from "./expenses/delete-shop-expense.js";
import { getShopExpenses } from "./expenses/get-shop-expenses.js";
import { getStoreDetail } from "./stores/get-store-detail.js";
import { getStore } from "./stores/get-store.js";
import { createStore } from "./stores/post-create-store.js";
import { uploadShopExpenseReceiptImage } from "./expenses/post-upload-shop-expense-receipt-image.js";
import { updateStore } from "./stores/patch-update-store.js";
import { updateShopExpense } from "./expenses/patch-update-shop-expense.js";
import serviceRouter from "./services/index.js";
import customerRouter from "./customers/index.js";
import { observeBusinessHandler } from "../../modules/business-observability.js";
import { shopReadRateLimit, shopWriteRateLimit } from "./shop-rate-limits.js";

const SHOP_ROUTES = {
  stores: "/api/v1/stores",
  storeDetail: "/api/v1/stores/:storeId",
  expenses: "/api/v1/stores/:storeId/expenses",
  expenseReceiptUploads: "/api/v1/stores/:storeId/expense-receipts",
  expenseDetail: "/api/v1/stores/:storeId/expenses/:expenseId",
};

const shopRouter = express.Router();
shopRouter.post(
  SHOP_ROUTES.stores,
  shopWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "store.create",
        route: SHOP_ROUTES.stores,
      },
      createStore,
    ),
  ),
);
shopRouter.get(SHOP_ROUTES.stores, shopReadRateLimit, handleErrorFunction(getStore));
shopRouter.get(SHOP_ROUTES.expenses, shopReadRateLimit, handleErrorFunction(getShopExpenses));
shopRouter.post(
  SHOP_ROUTES.expenseReceiptUploads,
  shopWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "storage.expense_receipt.upload",
        route: SHOP_ROUTES.expenseReceiptUploads,
      },
      uploadShopExpenseReceiptImage,
    ),
  ),
);
shopRouter.post(
  SHOP_ROUTES.expenses,
  shopWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "store.expense.create",
        route: SHOP_ROUTES.expenses,
      },
      createShopExpenses,
    ),
  ),
);
shopRouter.patch(
  SHOP_ROUTES.expenseDetail,
  shopWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "store.expense.update",
        route: SHOP_ROUTES.expenseDetail,
      },
      updateShopExpense,
    ),
  ),
);
shopRouter.delete(
  SHOP_ROUTES.expenseDetail,
  shopWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "store.expense.delete",
        route: SHOP_ROUTES.expenseDetail,
      },
      deleteShopExpense,
    ),
  ),
);
shopRouter.get(SHOP_ROUTES.storeDetail, shopReadRateLimit, handleErrorFunction(getStoreDetail));
shopRouter.patch(
  SHOP_ROUTES.storeDetail,
  shopWriteRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "store.update",
        route: SHOP_ROUTES.storeDetail,
      },
      updateStore,
    ),
  ),
);

shopRouter.use(serviceRouter);
shopRouter.use(customerRouter);

export default shopRouter;
