import type { NextFunction, Request, Response } from "express";
import { firebaseAuthRepository } from "../repository/firebase-auth/index.js";

type AppCheckMode = "off" | "monitor" | "required";

const APP_CHECK_HEADER = "x-firebase-appcheck";
const APP_CHECK_OPTIONAL_ROUTES = new Set([
  "POST /api/v1/auth/sessions",
  "POST /api/v1/auth/signin",
]);

const isAppCheckOptionalRoute = (request: Request) =>
  APP_CHECK_OPTIONAL_ROUTES.has(
    `${request.method.toUpperCase()} ${request.baseUrl}${request.path}`,
  );

const resolveAppCheckMode = (): AppCheckMode => {
  const configuredMode = process.env["APP_CHECK_MODE"];

  if (configuredMode === "off" || configuredMode === "monitor" || configuredMode === "required") {
    return configuredMode;
  }

  return process.env["NODE_ENV"] === "production" ? "required" : "off";
};

const getHeaderValue = (request: Request, headerName: string) => {
  const value = request.headers[headerName];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

export const verifyFirebaseAppCheck = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  if (isAppCheckOptionalRoute(request)) {
    next();
    return;
  }

  const mode = resolveAppCheckMode();

  if (mode === "off") {
    next();
    return;
  }

  const token = getHeaderValue(request, APP_CHECK_HEADER);

  if (!token) {
    if (mode === "monitor") {
      response.locals["appCheck"] = {
        mode,
        result: "failed",
        reason: "missing-token",
      };
      next();
      return;
    }

    response.locals["appCheck"] = {
      mode,
      result: "rejected",
      reason: "missing-token",
    };
    response.locals["requestError"] = {
      statusCode: 401,
      errorType: "/auth/app-check-required",
      errorName: "AppCheckError",
      errorMessage: "Firebase App Check token is required",
      errorSource: "authorization",
      errorScope: "app-check",
    };
    response.status(401).json({
      type: "/auth/app-check-required",
      message: "Firebase App Check token is required",
    });
    return;
  }

  try {
    await firebaseAuthRepository.appCheck.verifyToken(token);
    response.locals["appCheck"] = {
      mode,
      result: "verified",
    };
    next();
  } catch {
    if (mode === "monitor") {
      response.locals["appCheck"] = {
        mode,
        result: "failed",
        reason: "invalid-token",
      };
      next();
      return;
    }

    response.locals["appCheck"] = {
      mode,
      result: "rejected",
      reason: "invalid-token",
    };
    response.locals["requestError"] = {
      statusCode: 401,
      errorType: "/auth/app-check-invalid",
      errorName: "AppCheckError",
      errorMessage: "Firebase App Check token is invalid",
      errorSource: "authorization",
      errorScope: "app-check",
    };
    response.status(401).json({
      type: "/auth/app-check-invalid",
      message: "Firebase App Check token is invalid",
    });
  }
};
