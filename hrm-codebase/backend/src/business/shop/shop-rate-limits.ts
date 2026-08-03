import { createPolicyRateLimit } from "../../config/rate-limit-policies.js";

export const shopReadRateLimit = createPolicyRateLimit("read", {
  keyPrefix: "ratelimit:store:read",
  message: "Too many store API read requests",
});

export const shopWriteRateLimit = createPolicyRateLimit("write", {
  keyPrefix: "ratelimit:store:write",
  message: "Too many store API write requests",
});
