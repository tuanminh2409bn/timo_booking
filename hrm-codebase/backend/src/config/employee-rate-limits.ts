import { createPolicyRateLimit } from "./rate-limit-policies.js";

export const readRateLimit = createPolicyRateLimit("read", {
  keyPrefix: "ratelimit:employee:read",
  message: "Too many employee API read requests",
});

export const calendarReadRateLimit = createPolicyRateLimit("calendarRead", {
  keyPrefix: "ratelimit:employee:calendar-read",
  message: "Too many employee calendar read requests",
});

export const heavyReadRateLimit = createPolicyRateLimit("heavyRead", {
  keyPrefix: "ratelimit:employee:heavy-read",
  message: "Too many expensive employee API requests",
});

export const writeRateLimit = createPolicyRateLimit("write", {
  keyPrefix: "ratelimit:employee:write",
  message: "Too many employee API write requests",
});
