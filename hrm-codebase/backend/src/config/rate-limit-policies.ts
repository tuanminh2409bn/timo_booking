import {
  createRequestRateLimit,
  type RateLimitOptions,
} from "../modules/request-rate-limit.js";

export const RATE_LIMIT_POLICIES = {
  auth: {
    limit: 8,
    windowMs: 60_000,
  },
  otp: {
    limit: 6,
    windowMs: 10 * 60_000,
  },
  read: {
    limit: 90,
    windowMs: 60_000,
  },
  calendarRead: {
    limit: 300,
    windowMs: 60_000,
  },
  heavyRead: {
    limit: 24,
    windowMs: 60_000,
  },
  write: {
    limit: 24,
    windowMs: 60_000,
  },
  upload: {
    limit: 6,
    windowMs: 10 * 60_000,
  },
  idempotentWrite: {
    limit: 36,
    windowMs: 60_000,
  },
} as const;

type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export const createPolicyRateLimit = (
  policyName: RateLimitPolicyName,
  options: Pick<RateLimitOptions, "keyPrefix" | "message" | "fingerprintBuilder">,
) =>
  createRequestRateLimit({
    ...RATE_LIMIT_POLICIES[policyName],
    ...options,
  });
