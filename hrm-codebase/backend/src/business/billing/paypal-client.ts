import { z } from "zod";
import type { PayPalBillingConfiguration } from "./billing-config.js";

const PayPalAccessTokenSchema = z.object({
  access_token: z.string().min(1),
});

const PayPalSubscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED"]),
  plan_id: z.string().min(1),
  custom_id: z.string().optional(),
  create_time: z.string().optional(),
  update_time: z.string().optional(),
  billing_info: z
    .object({
      next_billing_time: z.string().optional(),
    })
    .optional(),
  links: z.array(z.object({ href: z.string().url(), rel: z.string() })).optional(),
});

const PayPalCreateSubscriptionSchema = PayPalSubscriptionSchema.extend({
  plan_id: z.string().min(1).optional(),
  custom_id: z.string().min(1).optional(),
});

export type PayPalSubscription = z.infer<typeof PayPalSubscriptionSchema>;

const PayPalWebhookVerificationSchema = z.object({
  verification_status: z.enum(["SUCCESS", "FAILURE"]),
});

export type PayPalWebhookHeaders = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

export class PayPalApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super("PayPal request failed");
    this.name = "PayPalApiError";
    this.statusCode = statusCode;
  }
}

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const getAccessToken = async (configuration: PayPalBillingConfiguration): Promise<string> => {
  const credentials = Buffer.from(
    `${configuration.clientId}:${configuration.clientSecret}`,
    "utf8",
  ).toString("base64");
  const response = await fetch(`${configuration.apiBaseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
      "Accept-Language": "en_US",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new PayPalApiError(response.status);
  }

  const token = PayPalAccessTokenSchema.safeParse(await parseJsonResponse(response));

  if (!token.success) {
    throw new PayPalApiError(502);
  }

  return token.data.access_token;
};

const getSubscription = async (
  subscriptionId: string,
  configuration: PayPalBillingConfiguration,
): Promise<PayPalSubscription> => {
  const accessToken = await getAccessToken(configuration);
  const response = await fetch(
    `${configuration.apiBaseUrl}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new PayPalApiError(response.status);
  }

  const subscription = PayPalSubscriptionSchema.safeParse(await parseJsonResponse(response));

  if (!subscription.success) {
    throw new PayPalApiError(502);
  }

  return subscription.data;
};

const cancelSubscription = async (
  subscriptionId: string,
  configuration: PayPalBillingConfiguration,
): Promise<void> => {
  const accessToken = await getAccessToken(configuration);
  const response = await fetch(
    `${configuration.apiBaseUrl}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Customer requested cancellation from Timmo" }),
    },
  );

  if (!response.ok) {
    throw new PayPalApiError(response.status);
  }
};

const createSubscription = async (
  ownerUserId: string,
  configuration: PayPalBillingConfiguration,
): Promise<PayPalSubscription> => {
  const accessToken = await getAccessToken(configuration);

  const response = await fetch(`${configuration.apiBaseUrl}/v1/billing/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "PayPal-Request-Id": `timmo-${ownerUserId}-${Date.now()}`,
    },
    body: JSON.stringify({
      plan_id: configuration.planId,
      custom_id: ownerUserId,
      application_context: {
        brand_name: "Timmo",
        locale: "en-US",
        shipping_preference: "NO_SHIPPING",
        user_action: "SUBSCRIBE_NOW",
        return_url: configuration.returnUrl,
        cancel_url: configuration.cancelUrl,
      },
    }),
  });

  if (!response.ok) {
    throw new PayPalApiError(response.status);
  }

  const subscription = PayPalCreateSubscriptionSchema.safeParse(await parseJsonResponse(response));

  if (!subscription.success) {
    throw new PayPalApiError(502);
  }

  return {
    ...subscription.data,
    plan_id: subscription.data.plan_id ?? configuration.planId,
    custom_id: subscription.data.custom_id ?? ownerUserId,
  };
};

const verifyWebhookSignature = async (
  headers: PayPalWebhookHeaders,
  event: Record<string, unknown>,
  configuration: PayPalBillingConfiguration,
): Promise<boolean> => {
  const accessToken = await getAccessToken(configuration);
  const response = await fetch(
    `${configuration.apiBaseUrl}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime,
        webhook_id: configuration.webhookId,
        webhook_event: event,
      }),
    },
  );

  if (!response.ok) {
    throw new PayPalApiError(response.status);
  }

  const verification = PayPalWebhookVerificationSchema.safeParse(await parseJsonResponse(response));

  return verification.success && verification.data.verification_status === "SUCCESS";
};

export const paypalClient = {
  getAccessToken,
  cancelSubscription,
  createSubscription,
  getSubscription,
  verifyWebhookSignature,
};
