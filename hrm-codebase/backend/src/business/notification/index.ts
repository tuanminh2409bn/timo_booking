import express from "express";
import { handleErrorFunction } from "../../modules/verify-error-function.js";
import { createPolicyRateLimit } from "../../config/rate-limit-policies.js";
import { observeBusinessHandler } from "../../modules/business-observability.js";
import { getNotificationFeed } from "./get-notification-feed.js";

const notificationRouter = express.Router();
const readRateLimit = createPolicyRateLimit("read", {
  keyPrefix: "ratelimit:notification:read",
  message: "Too many notification API requests",
});

notificationRouter.get(
  "/api/v1/notifications",
  readRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "notification.feed.generated",
        route: "/api/v1/notifications",
        spanName: "notification.feed.get",
      },
      getNotificationFeed,
    ),
  ),
);

export default notificationRouter;
