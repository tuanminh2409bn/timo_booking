import express from "express";
import { createPolicyRateLimit } from "../../config/rate-limit-policies.js";
import { handleErrorFunction } from "../../modules/verify-error-function.js";
import { getAccountBilling } from "./get-account-billing.js";
import { createAccountBillingSubscription } from "./post-account-billing-subscription.js";
import { cancelAccountBillingSubscription } from "./post-cancel-account-billing-subscription.js";
import { startAccountBillingSubscription } from "./post-start-account-billing-subscription.js";
import { createStripeCheckout } from "./stripe.js";

const billingRouter = express.Router();
const billingReadRateLimit = createPolicyRateLimit("read", {
  keyPrefix: "ratelimit:billing:read",
  message: "Too many billing requests",
});
const billingWriteRateLimit = createPolicyRateLimit("write", {
  keyPrefix: "ratelimit:billing:write",
  message: "Too many billing updates",
});

billingRouter.get(
  "/api/v1/account/billing",
  billingReadRateLimit,
  handleErrorFunction(getAccountBilling),
);
billingRouter.post(
  "/api/v1/billing/checkout",
  billingWriteRateLimit,
  handleErrorFunction(createStripeCheckout),
);
billingRouter.post(
  "/api/v1/account/billing/subscriptions/start",
  billingWriteRateLimit,
  handleErrorFunction(startAccountBillingSubscription),
);
billingRouter.post(
  "/api/v1/account/billing/subscriptions",
  billingWriteRateLimit,
  handleErrorFunction(createAccountBillingSubscription),
);
billingRouter.post(
  "/api/v1/account/billing/subscriptions/cancel",
  billingWriteRateLimit,
  handleErrorFunction(cancelAccountBillingSubscription),
);

export default billingRouter;
