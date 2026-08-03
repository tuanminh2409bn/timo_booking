import { StatusCodes } from "http-status-codes";

import APIResponseError from "./api-response-error.js";

export const ERROR_TYPES = { FIREBASE_ERROR: "/firebase/error" } as const;

class FirebaseCannotVerifyIdTokenError extends APIResponseError {
  constructor(
    message = "Firebase cannot verify ID token",
    type = ERROR_TYPES.FIREBASE_ERROR,
    statusCode = StatusCodes.UNAUTHORIZED,
  ) {
    super(message, type, statusCode);
  }
}

export { FirebaseCannotVerifyIdTokenError };
