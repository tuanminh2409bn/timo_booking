import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import {
  createErrorResponse,
  type ErrorResponseBodyType,
} from "../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import { getBillingPlanConfiguration, getPayPalBillingConfiguration } from "./billing-config.js";
import type { BillingAccountRecord } from "./billing.types.js";
import { PayPalApiError, paypalClient } from "./paypal-client.js";

type BillingStartResponse = {
  provider: "paypal";
  subscriptionId: string;
  approvalUrl: string;
};

const StartBillingSchema = z.object({
  provider: z.literal("paypal"),
});

const BillingStartSchema = z.object({
  provider: z.literal("paypal"),
});

const SERVICE_ERRORS = {
  forbidden: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/account/billing/forbidden",
    message: "Only owners can manage billing",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/account/billing/invalid-request",
    message: "Invalid billing provider",
  },
  unavailable: {
    statusCode: StatusCodes.SERVICE_UNAVAILABLE,
    type: "/account/billing/paypal-unavailable",
    message: "PayPal payment is temporarily unavailable",
  },
  alreadyActive: {
    statusCode: StatusCodes.CONFLICT,
    type: "/account/billing/already-active",
    message: "Premium is already active for this account",
  },
};

export const startAccountBillingSubscription = async (
  req: Request,
  res: Response<BillingStartResponse | ErrorResponseBodyType>,
) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (authContext.role !== "owner") {
    return createErrorResponse(res, SERVICE_ERRORS.forbidden);
  }

  if (!StartBillingSchema.safeParse(req.body).success) {
    return createErrorResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      type: "/account/billing/invalid-request",
      message: "Invalid billing provider",
    });
  }

  if (!BillingStartSchema.safeParse(req.body).success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest);
  }

  const configuration = getPayPalBillingConfiguration();

  if (configuration === undefined) {
    return createErrorResponse(res, SERVICE_ERRORS.unavailable);
  }

  const existingBillingAccount = await firestoreRepository.billing.getBillingAccount(
    authContext.uid,
  );

  if (existingBillingAccount?.status === "active") {
    return createErrorResponse(res, SERVICE_ERRORS.alreadyActive);
  }

  let subscription;

  try {
    subscription = await paypalClient.createSubscription(authContext.uid, configuration);
  } catch (error) {
    if (error instanceof PayPalApiError) {
      return createErrorResponse(res, SERVICE_ERRORS.unavailable);
    }

    throw error;
  }

  const approvalUrl = subscription.links?.find((link) => link.rel === "approve")?.href;

  if (approvalUrl === undefined) {
    return createErrorResponse(res, SERVICE_ERRORS.unavailable);
  }

  const timestamp = Date.now();
  const plan = getBillingPlanConfiguration();
  const pendingBillingAccount: BillingAccountRecord = {
    ownerUserId: authContext.uid,
    ownerId: authContext.ownerId,
    provider: "paypal",
    providerSubscriptionId: subscription.id,
    providerPlanId: configuration.planId,
    plan: "premium",
    status: "approval_pending",
    amount: plan.amount,
    currency: plan.currency,
    interval: plan.interval,
    createdAt: existingBillingAccount?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await firestoreRepository.billing.upsertBillingAccount(pendingBillingAccount);

  return res.status(StatusCodes.CREATED).json({
    provider: "paypal",
    subscriptionId: subscription.id,
    approvalUrl,
  });
};
