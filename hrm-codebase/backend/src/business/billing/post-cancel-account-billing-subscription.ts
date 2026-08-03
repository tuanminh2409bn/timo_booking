import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
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

const SERVICE_ERRORS = {
  forbidden: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/account/billing/forbidden",
    message: "Only owners can manage billing",
  },
  subscriptionNotFound: {
    statusCode: StatusCodes.CONFLICT,
    type: "/account/billing/subscription-not-found",
    message: "No PayPal subscription was found for this account",
  },
  unavailable: {
    statusCode: StatusCodes.SERVICE_UNAVAILABLE,
    type: "/account/billing/paypal-unavailable",
    message: "PayPal payment is temporarily unavailable",
  },
};

export const cancelAccountBillingSubscription = async (
  req: Request,
  res: Response<BillingOverviewResponse | ErrorResponseBodyType>,
) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (authContext.role !== "owner") {
    return createErrorResponse(res, SERVICE_ERRORS.forbidden);
  }

  const configuration = getPayPalBillingConfiguration();
  const billingAccount = await firestoreRepository.billing.getBillingAccount(authContext.uid);

  if (configuration === undefined) {
    return createErrorResponse(res, SERVICE_ERRORS.unavailable);
  }

  if (billingAccount?.provider !== "paypal") {
    return createErrorResponse(res, SERVICE_ERRORS.subscriptionNotFound);
  }

  let subscription;

  try {
    subscription = await paypalClient.getSubscription(
      billingAccount.providerSubscriptionId,
      configuration,
    );

    if (subscription.status !== "CANCELLED" && subscription.status !== "EXPIRED") {
      await paypalClient.cancelSubscription(subscription.id, configuration);
    }
  } catch (error) {
    if (error instanceof PayPalApiError) {
      return createErrorResponse(res, SERVICE_ERRORS.unavailable);
    }

    throw error;
  }

  const result = await syncPayPalSubscription({
    ownerUserId: authContext.uid,
    ownerId: authContext.ownerId,
    subscription: {
      ...subscription,
      status: subscription.status === "EXPIRED" ? "EXPIRED" : "CANCELLED",
    },
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
        previousPlan: "premium",
        nextPlan: "standard",
        paymentProvider: "paypal",
      },
    });
  }

  return res
    .status(StatusCodes.OK)
    .json(resolveBillingOverviewResponse(result.owner, result.billingAccount));
};
