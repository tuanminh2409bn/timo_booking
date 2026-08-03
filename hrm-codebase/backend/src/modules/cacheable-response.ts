import type { Request, Response } from "express";
import { cacheGetJson, cacheSetJson, runSingleFlight } from "../repository/cache/cache-client.js";
import { sendCacheableJson } from "./send-cacheable-json.js";
import type { ServerTiming } from "./server-timing.js";

type CacheableResponseOptions<TPayload> = {
  request: Request;
  response: Response;
  cacheKey: string;
  ttlMs: number;
  producer: () => Promise<TPayload>;
  cacheControl?: string;
  timing?: ServerTiming;
};

export const getOrSetCacheableResponse = async <TPayload>({
  request,
  response,
  cacheKey,
  ttlMs,
  producer,
  cacheControl,
  timing,
}: CacheableResponseOptions<TPayload>) => {
  const cachedPayload = timing
    ? await timing.measure("cache_read", () => cacheGetJson<TPayload>(cacheKey))
    : await cacheGetJson<TPayload>(cacheKey);

  if (cachedPayload !== undefined) {
    response.setHeader("X-Cache", "HIT");
    if (timing) {
      response.setHeader("Server-Timing", timing.header());
      response.locals["serverTiming"] = timing.toObject();
    }
    return sendCacheableJson(request, response, cachedPayload, {
      ...(cacheControl !== undefined && { cacheControl }),
    });
  }

  const payload = await runSingleFlight(cacheKey, async () => {
    const nextPayload = timing ? await timing.measure("producer", producer) : await producer();

    if (timing) {
      await timing.measure("cache_write", () => cacheSetJson(cacheKey, nextPayload, ttlMs));
    } else {
      await cacheSetJson(cacheKey, nextPayload, ttlMs);
    }

    return nextPayload;
  });

  response.setHeader("X-Cache", "MISS");
  if (timing) {
    response.setHeader("Server-Timing", timing.header());
    response.locals["serverTiming"] = timing.toObject();
  }
  return sendCacheableJson(request, response, payload, {
    ...(cacheControl !== undefined && { cacheControl }),
  });
};
