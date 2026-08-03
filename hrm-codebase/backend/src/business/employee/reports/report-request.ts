// Parse, validate, and resolve the store scope shared by the three store report endpoints.
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import {
  getEmployeeReportCacheVersionKey,
  getEmployeeReportResponseCacheKey,
} from "../../../helpers/cache-keys.js";
import { resolveBusinessWorkDate } from "../../../helpers/business-day.js";
import {
  canAccessStore,
  isOwner,
  type AuthorizedAppContext,
} from "../../../helpers/role-access.js";
import { can } from "../../../helpers/permissions.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { setRequestContextIdentity } from "../../../modules/request-context.js";
import type { ServerTiming } from "../../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { cacheGetJson } from "../../../repository/cache/cache-client.js";
import { resolveAttendanceStoreScope } from "../domain/attendance-store-scope.js";
import { getInclusiveRangeDays, MAX_RAW_REPORT_RANGE_DAYS } from "./report-aggregation.js";
import type { ReportData, ReportDataContext } from "./report-data.js";

const LIVE_REPORT_CACHE_TTL_MS = 60_000;
const HISTORICAL_SUMMARY_REPORT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SUMMARY_REPORT_RANGE_DAYS = 370;
const REPORT_AUTH_CONTEXT_CACHE_TTL_MS = 30_000;
const REPORT_CACHE_VERSION_CACHE_TTL_MS = 2_000;
const REPORT_AUTH_CONTEXT_CACHE_MAX_ENTRIES = 256;
const REPORT_CACHE_VERSION_CACHE_MAX_ENTRIES = 256;
const REPORT_STORE_SCOPE_CACHE_TTL_MS = 30_000;
const REPORT_STORE_SCOPE_CACHE_MAX_ENTRIES = 256;
const reportAuthorizationContextCache = new Map<
  string,
  { expiresAt: number; authContext: AuthorizedAppContext }
>();
const reportCacheVersionCache = new Map<string, { expiresAt: number; version: number }>();
const reportStoreScopeCache = new Map<
  string,
  {
    expiresAt: number;
    storeScope: NonNullable<Awaited<ReturnType<typeof resolveAttendanceStoreScope>>>;
  }
>();

export const REPORT_SERVICE_ERRORS = {
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/reports/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/reports/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/reports/invalid-request",
    message: "Invalid report request",
  },
};

const reportQuerySchema = z.object({
  fromWorkDate: z.string().refine(isValidWorkDate, {
    message: "fromWorkDate must use YYYY-MM-DD",
  }),
  toWorkDate: z.string().refine(isValidWorkDate, {
    message: "toWorkDate must use YYYY-MM-DD",
  }),
  groupBy: z.enum(["day", "month"]).default("day"),
  summaryOnly: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  debug: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  employeeLimit: z.coerce.number().int().min(1).max(100).default(20),
  serviceLimit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PreparedReportRequest = {
  authContext: AuthorizedAppContext;
  requestedStoreId: string;
  effectiveStoreId: string;
  startDate: string;
  requestedEndDate: string;
  effectiveEndDate: string;
  effectiveRangeDays: number;
  groupBy: "day" | "month";
  // true = chỉ trả thống kê tổng hợp, cho phép dùng weekly report/settlement thay vì attendance thô.
  summaryOnly: boolean;
  debug: boolean;
  employeeLimit: number;
  serviceLimit: number;
  todayWorkDate: string;
  isHistoricalSummaryRange: boolean;
  responseTtlMs: number;
  responseCacheVersion: number;
};

// Trả context đã validate, hoặc null (đã gửi lỗi vào res — caller chỉ cần `return`).
export const prepareReportRequest = async (
  req: Request,
  res: Response,
  timing?: ServerTiming,
): Promise<PreparedReportRequest | null> => {
  const authorizationHeader = req.headers["authorization"];
  const authorizationCacheKey =
    typeof authorizationHeader === "string"
      ? createHash("sha256").update(authorizationHeader).digest("hex")
      : undefined;
  const cachedAuthorizationContext =
    authorizationCacheKey !== undefined
      ? reportAuthorizationContextCache.get(authorizationCacheKey)
      : undefined;
  let authContext: AuthorizedAppContext;

  if (cachedAuthorizationContext && cachedAuthorizationContext.expiresAt > Date.now()) {
    authContext = cachedAuthorizationContext.authContext;
    setRequestContextIdentity(authContext.uid, authContext.role);
    timing?.add("auth_verify", 0, "memory-cache");
  } else {
    if (authorizationCacheKey !== undefined) {
      reportAuthorizationContextCache.delete(authorizationCacheKey);
    }

    authContext = timing
      ? await timing.measure("auth_verify", () => verifyAuthorizationHeader(authorizationHeader))
      : await verifyAuthorizationHeader(authorizationHeader);

    if (authorizationCacheKey !== undefined) {
      if (
        !reportAuthorizationContextCache.has(authorizationCacheKey) &&
        reportAuthorizationContextCache.size >= REPORT_AUTH_CONTEXT_CACHE_MAX_ENTRIES
      ) {
        const oldestAuthorizationCacheKey = reportAuthorizationContextCache.keys().next().value;
        if (typeof oldestAuthorizationCacheKey === "string") {
          reportAuthorizationContextCache.delete(oldestAuthorizationCacheKey);
        }
      }

      reportAuthorizationContextCache.set(authorizationCacheKey, {
        expiresAt: Date.now() + REPORT_AUTH_CONTEXT_CACHE_TTL_MS,
        authContext,
      });
    }
  }

  // Báo cáo/thống kê tổng — manager không được xem (khác các endpoint vận hành khác).
  if (!can(authContext.role, "report:view")) {
    createErrorResponse(res, REPORT_SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
    return null;
  }

  const pathStoreIdParseResult = z.string().trim().min(1).safeParse(req.params["storeId"]);
  const queryParseResult = reportQuerySchema.safeParse(req.query);

  if (!pathStoreIdParseResult.success || !queryParseResult.success) {
    createErrorResponse(res, REPORT_SERVICE_ERRORS.invalidRequest, {
      validation: {
        ...(pathStoreIdParseResult.success
          ? {}
          : { storeId: pathStoreIdParseResult.error.flatten().formErrors }),
        ...(queryParseResult.success ? {} : queryParseResult.error.flatten().fieldErrors),
      },
    });
    return null;
  }

  const requestedStoreId = pathStoreIdParseResult.data;
  const {
    fromWorkDate: startDate,
    toWorkDate: endDate,
    groupBy,
    summaryOnly,
    debug,
    employeeLimit,
    serviceLimit,
  } = queryParseResult.data;
  const rangeDays = getInclusiveRangeDays(startDate, endDate);
  const maxRangeDays =
    summaryOnly && authContext.role !== "employee"
      ? MAX_SUMMARY_REPORT_RANGE_DAYS
      : MAX_RAW_REPORT_RANGE_DAYS;

  if (rangeDays < 1 || rangeDays > maxRangeDays || startDate > endDate) {
    createErrorResponse(res, REPORT_SERVICE_ERRORS.invalidRequest, {
      reason: "invalid query params",
      startDate,
      endDate,
      rangeDays,
    });
    return null;
  }

  if (!isOwner(authContext.role) && requestedStoreId !== authContext.storeId) {
    createErrorResponse(res, REPORT_SERVICE_ERRORS.forbiddenStore, {
      requestedStoreId,
      authStoreId: authContext.storeId,
    });
    return null;
  }

  const reportCacheVersionKey = getEmployeeReportCacheVersionKey(authContext.ownerId);
  const cachedReportCacheVersion = reportCacheVersionCache.get(reportCacheVersionKey);
  let responseCacheVersionPromise: Promise<unknown>;

  if (cachedReportCacheVersion && cachedReportCacheVersion.expiresAt > Date.now()) {
    responseCacheVersionPromise = Promise.resolve(cachedReportCacheVersion.version);
    timing?.add("report_cache_version", 0, "memory-cache");
  } else {
    responseCacheVersionPromise = (
      timing
        ? timing.measure("report_cache_version", () => cacheGetJson<unknown>(reportCacheVersionKey))
        : cacheGetJson<unknown>(reportCacheVersionKey)
    ).then((remoteReportCacheVersion) => {
      const responseCacheVersion =
        typeof remoteReportCacheVersion === "number" && Number.isInteger(remoteReportCacheVersion)
          ? remoteReportCacheVersion
          : 0;

      if (
        !reportCacheVersionCache.has(reportCacheVersionKey) &&
        reportCacheVersionCache.size >= REPORT_CACHE_VERSION_CACHE_MAX_ENTRIES
      ) {
        const oldestReportCacheVersionKey = reportCacheVersionCache.keys().next().value;
        if (typeof oldestReportCacheVersionKey === "string") {
          reportCacheVersionCache.delete(oldestReportCacheVersionKey);
        }
      }

      reportCacheVersionCache.set(reportCacheVersionKey, {
        expiresAt: Date.now() + REPORT_CACHE_VERSION_CACHE_TTL_MS,
        version: responseCacheVersion,
      });
      return responseCacheVersion;
    });
  }
  const reportStoreScopeCacheKey = [
    authContext.ownerId,
    authContext.uid,
    authContext.role,
    authContext.storeId ?? "",
    requestedStoreId,
  ].join(":");
  const cachedReportStoreScope = reportStoreScopeCache.get(reportStoreScopeCacheKey);
  let storeScope =
    cachedReportStoreScope && cachedReportStoreScope.expiresAt > Date.now()
      ? cachedReportStoreScope.storeScope
      : undefined;

  if (!storeScope) {
    reportStoreScopeCache.delete(reportStoreScopeCacheKey);
    storeScope = timing
      ? await timing.measure("store_scope", () =>
          resolveAttendanceStoreScope(authContext, requestedStoreId),
        )
      : await resolveAttendanceStoreScope(authContext, requestedStoreId);

    if (storeScope) {
      if (
        !reportStoreScopeCache.has(reportStoreScopeCacheKey) &&
        reportStoreScopeCache.size >= REPORT_STORE_SCOPE_CACHE_MAX_ENTRIES
      ) {
        const oldestReportStoreScopeCacheKey = reportStoreScopeCache.keys().next().value;
        if (typeof oldestReportStoreScopeCacheKey === "string") {
          reportStoreScopeCache.delete(oldestReportStoreScopeCacheKey);
        }
      }

      reportStoreScopeCache.set(reportStoreScopeCacheKey, {
        expiresAt: Date.now() + REPORT_STORE_SCOPE_CACHE_TTL_MS,
        storeScope,
      });
    }
  } else if (timing) {
    timing.add("store_scope", 0, "memory-cache");
  }

  const cachedResponseVersion = await responseCacheVersionPromise;

  if (!storeScope || !canAccessStore(authContext, storeScope.storeId)) {
    createErrorResponse(res, REPORT_SERVICE_ERRORS.forbiddenStore, {
      requestedStoreId,
      role: authContext.role,
    });
    return null;
  }

  const effectiveStoreId = storeScope.storeId;
  const todayWorkDate = resolveBusinessWorkDate(Date.now(), {
    timeZone: storeScope.store?.timezone,
  });
  const effectiveEndDate = endDate > todayWorkDate ? todayWorkDate : endDate;
  const effectiveRangeDays =
    startDate <= effectiveEndDate ? getInclusiveRangeDays(startDate, effectiveEndDate) : 0;
  const isHistoricalSummaryRange = summaryOnly && effectiveEndDate < todayWorkDate;

  return {
    authContext,
    requestedStoreId,
    effectiveStoreId,
    startDate,
    requestedEndDate: endDate,
    effectiveEndDate,
    effectiveRangeDays,
    groupBy,
    summaryOnly,
    debug,
    employeeLimit,
    serviceLimit,
    todayWorkDate,
    isHistoricalSummaryRange,
    responseTtlMs: isHistoricalSummaryRange
      ? HISTORICAL_SUMMARY_REPORT_CACHE_TTL_MS
      : LIVE_REPORT_CACHE_TTL_MS,
    responseCacheVersion:
      typeof cachedResponseVersion === "number" && Number.isInteger(cachedResponseVersion)
        ? cachedResponseVersion
        : 0,
  };
};

export const toReportDataContext = (prepared: PreparedReportRequest): ReportDataContext => ({
  authContext: prepared.authContext,
  effectiveStoreId: prepared.effectiveStoreId,
  startDate: prepared.startDate,
  effectiveEndDate: prepared.effectiveEndDate,
  effectiveRangeDays: prepared.effectiveRangeDays,
  groupBy: prepared.groupBy,
  summaryOnly: prepared.summaryOnly,
  todayWorkDate: prepared.todayWorkDate,
  requestedStoreId: prepared.requestedStoreId,
});

export const buildReportResponseCacheKey = (
  prepared: PreparedReportRequest,
  responseVersion: string,
): string => {
  const cacheScope = {
    role: prepared.authContext.role,
    userId: prepared.authContext.uid,
    ...(prepared.authContext.storeId !== undefined && { storeId: prepared.authContext.storeId }),
    requestedStoreId: prepared.effectiveStoreId,
    startDate: prepared.startDate,
    endDate: prepared.effectiveEndDate,
    ...(prepared.summaryOnly && { summaryOnly: true }),
    ...(prepared.groupBy !== "day" && { groupBy: prepared.groupBy }),
    ...(prepared.debug && { debug: true }),
    employeeLimit: prepared.employeeLimit,
    serviceLimit: prepared.serviceLimit,
    cacheVersion: prepared.responseCacheVersion,
    responseVersion,
  };

  return getEmployeeReportResponseCacheKey(prepared.authContext.ownerId, cacheScope);
};

export const reportCacheControl = (isHistoricalSummaryRange: boolean): string =>
  isHistoricalSummaryRange
    ? "private, max-age=300, stale-while-revalidate=300"
    : "private, max-age=30, stale-while-revalidate=60";

// Meta dùng chung cho mọi facet báo cáo.
export const buildReportMeta = (
  prepared: PreparedReportRequest,
  data: Pick<ReportData, "serviceBreakdownStatus" | "optimizedMeta"> & { totalCount: number },
  options: { returnedCount: number },
) => ({
  startDate: prepared.startDate,
  requestedEndDate: prepared.requestedEndDate,
  effectiveEndDate: prepared.effectiveEndDate,
  endDate: prepared.effectiveEndDate,
  rangeDays: prepared.effectiveRangeDays,
  groupBy: prepared.groupBy,
  summaryOnly: prepared.summaryOnly,
  totalCount: data.totalCount,
  returnedCount: options.returnedCount,
  storeId: prepared.effectiveStoreId,
  serviceBreakdownStatus: data.serviceBreakdownStatus,
  employeeLimit: prepared.employeeLimit,
  serviceLimit: prepared.serviceLimit,
  ...(data.optimizedMeta?.latestUpdatedAt !== undefined && {
    latestUpdatedAt: data.optimizedMeta.latestUpdatedAt,
  }),
});
