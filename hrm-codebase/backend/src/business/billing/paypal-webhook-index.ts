import express from "express";
import {
  buildIpRateLimitFingerprint,
  createRequestRateLimit,
} from "../../modules/request-rate-limit.js";
import { handleErrorFunction } from "../../modules/verify-error-function.js";
import { handlePayPalWebhook } from "./post-paypal-webhook.js";

const paypalWebhookRouter = express.Router();
const paypalWebhookRateLimit = createRequestRateLimit({
  keyPrefix: "ratelimit:webhook:paypal",
  limit: 120,
  windowMs: 60_000,
  message: "Too many PayPal webhook requests",
  fingerprintBuilder: buildIpRateLimitFingerprint,
});

paypalWebhookRouter.post(
  "/api/v1/webhooks/paypal",
  paypalWebhookRateLimit,
  handleErrorFunction(handlePayPalWebhook),
);

export default paypalWebhookRouter;
