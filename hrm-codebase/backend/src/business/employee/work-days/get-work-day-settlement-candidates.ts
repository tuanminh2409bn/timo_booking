import type { Request, Response } from "express";
import { performance } from "node:perf_hooks";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { readUnsettledWorkDaySettlementCollection } from "./settlement-list-query.js";

const SETTLEMENT_CANDIDATE_ERRORS = {
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/work-day-settlement-candidates/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/work-day-settlement-candidates/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/work-day-settlement-candidates/invalid-request",
    message: "Invalid settlement candidate list request",
  },
};

export const getWorkDaySettlementCandidates = async (request: Request, response: Response) => {
  const timing = new ServerTiming();
  const requestStartedAt = performance.now();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(request.headers["authorization"]),
  );

  if (!can(authContext.role, "settlement:view")) {
    return createErrorResponse(response, SETTLEMENT_CANDIDATE_ERRORS.forbiddenRole, {
      role: authContext.role,
    });
  }

  const requestedStoreId = getStoreIdFromUrlPath(request);
  const queryParseResult = z
    .object({
      pageSize: z.coerce.number().int().min(1).max(50).default(10),
      cursor: z.string().trim().min(1).optional(),
    })
    .transform((query, context) => {
      if (query.cursor === undefined) {
        return { pageSize: query.pageSize };
      }

      let decodedCursor: unknown;

      try {
        decodedCursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
      } catch {
        decodedCursor = undefined;
      }

      const cursorParseResult = z
        .object({
          workDate: z.string().refine(isValidWorkDate),
          settlementEligibleAt: z.number().int().nonnegative().optional(),
        })
        .safeParse(decodedCursor);

      if (!cursorParseResult.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cursor"],
          message: "cursor is invalid",
        });
        return z.NEVER;
      }

      return {
        pageSize: query.pageSize,
        cursorWorkDate: cursorParseResult.data.workDate,
        ...(cursorParseResult.data.settlementEligibleAt !== undefined && {
          cursorSettlementEligibleAt: cursorParseResult.data.settlementEligibleAt,
        }),
      };
    })
    .safeParse(request.query);

  if (!requestedStoreId || !queryParseResult.success) {
    return createErrorResponse(response, SETTLEMENT_CANDIDATE_ERRORS.invalidRequest, {
      requestedStoreId,
      ...(!queryParseResult.success && {
        validation: queryParseResult.error.flatten().fieldErrors,
      }),
    });
  }

  if (!canAccessStore(authContext, requestedStoreId)) {
    return createErrorResponse(response, SETTLEMENT_CANDIDATE_ERRORS.forbiddenStore, {
      requestedStoreId,
      role: authContext.role,
    });
  }

  const currentTimestamp = Date.now();
  const collectionResult = await timing.measure("firestore", () =>
    readUnsettledWorkDaySettlementCollection(
      authContext.ownerId,
      requestedStoreId,
      currentTimestamp,
      queryParseResult.data,
    ),
  );
  const nextCursor = collectionResult.nextCursorWorkDate
    ? Buffer.from(
        JSON.stringify({
          workDate: collectionResult.nextCursorWorkDate,
          ...(collectionResult.nextCursorSettlementEligibleAt !== null && {
            settlementEligibleAt: collectionResult.nextCursorSettlementEligibleAt,
          }),
        }),
        "utf8",
      ).toString("base64url")
    : null;

  timing.add("total", performance.now() - requestStartedAt);
  response.setHeader("Server-Timing", timing.header());
  response.setHeader("X-Cache", "BYPASS");
  response.locals["serverTiming"] = timing.toObject();
  response.locals["businessEvent"] = "work_day_settlement_candidate.list";
  response.locals["settlementList"] = {
    tab: "unsettled",
    storeId: requestedStoreId,
    itemCount: collectionResult.items.length,
  };

  return sendCacheableJson(
    request,
    response,
    {
      items: collectionResult.items,
      meta: {
        nextCursor,
        hasMore: collectionResult.hasMore,
      },
    },
    {
      statusCode: StatusCodes.OK,
      cacheControl: "private, no-cache, max-age=0, must-revalidate",
    },
  );
};
