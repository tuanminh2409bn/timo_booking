import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { decodeFirebaseIdTokenUnverified } from "../helpers/firebase-token.js";
import { cacheGetJson, cacheSetJson } from "../repository/cache/cache-client.js";

type IdempotencyRecord = {
  bodyHash: string;
  statusCode: number;
  contentType?: string;
  body?: string;
};

type InFlightRecord = {
  bodyHash: string;
  promise: Promise<IdempotencyRecord>;
  resolve: (record: IdempotencyRecord) => void;
};

const IDEMPOTENCY_HEADER = "x-idempotency-key";
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const MUTATING_METHODS = new Set(["POST", "PATCH", "DELETE"]);
const inFlightRecords = new Map<string, InFlightRecord>();

const stableStringify = (value: unknown): string => {
  if (value === undefined) {
    return "null";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
};

const hashValue = (value: unknown) =>
  createHash("sha256").update(stableStringify(value)).digest("hex");

const hashString = (value: string) => createHash("sha256").update(value).digest("hex");

const getClientIp = (request: Request) => request.ip ?? request.socket.remoteAddress ?? "unknown";

const getHeaderValue = (request: Request, headerName: string) => {
  const value = request.headers[headerName];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const getBearerToken = (request: Request) => {
  const authorizationHeader = getHeaderValue(request, "authorization");

  if (typeof authorizationHeader !== "string") {
    return undefined;
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/);

  return scheme === "Bearer" && token ? token : undefined;
};

const getRequestScope = (request: Request) => {
  const token = getBearerToken(request);

  if (token) {
    const { uid, ownerId } = decodeFirebaseIdTokenUnverified(token);

    if (uid && ownerId) {
      return `store:${ownerId}:user:${uid}`;
    }
  }

  return `ip:${getClientIp(request)}`;
};

const getIdempotencyCacheKey = (request: Request, idempotencyKey: string) =>
  [
    "idempotency",
    getRequestScope(request),
    request.method,
    request.path,
    hashString(idempotencyKey),
  ].join(":");

const createDeferredRecord = (bodyHash: string): InFlightRecord => {
  let resolveRecord: (record: IdempotencyRecord) => void = () => undefined;
  const promise = new Promise<IdempotencyRecord>((resolve) => {
    resolveRecord = resolve;
  });

  return {
    bodyHash,
    promise,
    resolve: resolveRecord,
  };
};

const normalizeResponseBody = (body: unknown): string | undefined => {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }

  if (typeof body === "string") {
    return body;
  }

  return JSON.stringify(body);
};

const replayRecord = (response: Response, record: IdempotencyRecord) => {
  response.setHeader("X-Idempotency-Replayed", "true");

  if (record.contentType) {
    response.setHeader("Content-Type", record.contentType);
  }

  if (record.body === undefined) {
    response.status(record.statusCode).end();
    return;
  }

  response.status(record.statusCode).send(record.body);
};

const sendConflict = (response: Response) =>
  response.status(409).json({
    type: "/request/idempotency-conflict",
    message: "Idempotency key was already used with a different request body",
  });

export const createIdempotencyMiddleware = () => {
  return async (request: Request, response: Response, next: NextFunction) => {
    if (!MUTATING_METHODS.has(request.method)) {
      next();
      return;
    }

    const idempotencyKey = getHeaderValue(request, IDEMPOTENCY_HEADER);

    if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
      next();
      return;
    }

    const normalizedIdempotencyKey = idempotencyKey.trim();

    if (normalizedIdempotencyKey.length > 200) {
      response.status(400).json({
        type: "/request/invalid-idempotency-key",
        message: "Idempotency key is too long",
      });
      return;
    }

    const bodyHash = hashValue({
      body: request.body ?? null,
      query: request.query,
    });
    const cacheKey = getIdempotencyCacheKey(request, normalizedIdempotencyKey);
    const cachedRecord = await cacheGetJson<IdempotencyRecord>(cacheKey);

    if (cachedRecord) {
      if (cachedRecord.bodyHash !== bodyHash) {
        sendConflict(response);
        return;
      }

      replayRecord(response, cachedRecord);
      return;
    }

    const existingInFlight = inFlightRecords.get(cacheKey);

    if (existingInFlight) {
      if (existingInFlight.bodyHash !== bodyHash) {
        sendConflict(response);
        return;
      }

      replayRecord(response, await existingInFlight.promise);
      return;
    }

    const inFlightRecord = createDeferredRecord(bodyHash);
    inFlightRecords.set(cacheKey, inFlightRecord);
    let isSettled = false;

    const completeRecord = (body: unknown) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      const contentTypeHeader = response.getHeader("Content-Type");
      const normalizedBody = normalizeResponseBody(body);
      const nextRecord: IdempotencyRecord = {
        bodyHash,
        statusCode: response.statusCode,
        ...(typeof contentTypeHeader === "string" && { contentType: contentTypeHeader }),
        ...(normalizedBody !== undefined && { body: normalizedBody }),
      };

      const settleInFlightRecord = () => {
        inFlightRecords.delete(cacheKey);
        inFlightRecord.resolve(nextRecord);
      };

      if (response.statusCode < 500) {
        void cacheSetJson(cacheKey, nextRecord, IDEMPOTENCY_TTL_MS).then(
          settleInFlightRecord,
          settleInFlightRecord,
        );
        return;
      }

      settleInFlightRecord();
    };

    response.once("close", () => {
      if (isSettled || response.writableEnded) {
        return;
      }

      isSettled = true;
      inFlightRecords.delete(cacheKey);
      inFlightRecord.resolve({
        bodyHash,
        statusCode: 503,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          type: "/request/idempotency-in-flight-aborted",
          message: "The original request ended before producing a response",
        }),
      });
    });

    const originalSend = response.send.bind(response);
    const originalEnd = response.end.bind(response);

    response.send = ((body?: unknown) => {
      completeRecord(body);
      return originalSend(body);
    }) as Response["send"];

    response.end = ((chunk?: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
      completeRecord(chunk);
      return originalEnd(
        chunk as Parameters<Response["end"]>[0],
        encodingOrCallback as Parameters<Response["end"]>[1],
        callback as Parameters<Response["end"]>[2],
      );
    }) as Response["end"];

    next();
  };
};
