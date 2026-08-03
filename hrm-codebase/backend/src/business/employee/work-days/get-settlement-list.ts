import type { Request, Response } from "express";
import { performance } from "node:perf_hooks";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { resolveBusinessWorkDate } from "../../../helpers/business-day.js";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { resolveAttendanceStoreScope } from "../domain/attendance-store-scope.js";
import {
  readLegacyUnsettledWorkDaySettlementCollection,
  readClosedWorkDaySettlementCollection,
  type SettlementCollectionResult,
} from "./settlement-list-query.js";

const SETTLEMENT_LIST_ERRORS = {
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/work-days/settlements/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/work-days/settlements/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/work-days/settlements/invalid-request",
    message: "Invalid settlement list request",
  },
};

// Compatibility endpoint for the current frontend. The canonical backend API exposes
// settled closings and unsettled candidates as separate collections.
export const getSettlementList = async (request: Request, response: Response) => {
  const timing = new ServerTiming();
  const requestStartedAt = performance.now();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(request.headers["authorization"]),
  );

  if (!can(authContext.role, "settlement:view")) {
    return createErrorResponse(response, SETTLEMENT_LIST_ERRORS.forbiddenRole, {
      role: authContext.role,
    });
  }

  const requestedStoreId = getStoreIdFromUrlPath(request);
  const queryParseResult = z
    .object({
      tab: z.enum(["settled", "unsettled"]),
      limit: z.coerce.number().int().min(1).max(50).default(10),
      cursor: z.string().trim().refine(isValidWorkDate).optional(),
    })
    .safeParse(request.query);

  if (!requestedStoreId || !queryParseResult.success) {
    return createErrorResponse(response, SETTLEMENT_LIST_ERRORS.invalidRequest, {
      requestedStoreId,
      ...(!queryParseResult.success && {
        validation: queryParseResult.error.flatten().fieldErrors,
      }),
    });
  }

  const storeScope = await timing.measure("storeScope", () =>
    resolveAttendanceStoreScope(authContext, requestedStoreId, { skipCache: true }),
  );

  if (!storeScope || !canAccessStore(authContext, storeScope.storeId)) {
    return createErrorResponse(response, SETTLEMENT_LIST_ERRORS.forbiddenStore, {
      requestedStoreId,
      role: authContext.role,
    });
  }

  const settlementCollectionQuery = {
    pageSize: queryParseResult.data.limit,
    ...(queryParseResult.data.cursor !== undefined && {
      cursorWorkDate: queryParseResult.data.cursor,
    }),
  };
  let collectionResult: SettlementCollectionResult;

  if (queryParseResult.data.tab === "settled") {
    collectionResult = await timing.measure("firestore", () =>
      readClosedWorkDaySettlementCollection(
        authContext.ownerId,
        storeScope.storeId,
        settlementCollectionQuery,
      ),
    );
  } else {
    const currentWorkDate = resolveBusinessWorkDate(new Date(), {
      timeZone: storeScope.store?.timezone,
      settlementCutoffTime: storeScope.store?.settlementCutoffTime,
    });
    collectionResult = await timing.measure("firestore", () =>
      readLegacyUnsettledWorkDaySettlementCollection(
        authContext.ownerId,
        storeScope.storeId,
        currentWorkDate,
        settlementCollectionQuery,
      ),
    );
  }

  timing.add("total", performance.now() - requestStartedAt);
  response.setHeader("Server-Timing", timing.header());
  response.setHeader("X-Cache", "BYPASS");
  response.locals["serverTiming"] = timing.toObject();
  response.locals["businessEvent"] = "settlement.list";
  response.locals["settlementList"] = {
    tab: queryParseResult.data.tab,
    storeId: storeScope.storeId,
    itemCount: collectionResult.items.length,
  };

  return sendCacheableJson(
    request,
    response,
    {
      tab: queryParseResult.data.tab,
      items: collectionResult.items,
      nextCursor: collectionResult.nextCursorWorkDate,
      hasMore: collectionResult.hasMore,
    },
    {
      cacheControl: "private, no-cache, max-age=0, must-revalidate",
    },
  );
};
