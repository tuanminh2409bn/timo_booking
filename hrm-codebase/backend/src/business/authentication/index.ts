import { createHash } from "node:crypto";
import express from "express";
import type { Request } from "express";
import { handleErrorFunction } from "../../modules/verify-error-function.js";
import { adminSignin } from "./post-admin-signin.js";
import { changePassword } from "./post-change-password.js";
import { refreshToken } from "./post-refresh-token.js";
import { logout } from "./post-logout.js";
import { signin } from "./post-signin.js";
import { issueFirestoreToken } from "./post-firestore-token.js";
import {
  buildIpRateLimitFingerprint,
  createRequestRateLimit,
} from "../../modules/request-rate-limit.js";
import { observeBusinessHandler } from "../../modules/business-observability.js";
import {
  registerOwner,
  registerOwnerByAdmin,
} from "./customer-journey/post-register-owner.js";
import { requestForgotPasswordOtp } from "./customer-journey/post-forgot-password-request-otp.js";
import { verifyForgotPasswordOtp } from "./customer-journey/post-verify-forgot-password-otp.js";
import { resetPassword } from "./customer-journey/post-reset-password.js";

// Forgot-password OTP remains parked until the customer journey is finalized.

const authRouter = express.Router();

const hashRateLimitValue = (value: string) => {
  return createHash("sha256").update(value).digest("hex");
};

const buildEmailRateLimitFingerprint = (request: Request, defaultFingerprint: string) => {
  const email =
    typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : undefined;

  return email ? `email:${hashRateLimitValue(email)}` : defaultFingerprint;
};

const strictAuthIpRateLimit = createRequestRateLimit({
  keyPrefix: "ratelimit:auth:strict:ip",
  limit: 8,
  windowMs: 60_000,
  message: "Too many authentication attempts",
  fingerprintBuilder: buildIpRateLimitFingerprint,
});
const strictAuthEmailRateLimit = createRequestRateLimit({
  keyPrefix: "ratelimit:auth:strict:email",
  limit: 8,
  windowMs: 60_000,
  message: "Too many authentication attempts",
  fingerprintBuilder: buildEmailRateLimitFingerprint,
});
const sessionRateLimit = createRequestRateLimit({
  keyPrefix: "ratelimit:auth:session",
  limit: 15,
  windowMs: 60_000,
  message: "Too many session requests",
});

const strictAuthRateLimit = [strictAuthIpRateLimit, strictAuthEmailRateLimit];

authRouter.post(
  ["/api/v1/auth/admin-sessions", "/api/v1/auth/admin/signin"],
  strictAuthRateLimit,
  handleErrorFunction(adminSignin),
);
authRouter.post(
  ["/api/v1/auth/sessions", "/api/v1/auth/signin"],
  strictAuthRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "auth.signin",
        route: "/api/v1/auth/sessions",
      },
      signin,
    ),
  ),
);
authRouter.post(
  ["/api/v1/owners", "/api/v1/auth/register-owner"],
  strictAuthRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "owner.registration",
        route: "/api/v1/owners",
        spanName: "owner.register",
      },
      registerOwner,
    ),
  ),
);
authRouter.post(
  ["/api/v1/admin/owners", "/api/v1/auth/admin/register-owner"],
  strictAuthRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "owner.registration",
        route: "/api/v1/admin/owners",
        spanName: "owner.register",
      },
      registerOwnerByAdmin,
    ),
  ),
);
authRouter.post(
  ["/api/v1/password-reset-otp-requests", "/api/v1/auth/forgot-password/request-otp"],
  strictAuthRateLimit,
  handleErrorFunction(requestForgotPasswordOtp),
);
authRouter.post(
  ["/api/v1/password-reset-otp-verifications", "/api/v1/auth/forgot-password/verify-otp"],
  strictAuthRateLimit,
  handleErrorFunction(verifyForgotPasswordOtp),
);
authRouter.post(
  ["/api/v1/password-resets", "/api/v1/auth/forgot-password/reset-password"],
  strictAuthRateLimit,
  handleErrorFunction(resetPassword),
);
authRouter.delete("/api/v1/auth/sessions/current", sessionRateLimit, handleErrorFunction(logout));
authRouter.post("/api/v1/auth/logout", sessionRateLimit, handleErrorFunction(logout));
// @deprecated Firebase-only: client dùng thẳng Firebase ID token cho Firestore. Xoá khi FE ngừng gọi.
authRouter.post(
  ["/api/v1/auth/firebase-custom-tokens", "/api/v1/auth/firestore-token"],
  sessionRateLimit,
  handleErrorFunction(issueFirestoreToken),
);
authRouter.post("/api/v1/auth/refresh-token", sessionRateLimit, handleErrorFunction(refreshToken));
authRouter.patch(
  "/api/v1/users/me/password",
  sessionRateLimit,
  handleErrorFunction(changePassword),
);
authRouter.post(
  "/api/v1/auth/change-password",
  sessionRateLimit,
  handleErrorFunction(changePassword),
);

export default authRouter;
