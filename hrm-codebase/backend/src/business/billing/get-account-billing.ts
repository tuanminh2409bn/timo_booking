import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  createErrorResponse,
  type ErrorResponseBodyType,
} from "../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import type { OwnerUserType } from "../../repository/firestore/user/user.types.js";
import {
  resolveBillingOverviewResponse,
  type BillingOverviewResponse,
} from "./billing-response.js";

const FORBIDDEN_ERROR = {
  statusCode: StatusCodes.FORBIDDEN,
  type: "/account/billing/forbidden",
  message: "Only owners can manage billing",
};

export const getAccountBilling = async (
  req: Request,
  res: Response<BillingOverviewResponse | ErrorResponseBodyType>,
) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (authContext.role !== "owner") {
    return createErrorResponse(res, FORBIDDEN_ERROR);
  }

  const owner = await firestoreRepository.user.getUser(authContext.uid);

  if (owner.role !== "owner") {
    return createErrorResponse(res, FORBIDDEN_ERROR);
  }

  const billingAccount = await firestoreRepository.billing.getBillingAccount(owner.uid);

  return res
    .status(StatusCodes.OK)
    .json(resolveBillingOverviewResponse(owner as OwnerUserType, billingAccount));
};
