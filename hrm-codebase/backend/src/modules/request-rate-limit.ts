import type { NextFunction, Request, Response } from "express";
import { decodeFirebaseIdTokenUnverified } from "../helpers/firebase-token.js";
import { cacheIncrement } from "../repository/cache/cache-client.js";

export type RateLimitOptions = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
  message?: string;
  fingerprintBuilder?: (request: Request, defaultFingerprint: string) => string | undefined;
};

const getClientIp = (request: Request) => {
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
};

export const buildIpRateLimitFingerprint = (request: Request) => {
  return `ip:${getClientIp(request)}`;
};

const getBearerToken = (request: Request) => {
  const authorizationHeader = request.headers["authorization"];

  if (typeof authorizationHeader !== "string") {
    return undefined;
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/);

  return scheme === "Bearer" && token ? token : undefined;
};

const getRateLimitFingerprint = (request: Request) => {
  const clientIp = getClientIp(request);
  const token = getBearerToken(request);

  if (token) {
    const { uid, ownerId } = decodeFirebaseIdTokenUnverified(token);

    if (uid && ownerId) {
      return `user:${ownerId}:${uid}:ip:${clientIp}`;
    }
  }

  return `ip:${clientIp}`;
};

export const createRequestRateLimit = (options: RateLimitOptions) => {
  return async (request: Request, response: Response, next: NextFunction) => {
    const defaultFingerprint = getRateLimitFingerprint(request);
    const fingerprint =
      options.fingerprintBuilder?.(request, defaultFingerprint) ?? defaultFingerprint;
    const rateLimitKey = `${options.keyPrefix}:${fingerprint}`;
    const currentHits = await cacheIncrement(rateLimitKey, options.windowMs);
    const remaining = Math.max(0, options.limit - currentHits);

    response.setHeader("X-RateLimit-Limit", String(options.limit));
    response.setHeader("X-RateLimit-Remaining", String(remaining));
    response.setHeader("X-RateLimit-Window-Ms", String(options.windowMs));

    if (currentHits > options.limit) {
      const retryAfterSeconds = Math.ceil(options.windowMs / 1000);
      response.locals["requestError"] = {
        statusCode: 429,
        errorType: "/request/rate-limit",
        errorName: "RateLimitError",
        errorMessage: options.message ?? "Too many API requests",
        errorSource: "rate_limit",
        errorScope: options.keyPrefix,
      };
      response.setHeader("Retry-After", String(retryAfterSeconds));
      return response.status(429).json({
        type: "/request/rate-limit",
        message: options.message ?? "Too many requests",
        retryAfterSeconds,
      });
    }

    return next();
  };
};
