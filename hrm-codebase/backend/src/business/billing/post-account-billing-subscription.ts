import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { writeShopAuditLog } from "../../helpers/shop-audit-log.js";
import {
  createErrorResponse,
  type ErrorResponseBodyType,
} from "../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import { getPayPalBillingConfiguration } from "./billing-config.js";
import {
  resolveBillingOverviewResponse,
  type BillingOverviewResponse,
} from "./billing-response.js";
import { syncPayPalSubscription } from "./billing-service.js";
import { PayPalApiError, paypalClient } from "./paypal-client.js";

const BillingSubscriptionSchema = z.object({
  provider: z.literal("paypal"),
  subscriptionId: z.string().trim().min(3).max(128),
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
    message: "Invalid billing subscription",
  },
  unavailable: {
    statusCode: StatusCodes.SERVICE_UNAVAILABLE,
    type: "/account/billing/paypal-unavailable",
    message: "PayPal payment is temporarily unavailable",
  },
  invalidSubscription: {
    statusCode: StatusCodes.CONFLICT,
    type: "/account/billing/invalid-subscription",
    message: "The PayPal subscription could not be verified",
  },
};

export const createAccountBillingSubscription = async (
  req: Request,
  res: Response<BillingOverviewResponse | ErrorResponseBodyType>,
) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (authContext.role !== "owner") {
    return createErrorResponse(res, SERVICE_ERRORS.forbidden);
  }

  const request = BillingSubscriptionSchema.safeParse(req.body);

  if (!request.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest);
  }

  const configuration = getPayPalBillingConfiguration();

  if (configuration === undefined) {
    return createErrorResponse(res, SERVICE_ERRORS.unavailable);
  }

  let subscription;

  try {
    subscription = await paypalClient.getSubscription(request.data.subscriptionId, configuration);
  } catch (error) {
    if (error instanceof PayPalApiError) {
      return createErrorResponse(res, SERVICE_ERRORS.unavailable);
    }

    throw error;
  }

  if (
    subscription.status !== "ACTIVE" ||
    subscription.plan_id !== configuration.planId ||
    subscription.custom_id !== authContext.uid
  ) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidSubscription);
  }

  const existingSubscription =
    await firestoreRepository.billing.getBillingAccountByProviderSubscription(subscription.id);

  if (existingSubscription !== undefined && existingSubscription.ownerUserId !== authContext.uid) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidSubscription);
  }

  const result = await syncPayPalSubscription({
    ownerUserId: authContext.uid,
    ownerId: authContext.ownerId,
    subscription,
  });

  if (result.planChanged) {
    await writeShopAuditLog({
      ownerId: authContext.ownerId,
      eventType: "owner_data_retention_plan_changed",
      entityType: "owner",
      entityId: authContext.uid,
      actor: {
        uid: authContext.uid,
        role: authContext.role,
      },
      metadata: {
        previousPlan: "standard",
        nextPlan: "premium",
        paymentProvider: "paypal",
      },
    });
  }

  return res
    .status(StatusCodes.OK)
    .json(resolveBillingOverviewResponse(result.owner, result.billingAccount));
};
