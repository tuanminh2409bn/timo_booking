import type { Response } from "express";

type ErrorResponseType = {
  statusCode: number;
  type: string;
  message: string;
};

export type ErrorResponseBodyType = {
  type: string;
  message: string;
};

export const createErrorResponse = (
  res: Response,
  config: ErrorResponseType,
  context?: Record<string, unknown>,
) => {
  let errorSource = "other";
  let errorScope = "application";

  if (config.type.startsWith("/database/")) {
    errorSource = "firestore";
    errorScope = "query";
  } else if (config.statusCode === 401 || config.statusCode === 403) {
    errorSource = "authorization";
    errorScope = "authorization";
  } else if (config.statusCode === 400) {
    errorSource = "validation";
    errorScope = "request";
  } else if (config.statusCode === 409 || config.statusCode === 404) {
    errorSource = "logic";
    errorScope = "domain";
  } else if (config.statusCode === 429) {
    errorSource = "rate_limit";
    errorScope = "middleware";
  } else if (config.type.includes("dependency")) {
    errorSource = "dependency";
    errorScope = "external";
  }

  res.locals["requestError"] = {
    errorType: config.type,
    errorName: "ServiceError",
    errorMessage: config.message,
    statusCode: config.statusCode,
    errorSource,
    errorScope,
    ...(context !== undefined && { errorContext: context }),
  };

  return res.status(config.statusCode).json({
    type: config.type,
    message: config.message,
  });
};
