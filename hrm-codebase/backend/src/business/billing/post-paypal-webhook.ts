import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import {
  createErrorResponse,
  type ErrorResponseBodyType,
} from "../../modules/create-error-response.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import { getPayPalBillingConfiguration } from "./billing-config.js";
import { syncPayPalSubscription } from "./billing-service.js";
import { PayPalApiError, paypalClient, type PayPalWebhookHeaders } from "./paypal-client.js";

const SupportedPayPalWebhookSchema = z.object({
  id: z.string().min(1),
  event_type: z.enum([
    "BILLING.SUBSCRIPTION.ACTIVATED",
    "BILLING.SUBSCRIPTION.SUSPENDED",
    "BILLING.SUBSCRIPTION.CANCELLED",
    "BILLING.SUBSCRIPTION.EXPIRED",
    "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
  ]),
  resource: z.object({
    id: z.string().min(1),
    status: z.enum(["ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED"]),
    plan_id: z.string().min(1),
    custom_id: z.string().min(1),
    create_time: z.string().optional(),
    update_time: z.string().optional(),
    billing_info: z
      .object({
        next_billing_time: z.string().optional(),
      })
      .optional(),
  }),
});

const SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/webhooks/paypal/invalid-request",
    message: "Invalid PayPal webhook",
  },
  unavailable: {
    statusCode: StatusCodes.SERVICE_UNAVAILABLE,
    type: "/webhooks/paypal/unavailable",
    message: "PayPal webhook verification is unavailable",
  },
};

const readHeader = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const getPayPalWebhookHeaders = (req: Request): PayPalWebhookHeaders | undefined => {
  const authAlgo = readHeader(req, "paypal-auth-algo");
  const certUrl = readHeader(req, "paypal-cert-url");
  const transmissionId = readHeader(req, "paypal-transmission-id");
  const transmissionSig = readHeader(req, "paypal-transmission-sig");
  const transmissionTime = readHeader(req, "paypal-transmission-time");

  if (
    authAlgo === undefined ||
    certUrl === undefined ||
    transmissionId === undefined ||
    transmissionSig === undefined ||
    transmissionTime === undefined
  ) {
    return undefined;
  }

  return { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime };
};

export const handlePayPalWebhook = async (
  req: Request,
  res: Response<{ received: true; handled: boolean } | ErrorResponseBodyType>,
) => {
  const configuration = getPayPalBillingConfiguration();
  const headers = getPayPalWebhookHeaders(req);

  if (configuration === undefined) {
    return createErrorResponse(res, SERVICE_ERRORS.unavailable);
  }

  if (headers === undefined || typeof req.body !== "object" || req.body === null) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest);
  }

  let verified: boolean;

  try {
    verified = await paypalClient.verifyWebhookSignature(
      headers,
      req.body as Record<string, unknown>,
      configuration,
    );
  } catch (error) {
    if (error instanceof PayPalApiError) {
      return createErrorResponse(res, SERVICE_ERRORS.unavailable);
    }

    throw error;
  }

  if (!verified) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest);
  }

  const event = SupportedPayPalWebhookSchema.safeParse(req.body);

  if (!event.success) {
    return res.status(StatusCodes.OK).json({ received: true, handled: false });
  }

  if (event.data.resource.plan_id !== configuration.planId) {
    return res.status(StatusCodes.OK).json({ received: true, handled: false });
  }

  const billingAccount = await firestoreRepository.billing.getBillingAccountByProviderSubscription(
    event.data.resource.id,
  );

  if (
    billingAccount === undefined ||
    billingAccount.provider !== "paypal" ||
    billingAccount.providerPlanId !== event.data.resource.plan_id ||
    billingAccount.ownerUserId !== event.data.resource.custom_id
  ) {
    return res.status(StatusCodes.OK).json({ received: true, handled: false });
  }

  const owner = await firestoreRepository.user.getUser(billingAccount.ownerUserId);

  if (owner.role !== "owner" || owner.ownerId !== billingAccount.ownerId) {
    return res.status(StatusCodes.OK).json({ received: true, handled: false });
  }

  await syncPayPalSubscription({
    ownerUserId: owner.uid,
    ownerId: owner.ownerId,
    subscription: event.data.resource,
    ...(event.data.event_type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED" && {
      statusOverride: "payment_failed",
    }),
  });

  return res.status(StatusCodes.OK).json({ received: true, handled: true });
};
