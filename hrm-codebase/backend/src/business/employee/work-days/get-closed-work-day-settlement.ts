import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { can } from "../../../helpers/permissions.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { toClosedWorkDaySettlementResponse } from "./settlement-response.js";

const CLOSED_WORK_DAY_SETTLEMENT_ERRORS = {
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/work-day-settlements/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/work-day-settlements/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/work-day-settlements/invalid-request",
    message: "Invalid work-day closing request",
  },
  notFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/work-day-settlements/not-found",
    message: "Closed work-day settlement not found",
  },
};

export const getClosedWorkDaySettlement = async (request: Request, response: Response) => {
  const authContext = await verifyAuthorizationHeader(request.headers["authorization"]);

  if (!can(authContext.role, "settlement:view")) {
    return createErrorResponse(response, CLOSED_WORK_DAY_SETTLEMENT_ERRORS.forbiddenRole, {
      role: authContext.role,
    });
  }

  const requestedStoreId = getStoreIdFromUrlPath(request);
  const pathParseResult = z
    .object({
      workDate: z.string().refine(isValidWorkDate, {
        message: "workDate must use YYYY-MM-DD",
      }),
    })
    .safeParse(request.params);

  if (!requestedStoreId || !pathParseResult.success) {
    return createErrorResponse(response, CLOSED_WORK_DAY_SETTLEMENT_ERRORS.invalidRequest, {
      requestedStoreId,
      ...(!pathParseResult.success && {
        validation: pathParseResult.error.flatten().fieldErrors,
      }),
    });
  }

  if (!canAccessStore(authContext, requestedStoreId)) {
    return createErrorResponse(response, CLOSED_WORK_DAY_SETTLEMENT_ERRORS.forbiddenStore, {
      requestedStoreId,
      role: authContext.role,
    });
  }

  const settlement = await firestoreRepository.shop.settlement.getWorkDaySettlement(
    authContext.ownerId,
    requestedStoreId,
    pathParseResult.data.workDate,
  );

  if (!settlement || settlement.status !== "closed" || settlement.closing === undefined) {
    return createErrorResponse(response, CLOSED_WORK_DAY_SETTLEMENT_ERRORS.notFound, {
      storeId: requestedStoreId,
      workDate: pathParseResult.data.workDate,
    });
  }

  return response.status(StatusCodes.OK).json(toClosedWorkDaySettlementResponse(settlement));
};
