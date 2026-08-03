import { StatusCodes } from "http-status-codes";
import APIResponseError from "./api-response-error.js";

class NoAuthorizedHeader extends APIResponseError {
  constructor(
    message = "API header error",
    type = "/auth/header-missing",
    statusCode = StatusCodes.UNAUTHORIZED,
  ) {
    super(message, type, statusCode);
  }
}

class TokenNotFoundInHeaderError extends APIResponseError {
  constructor(
    message = "Token not found in header",
    type = "/auth/token-missing",
    statusCode = StatusCodes.UNAUTHORIZED,
  ) {
    super(message, type, statusCode);
  }
}

class RevokedAuthorizedTokenError extends APIResponseError {
  constructor(
    message = "Authorized token is revoked",
    type = "/auth/token-revoked",
    statusCode = StatusCodes.UNAUTHORIZED,
  ) {
    super(message, type, statusCode);
  }
}

class InvalidAuthorizedTokenError extends APIResponseError {
  constructor(
    message = "Authorized token is invalid",
    type = "/auth/token-invalid",
    statusCode = StatusCodes.UNAUTHORIZED,
  ) {
    super(message, type, statusCode);
  }
}

class ExpiredAuthorizedTokenError extends APIResponseError {
  constructor(
    message = "Authorized token expired",
    type = "/auth/token-expired",
    statusCode = StatusCodes.UNAUTHORIZED,
  ) {
    super(message, type, statusCode);
  }
}

export {
  ExpiredAuthorizedTokenError,
  InvalidAuthorizedTokenError,
  NoAuthorizedHeader,
  TokenNotFoundInHeaderError,
  RevokedAuthorizedTokenError,
};
