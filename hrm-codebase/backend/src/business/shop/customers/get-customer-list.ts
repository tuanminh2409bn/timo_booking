import { performance } from "node:perf_hooks";
import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { runSingleFlight } from "../../../repository/cache/cache-client.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { isMissingCompositeIndexError } from "../../../repository/firestore/firestore-errors.js";

const CUSTOMER_LIST_ERRORS = {
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
    message: "Invalid customer list request",
  },
  dependencyUnavailable: {
    statusCode: StatusCodes.SERVICE_UNAVAILABLE,
    type: "/stores/customers/dependency-unavailable",
    message: "Customer list is temporarily unavailable",
  },
};

export const getCustomerList = async (request: Request, response: Response) => {
  const timing = new ServerTiming();
  const requestStartedAt = performance.now();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(request.headers["authorization"]),
  );

  if (!can(authContext.role, "customer:view")) {
    return createErrorResponse(response, CUSTOMER_LIST_ERRORS.forbiddenRole, {
      role: authContext.role,
    });
  }

  const storeId = getStoreIdFromUrlPath(request);
  const queryParseResult = z
    .object({
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().trim().min(1).optional(),
    })
    .safeParse(request.query);

  if (!storeId || !queryParseResult.success) {
    return createErrorResponse(response, CUSTOMER_LIST_ERRORS.invalidRequest, {
      storeId,
      ...(!queryParseResult.success && {
        validation: queryParseResult.error.flatten().fieldErrors,
      }),
    });
  }

  if (!canAccessStore(authContext, storeId)) {
    return createErrorResponse(response, CUSTOMER_LIST_ERRORS.forbiddenStore, {
      storeId,
      role: authContext.role,
    });
  }

  let cursor: { createdAt: number; id: string } | undefined;

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
        createdAt: z.number().int().nonnegative(),
        id: z.string().trim().min(1),
      })
      .safeParse(decodedCursor);

    if (!cursorParseResult.success) {
      return createErrorResponse(response, CUSTOMER_LIST_ERRORS.invalidRequest, {
        storeId,
        validation: { cursor: ["cursor is invalid"] },
      });
    }

    cursor = cursorParseResult.data;
  }

  try {
    const result = await timing.measure("firestore", () =>
      runSingleFlight(
        [
          "customer-list",
          authContext.ownerId,
          storeId,
          queryParseResult.data.pageSize,
          queryParseResult.data.cursor ?? "first-page",
        ].join(":"),
        () =>
          firestoreRepository.shop.customer.listShopCustomers(authContext.ownerId, storeId, {
            limit: queryParseResult.data.pageSize,
            ...(cursor !== undefined && { cursor }),
          }),
      ),
    );

    timing.add("total", performance.now() - requestStartedAt);
    response.setHeader("Server-Timing", timing.header());
    response.setHeader("X-Cache", "BYPASS");
    response.locals["serverTiming"] = timing.toObject();

    const customerItems = await Promise.all(
      result.customers.map(async (customer) => {
        const summary = await firestoreRepository.shop.customer.getShopCustomerAttendanceSummary(
          authContext.ownerId,
          storeId,
          customer.id,
        );
        return {
          id: customer.id,
          ...(customer.phone !== undefined && { phone: customer.phone }),
          ...(customer.customerCode !== undefined && { customerCode: customer.customerCode }),
          ...(customer.name !== undefined && { name: customer.name }),
          blocked: customer.blocked,
          ...(customer.blockedReason !== undefined && { blockedReason: customer.blockedReason }),
          ...(customer.blockedAt !== undefined && { blockedAt: customer.blockedAt }),
          counters: {
            total: summary.totalAppointments,
            pending: summary.requestedAppointments + summary.processingAppointments,
            confirmed: summary.confirmedAppointments,
            completed: summary.completedAppointments ?? 0,
            cancelled: summary.cancelledAppointments,
            noShow: summary.noShowAppointments,
          },
        };
      }),
    );

    return sendCacheableJson(
      request,
      response,
      {
        items: customerItems,
        meta: {
          storeId,
          pageSize: queryParseResult.data.pageSize,
          nextCursor:
            result.nextCursor === null
              ? null
              : Buffer.from(JSON.stringify(result.nextCursor), "utf8").toString("base64url"),
          hasMore: result.hasMore,
        },
      },
      {
        cacheControl: "private, max-age=15, stale-while-revalidate=30",
      },
    );
  } catch (error) {
    if (isMissingCompositeIndexError(error)) {
      return createErrorResponse(response, CUSTOMER_LIST_ERRORS.dependencyUnavailable, {
        storeId,
      });
    }

    throw error;
  }
};
