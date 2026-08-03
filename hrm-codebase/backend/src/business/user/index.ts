import express from "express";
import { handleErrorFunction } from "../../modules/verify-error-function.js";
import { getUserProfile } from "./get-user-profile.js";
import { updateUserProfile } from "./patch-user-profile.js";
import { createPolicyRateLimit } from "../../config/rate-limit-policies.js";
import { getDataRetentionPlan } from "./get-data-retention-plan.js";
import { updateDataRetentionPlan } from "./patch-data-retention-plan.js";
import { getAccountSecurity } from "./get-account-security.js";
import { requestAccountDeletion } from "./post-account-deletion-request.js";
import { observeDataRetentionHandler } from "../data-retention/data-retention-observability.js";
import {
  DATA_RETENTION_TRACE_OPERATIONS,
  DATA_RETENTION_TRACE_SPANS,
} from "../data-retention/data-retention-tracing-contract.js";

const userRouter = express.Router();

const profileReadRateLimit = createPolicyRateLimit("read", {
  keyPrefix: "ratelimit:user:profile-read",
  message: "Too many user profile requests",
});
const profileWriteRateLimit = createPolicyRateLimit("write", {
  keyPrefix: "ratelimit:user:profile-write",
  message: "Too many user profile updates",
});
const securityWriteRateLimit = createPolicyRateLimit("write", {
  keyPrefix: "ratelimit:user:security-write",
  message: "Too many account security updates",
});

userRouter.get(
  ["/api/v1/users/:userId/profile", "/api/v1/account/profile"],
  profileReadRateLimit,
  handleErrorFunction(getUserProfile),
);
userRouter.patch(
  ["/api/v1/users/:userId/profile", "/api/v1/account/profile"],
  profileWriteRateLimit,
  handleErrorFunction(updateUserProfile),
);
userRouter.get(
  "/api/v1/account/data-retention-plan",
  profileReadRateLimit,
  handleErrorFunction(
    observeDataRetentionHandler(
      {
        spanName: DATA_RETENTION_TRACE_SPANS.planRead,
        route: "/api/v1/account/data-retention-plan",
        operation: DATA_RETENTION_TRACE_OPERATIONS.planRead,
      },
      getDataRetentionPlan,
    ),
  ),
);
userRouter.patch(
  "/api/v1/account/data-retention-plan",
  profileWriteRateLimit,
  handleErrorFunction(
    observeDataRetentionHandler(
      {
        spanName: DATA_RETENTION_TRACE_SPANS.planUpdate,
        route: "/api/v1/account/data-retention-plan",
        operation: DATA_RETENTION_TRACE_OPERATIONS.planUpdate,
      },
      updateDataRetentionPlan,
    ),
  ),
);
userRouter.get(
  "/api/v1/account/security",
  profileReadRateLimit,
  handleErrorFunction(getAccountSecurity),
);
userRouter.post(
  "/api/v1/account/deletion-request",
  securityWriteRateLimit,
  handleErrorFunction(requestAccountDeletion),
);

export default userRouter;
