import type { Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { can } from "../../../helpers/permissions.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import type { StoreType } from "../../../repository/firestore/shop/shop.types.js";
import type { UserType } from "../../../repository/firestore/user/user.types.js";

export const EXPENSE_ERRORS = {
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/expenses/expense-forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/expenses/invalid-expense-request",
    message: "Invalid expense request",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/expenses/forbidden-store",
    message: "Forbidden: store access denied",
  },
  notFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/expenses/expense-not-found",
    message: "Expense not found",
  },
  invalidReceiptUpload: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/expenses/invalid-expense-receipt-upload-request",
    message: "Invalid expense receipt upload request",
  },
  receiptFileTooLarge: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/expenses/expense-receipt-file-too-large",
    message: "Expense receipt image must be 8MB or smaller",
  },
};

export const rejectUnlessCanManageStore = (res: Response, role: UserType["role"]) => {
  if (can(role, "expense:manage")) {
    return false;
  }

  createErrorResponse(res, EXPENSE_ERRORS.forbiddenRole, { role });
  return true;
};

export const resolveActiveExpenseStore = async (
  ownerId: string,
  storeId: string,
): Promise<StoreType | null> => {
  try {
    const store = await firestoreRepository.shop.store.getStore(ownerId, storeId);

    return store.status === "active" ? store : null;
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return null;
    }

    throw error;
  }
};
