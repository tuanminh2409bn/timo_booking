import type { BillingProvider } from "./billing.types.js";

const BILLING_PLAN_CODE = "premium" as const;
const BILLING_AMOUNT = process.env["BILLING_PREMIUM_MONTHLY_AMOUNT"] ?? "99.99";
const BILLING_CURRENCY = process.env["BILLING_PREMIUM_MONTHLY_CURRENCY"] ?? "EUR";

export type PayPalBillingConfiguration = {
  mode: "sandbox" | "live";
  clientId: string;
  clientSecret: string;
  webhookId: string;
  planId: string;
  productId?: string;
  apiBaseUrl: string;
  returnUrl: string;
  cancelUrl: string;
};

export type BillingPlanConfiguration = {
  code: typeof BILLING_PLAN_CODE;
  name: "Premium";
  amount: string;
  currency: string;
  interval: "month";
};

export const getBillingPlanConfiguration = (): BillingPlanConfiguration => ({
  code: BILLING_PLAN_CODE,
  name: "Premium",
  amount: BILLING_AMOUNT,
  currency: BILLING_CURRENCY,
  interval: "month",
});

const readEnvironmentValue = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const getPayPalRedirectUrl = (status: "approved" | "cancelled"): string => {
  const configuredUrl = readEnvironmentValue(
    status === "approved" ? "PAYPAL_RETURN_URL" : "PAYPAL_CANCEL_URL",
  );

  let redirectUrl: URL;

  if (configuredUrl !== undefined) {
    redirectUrl = new URL(configuredUrl);
  } else {
    const defaultWebAppBaseUrl =
      process.env["NODE_ENV"] === "production" ? "https://timmo.com.vn" : "http://localhost:5173";
    const webAppBaseUrl = readEnvironmentValue("PUBLIC_WEB_APP_URL") ?? defaultWebAppBaseUrl;
    redirectUrl = new URL(`/account/upgrade?payment=paypal&status=${status}`, webAppBaseUrl);
  }

  if (redirectUrl.protocol !== "https:" && redirectUrl.hostname !== "localhost") {
    throw new Error("PayPal redirect URLs must use HTTPS outside localhost");
  }

  return redirectUrl.toString();
};

export const getPayPalBillingConfiguration = (): PayPalBillingConfiguration | undefined => {
  const clientId = readEnvironmentValue("PAYPAL_CLIENT_ID");
  const clientSecret = readEnvironmentValue("PAYPAL_CLIENT_SECRET");
  const webhookId = readEnvironmentValue("PAYPAL_WEBHOOK_ID");
  const planId = readEnvironmentValue("PAYPAL_PREMIUM_MONTHLY_PLAN_ID");
  const productId = readEnvironmentValue("PAYPAL_PRODUCT_ID");
  const returnUrl = getPayPalRedirectUrl("approved");
  const cancelUrl = getPayPalRedirectUrl("cancelled");
  const mode = process.env["PAYPAL_MODE"] === "live" ? "live" : "sandbox";

  if (
    clientId === undefined ||
    clientSecret === undefined ||
    webhookId === undefined ||
    planId === undefined ||
    planId === "P-..."
  ) {
    return undefined;
  }

  return {
    mode,
    clientId,
    clientSecret,
    webhookId,
    planId,
    ...(productId !== undefined && { productId }),
    apiBaseUrl: mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
    returnUrl,
    cancelUrl,
  };
};

export const getBillingMethodAvailability = (
  provider: BillingProvider,
): "available" | "coming_soon" => {
  if (provider === "paypal" && getPayPalBillingConfiguration() !== undefined) {
    return "available";
  }

  return "coming_soon";
};
