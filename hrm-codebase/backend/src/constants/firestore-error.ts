import { StatusCodes } from "http-status-codes";
import APIResponseError from "./api-response-error.js";
export const ERROR_TYPES = { FIRESTORE_ERROR: "/database/error" } as const;

/**
 * Entity-specific "not found" descriptors (message + type) so that a bubbled-up
 * 404 identifies which record was missing in structured logs and responses,
 * instead of the generic "Data not found" / "/database/error".
 *
 * Spread into `new FirestoreDataNotFoundError(...DB_NOT_FOUND.store)`.
 */
export const DB_NOT_FOUND = {
  store: ["Store not found", "/database/store-not-found"],
  attendance: ["Shop attendance not found", "/database/attendance-not-found"],
  service: ["Shop service not found", "/database/service-not-found"],
  serviceGroup: ["Shop service group not found", "/database/service-group-not-found"],
  expense: ["Shop expense not found", "/database/expense-not-found"],
  leaveRequest: ["Employee leave request not found", "/database/leave-request-not-found"],
  user: ["User not found", "/database/user-not-found"],
} as const;

class FirestoreDataExistingError extends APIResponseError {
  constructor(
    message = "Data existing already",
    type = ERROR_TYPES.FIRESTORE_ERROR,
    statusCode = StatusCodes.CONFLICT,
  ) {
    super(message, type, statusCode);
  }
}

class FirestoreDataNotFoundError extends APIResponseError {
  constructor(
    message = "Data not found",
    type: string = ERROR_TYPES.FIRESTORE_ERROR,
    statusCode = StatusCodes.NOT_FOUND,
  ) {
    super(message, type, statusCode);
  }
}

class FirestoreDataConflictError extends APIResponseError {
  constructor(
    message = "Data conflict",
    type = ERROR_TYPES.FIRESTORE_ERROR,
    statusCode = StatusCodes.CONFLICT,
  ) {
    super(message, type, statusCode);
  }
}

class FirestoreDataValidationError extends APIResponseError {
  constructor(
    message = "Stored Firestore data is invalid",
    type = "/database/invalid-document",
    statusCode = StatusCodes.INTERNAL_SERVER_ERROR,
  ) {
    super(message, type, statusCode);
  }
}

export {
  FirestoreDataConflictError,
  FirestoreDataNotFoundError,
  FirestoreDataExistingError,
  FirestoreDataValidationError,
};
