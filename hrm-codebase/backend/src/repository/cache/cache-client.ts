import { createClient } from "redis";
import { logger } from "../../modules/logger.js";
import { getRequestContext } from "../../modules/request-context.js";

type RedisClient = ReturnType<typeof createClient>;

type MemoryCacheEntry = {
  expiresAt: number;
  value: string;
};

type MemoryCounterEntry = {
  count: number;
  expiresAt: number;
};

const memoryCache = new Map<string, MemoryCacheEntry>();
const memoryCounterCache = new Map<string, MemoryCounterEntry>();
const inFlightCache = new Map<string, Promise<unknown>>();

export type SingleFlightRole = "leader" | "waiter";

type SingleFlightOptions = {
  onRole?: (role: SingleFlightRole) => void;
};
const MEMORY_CACHE_MAX_ENTRIES = 5_000;

let redisClientPromise: Promise<RedisClient | null> | null = null;
let redisUnavailable = false;
let warnedRedisUnavailable = false;
// After a Redis failure, fall back to memory cache only for a cooldown window, then retry —
// otherwise a single transient blip disables Redis for the whole process lifetime (so on
// multi-instance Cloud Run, cache + rate-limit silently drift to per-instance state forever).
let redisRetryAfter = 0;
const REDIS_RETRY_COOLDOWN_MS = 30_000;

const warnRedisUnavailableOnce = (error: unknown) => {
  if (warnedRedisUnavailable || process.env["NODE_ENV"] === "test") {
    return;
  }

  warnedRedisUnavailable = true;
  const message = error instanceof Error ? error.message : String(error);
  logger.warn({ errorMessage: message }, "Redis cache unavailable; using memory fallback");
};

const pruneExpiredMemoryEntries = (now: number) => {
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) {
      memoryCache.delete(key);
    }
  }

  for (const [key, entry] of memoryCounterCache) {
    if (entry.expiresAt <= now) {
      memoryCounterCache.delete(key);
    }
  }
};

const enforceMemoryCacheLimit = <T>(cache: Map<string, T>) => {
  while (cache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;

    if (oldestKey === undefined) {
      return;
    }

    cache.delete(oldestKey);
  }
};

const getRedisClient = async (): Promise<RedisClient | null> => {
  if (process.env["NODE_ENV"] === "test") {
    return null;
  }

  const redisUrl = process.env["REDIS_URL"];

  if (!redisUrl) {
    return null;
  }

  if (redisUnavailable) {
    if (Date.now() < redisRetryAfter) {
      return null;
    }
    // Cooldown elapsed — allow one reconnect attempt instead of staying on memory forever.
    redisUnavailable = false;
  }

  redisClientPromise ??= (async () => {
    try {
      const client = createClient({ url: redisUrl });

      client.on("error", disableRedisFallback);

      await client.connect();
      warnedRedisUnavailable = false;

      return client;
    } catch (error) {
      disableRedisFallback(error);
      return null;
    }
  })();

  return redisClientPromise;
};

const getMemoryCache = <T>(key: string): T | undefined => {
  const cached = memoryCache.get(key);

  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return undefined;
  }

  try {
    return JSON.parse(cached.value) as T;
  } catch {
    memoryCache.delete(key);
    return undefined;
  }
};

const setMemoryCache = (key: string, value: unknown, ttlMs: number) => {
  const now = Date.now();
  pruneExpiredMemoryEntries(now);
  if (!memoryCache.has(key)) {
    enforceMemoryCacheLimit(memoryCache);
  }
  memoryCache.set(key, {
    expiresAt: now + ttlMs,
    value: JSON.stringify(value),
  });
};

const incrementMemoryCounter = (key: string, ttlMs: number): number => {
  const now = Date.now();
  const existingCounter = memoryCounterCache.get(key);

  if (!existingCounter || existingCounter.expiresAt <= now) {
    if (!memoryCounterCache.has(key)) {
      enforceMemoryCacheLimit(memoryCounterCache);
    }
    memoryCounterCache.set(key, {
      count: 1,
      expiresAt: now + ttlMs,
    });
    return 1;
  }

  const nextCount = existingCounter.count + 1;
  memoryCounterCache.set(key, {
    count: nextCount,
    expiresAt: now + ttlMs,
  });
  return nextCount;
};

const disableRedisFallback = (error: unknown) => {
  redisUnavailable = true;
  redisRetryAfter = Date.now() + REDIS_RETRY_COOLDOWN_MS;
  redisClientPromise = null;
  const requestContext = getRequestContext();

  if (requestContext && process.env["REDIS_URL"] !== undefined) {
    requestContext.dependencyFailures ??= [];
    const message = error instanceof Error ? error.message : String(error);

    if (
      !requestContext.dependencyFailures.some(
        (failure) =>
          failure.dependency === "redis" &&
          failure.operation === "cache" &&
          failure.message === message,
      )
    ) {
      requestContext.dependencyFailures.push({
        dependency: "redis",
        operation: "cache",
        message,
      });
    }
    return;
  }

  warnRedisUnavailableOnce(error);
};

export const cacheGetJson = async <T>(key: string): Promise<T | undefined> => {
  const redisClient = await getRedisClient();

  if (!redisClient) {
    return getMemoryCache<T>(key);
  }

  try {
    const cached = await redisClient.get(key);

    if (!cached) {
      return undefined;
    }

    return JSON.parse(cached) as T;
  } catch (error) {
    disableRedisFallback(error);
    return getMemoryCache<T>(key);
  }
};

export const cacheSetJson = async (key: string, value: unknown, ttlMs: number): Promise<void> => {
  const serializedValue = JSON.stringify(value);
  const redisClient = await getRedisClient();

  if (!redisClient) {
    setMemoryCache(key, value, ttlMs);
    return;
  }

  try {
    await redisClient.set(key, serializedValue, {
      expiration: {
        type: "PX",
        value: ttlMs,
      },
    });
  } catch (error) {
    disableRedisFallback(error);
    setMemoryCache(key, value, ttlMs);
  }
};

export const cacheDelete = async (key: string): Promise<void> => {
  memoryCache.delete(key);
  memoryCounterCache.delete(key);

  const redisClient = await getRedisClient();

  if (!redisClient) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (error) {
    disableRedisFallback(error);
  }
};

export const cacheDeleteByPrefix = async (prefix: string): Promise<void> => {
  Array.from(memoryCache.keys())
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => memoryCache.delete(key));
  Array.from(memoryCounterCache.keys())
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => memoryCounterCache.delete(key));

  const redisClient = await getRedisClient();

  if (!redisClient) {
    return;
  }

  try {
    const iterator = redisClient.scanIterator({
      MATCH: `${prefix}*`,
      COUNT: 100,
    });
    let keysToDelete: string[] = [];

    for await (const scanResult of iterator) {
      const scannedKeys = Array.isArray(scanResult) ? scanResult : [scanResult];

      scannedKeys.forEach((key) => {
        if (typeof key === "string") {
          keysToDelete.push(key);
        }
      });

      if (keysToDelete.length >= 100) {
        await redisClient.del(keysToDelete);
        keysToDelete = [];
      }
    }

    if (keysToDelete.length > 0) {
      await redisClient.del(keysToDelete);
    }
  } catch (error) {
    disableRedisFallback(error);
  }
};

export const cacheIncrement = async (key: string, ttlMs: number): Promise<number> => {
  const redisClient = await getRedisClient();

  if (!redisClient) {
    return incrementMemoryCounter(key, ttlMs);
  }

  try {
    const transaction = redisClient.multi();
    transaction.incr(key);
    transaction.pExpire(key, ttlMs);
    const transactionResult = await transaction.exec();
    const nextCount = Number(transactionResult?.[0] ?? 0);

    return Number.isFinite(nextCount) && nextCount > 0
      ? nextCount
      : incrementMemoryCounter(key, ttlMs);
  } catch (error) {
    disableRedisFallback(error);
    return incrementMemoryCounter(key, ttlMs);
  }
};

export const getCacheHealthStatus = async (): Promise<"ok" | "degraded" | "error"> => {
  const cacheKey = `health:cache:${Date.now()}:${Math.random()}`;

  try {
    await cacheSetJson(cacheKey, { ok: true }, 1000);
    const cached = await cacheGetJson<{ ok: boolean }>(cacheKey);
    await cacheDelete(cacheKey);

    if (cached?.ok !== true) {
      return "error";
    }

    return process.env["REDIS_URL"] && process.env["NODE_ENV"] !== "test" ? "ok" : "degraded";
  } catch {
    return "error";
  }
};

export const runSingleFlight = async <T>(
  key: string,
  producer: () => Promise<T>,
  options: SingleFlightOptions = {},
): Promise<T> => {
  const existingPromise = inFlightCache.get(key);

  if (existingPromise) {
    options.onRole?.("waiter");
    return existingPromise as Promise<T>;
  }

  options.onRole?.("leader");

  const nextPromise = producer().finally(() => {
    inFlightCache.delete(key);
  });

  inFlightCache.set(key, nextPromise as Promise<unknown>);

  return nextPromise;
};
