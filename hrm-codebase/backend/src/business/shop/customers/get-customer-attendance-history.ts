import { performance } from "node:perf_hooks";
import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { runSingleFlight } from "../../../repository/cache/cache-client.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { isMissingCompositeIndexError } from "../../../repository/firestore/firestore-errors.js";

const CUSTOMER_ATTENDANCE_HISTORY_ERRORS = {
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/customers/forbidden-role",
    message: "Forbidden: customer access denied",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/customers/forbidden-store",
    message: "Forbidden: store access denied",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/customers/invalid-request",
    message: "Invalid customer attendance history request",
  },
  customerNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/customers/not-found",
    message: "Customer not found",
  },
  dependencyUnavailable: {
    statusCode: StatusCodes.SERVICE_UNAVAILABLE,
    type: "/stores/customers/dependency-unavailable",
    message: "Customer attendance history is temporarily unavailable",
  },
};

export const getCustomerAttendanceHistory = async (request: Request, response: Response) => {
  const timing = new ServerTiming();
  const requestStartedAt = performance.now();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(request.headers["authorization"]),
  );

  if (!can(authContext.role, "customer:view")) {
    return createErrorResponse(response, CUSTOMER_ATTENDANCE_HISTORY_ERRORS.forbiddenRole, {
      role: authContext.role,
    });
  }

  const storeId = getStoreIdFromUrlPath(request);
  const customerIdValue = request.params["customerId"];
  const customerId = typeof customerIdValue === "string" ? customerIdValue.trim() : "";
  const queryParseResult = z
    .object({
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().trim().min(1).optional(),
      startDate: z.string().refine(isValidWorkDate).optional(),
      endDate: z.string().refine(isValidWorkDate).optional(),
    })
    .superRefine((query, context) => {
      if ((query.startDate === undefined) !== (query.endDate === undefined)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [query.startDate === undefined ? "startDate" : "endDate"],
          message: "startDate and endDate must be provided together",
        });
      }

      if (
        query.startDate !== undefined &&
        query.endDate !== undefined &&
        query.startDate > query.endDate
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startDate"],
          message: "startDate must not be after endDate",
        });
      }
    })
    .safeParse(request.query);

  if (!storeId || !customerId || !queryParseResult.success) {
    return createErrorResponse(response, CUSTOMER_ATTENDANCE_HISTORY_ERRORS.invalidRequest, {
      storeId,
      customerId,
      ...(!queryParseResult.success && {
        validation: queryParseResult.error.flatten().fieldErrors,
      }),
    });
  }

  if (!canAccessStore(authContext, storeId)) {
    return createErrorResponse(response, CUSTOMER_ATTENDANCE_HISTORY_ERRORS.forbiddenStore, {
      storeId,
      role: authContext.role,
    });
  }

  let cursor: { workDate: string; startTime: number; id: string } | undefined;

  if (queryParseResult.data.cursor !== undefined) {
    let decodedCursor: unknown;

    try {
      decodedCursor = JSON.parse(
        Buffer.from(queryParseResult.data.cursor, "base64url").toString("utf8"),
      );
    } catch {
      decodedCursor = undefined;
    }

    const cursorParseResult = z
      .object({
        workDate: z.string().refine(isValidWorkDate),
        startTime: z.number().finite(),
        id: z.string().trim().min(1),
      })
      .safeParse(decodedCursor);

    if (!cursorParseResult.success) {
      return createErrorResponse(response, CUSTOMER_ATTENDANCE_HISTORY_ERRORS.invalidRequest, {
        storeId,
        customerId,
        validation: { cursor: ["cursor is invalid"] },
      });
    }

    cursor = cursorParseResult.data;
  }

  const dateRange =
    queryParseResult.data.startDate !== undefined && queryParseResult.data.endDate !== undefined
      ? {
          startDate: queryParseResult.data.startDate,
          endDate: queryParseResult.data.endDate,
        }
      : undefined;

  try {
    const result = await timing.measure("firestore", () =>
      runSingleFlight(
        [
          "customer-attendance-history",
          authContext.ownerId,
          storeId,
          customerId,
          queryParseResult.data.pageSize,
          queryParseResult.data.cursor ?? "first-page",
          dateRange?.startDate ?? "all-time",
          dateRange?.endDate ?? "all-time",
        ].join(":"),
        async () => {
          const [, attendanceHistory] = await Promise.all([
            firestoreRepository.shop.customer.getShopCustomer(
              authContext.ownerId,
              storeId,
              customerId,
            ),
            firestoreRepository.shop.customer.listShopCustomerAttendances(
              authContext.ownerId,
              storeId,
              customerId,
              {
                limit: queryParseResult.data.pageSize,
                ...(cursor !== undefined && { cursor }),
                ...(dateRange !== undefined && { dateRange }),
              },
            ),
          ]);

          return attendanceHistory;
        },
      ),
    );

    timing.add("total", performance.now() - requestStartedAt);
    response.setHeader("Server-Timing", timing.header());
    response.setHeader("X-Cache", "BYPASS");
    response.locals["serverTiming"] = timing.toObject();

    return sendCacheableJson(
      request,
      response,
      {
        items: result.attendances,
        meta: {
          storeId,
          customerId,
          pageSize: queryParseResult.data.pageSize,
          nextCursor:
            result.nextCursor === null
              ? null
              : Buffer.from(JSON.stringify(result.nextCursor), "utf8").toString("base64url"),
          hasMore: result.hasMore,
          ...(dateRange !== undefined && dateRange),
        },
      },
      {
        cacheControl: "private, max-age=15, stale-while-revalidate=30",
      },
    );
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(response, CUSTOMER_ATTENDANCE_HISTORY_ERRORS.customerNotFound, {
        customerId,
      });
    }

    if (isMissingCompositeIndexError(error)) {
      return createErrorResponse(
        response,
        CUSTOMER_ATTENDANCE_HISTORY_ERRORS.dependencyUnavailable,
        { storeId, customerId },
      );
    }

    throw error;
  }
};
