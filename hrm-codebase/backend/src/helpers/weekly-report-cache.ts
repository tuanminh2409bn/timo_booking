import { createHash } from "node:crypto";
import {
  cacheDelete,
  cacheDeleteByPrefix,
  cacheGetJson,
  cacheSetJson,
  runSingleFlight,
} from "../repository/cache/cache-client.js";
import type { WeeklyReportType } from "../repository/firestore/shop/weekly-report.types.js";

const WEEKLY_REPORT_CACHE_TTL_MS = 5 * 60 * 1000;

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
  createHash("sha1").update(stableStringify(value)).digest("hex");

export const getCacheKey = (ownerId: string, storeId: string, weekStartDate: string): string =>
  `store:${ownerId}:weekly-report:${storeId}:${weekStartDate}`;

const getWeeklyReportCachePrefix = (ownerId: string, storeId?: string): string =>
  storeId ? `store:${ownerId}:weekly-report:${storeId}:` : `store:${ownerId}:weekly-report:`;

const getWeeklyReportDetailResponseCachePrefix = (
  ownerId: string,
  storeId: string,
  weekStartDate?: string,
): string =>
  weekStartDate
    ? `store:${ownerId}:response:weekly-report:detail:${storeId}:${weekStartDate}:`
    : `store:${ownerId}:response:weekly-report:detail:${storeId}:`;

const getWeeklyReportListResponseCachePrefix = (ownerId: string, storeId?: string): string =>
  storeId
    ? `store:${ownerId}:response:weekly-report:list:${storeId}:`
    : `store:${ownerId}:response:weekly-report:list:`;

const getSingleFlightKey = (ownerId: string, storeId: string, weekStartDate: string): string =>
  `weekly-report-generation:${hashValue({ ownerId, storeId, weekStartDate })}`;

export const getOrGenerateWeeklyReport = async <T extends WeeklyReportType | null>(
  ownerId: string,
  storeId: string,
  weekStartDate: string,
  generator: () => Promise<T>,
): Promise<T> => {
  const cacheKey = getCacheKey(ownerId, storeId, weekStartDate);
  const cached = await cacheGetJson<T>(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const singleFlightKey = getSingleFlightKey(ownerId, storeId, weekStartDate);

  return runSingleFlight(singleFlightKey, async () => {
    const cachedAfterWait = await cacheGetJson<T>(cacheKey);

    if (cachedAfterWait !== undefined) {
      return cachedAfterWait;
    }

    const report = await generator();

    await cacheSetJson(cacheKey, report, WEEKLY_REPORT_CACHE_TTL_MS);

    return report;
  });
};

export const invalidateWeeklyReport = async (
  ownerId: string,
  storeId: string,
  weekStartDate: string,
): Promise<void> => {
  const cacheKey = getCacheKey(ownerId, storeId, weekStartDate);
  await Promise.all([
    cacheDelete(cacheKey),
    cacheDeleteByPrefix(getWeeklyReportDetailResponseCachePrefix(ownerId, storeId, weekStartDate)),
    cacheDeleteByPrefix(getWeeklyReportListResponseCachePrefix(ownerId, storeId)),
  ]);
};

export const invalidateWeeklyReportsByStore = async (
  ownerId: string,
  storeId: string,
): Promise<void> => {
  const prefix = getWeeklyReportCachePrefix(ownerId, storeId);
  await Promise.all([
    cacheDeleteByPrefix(prefix),
    cacheDeleteByPrefix(getWeeklyReportDetailResponseCachePrefix(ownerId, storeId)),
    cacheDeleteByPrefix(getWeeklyReportListResponseCachePrefix(ownerId, storeId)),
  ]);
};

export const invalidateAllWeeklyReports = async (ownerId: string): Promise<void> => {
  const prefix = getWeeklyReportCachePrefix(ownerId);
  await Promise.all([
    cacheDeleteByPrefix(prefix),
    cacheDeleteByPrefix(`store:${ownerId}:response:weekly-report:detail:`),
    cacheDeleteByPrefix(getWeeklyReportListResponseCachePrefix(ownerId)),
  ]);
};
