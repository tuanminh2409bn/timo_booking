import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import dotenv from "dotenv";
import { cacheDelete, cacheGetJson, cacheSetJson } from "../repository/cache/cache-client.js";

dotenv.config();

const OTP_LENGTH = 6;
const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const OTP_EXPIRES_IN_MS = parsePositiveInteger(
  process.env["PASSWORD_RESET_OTP_EXPIRES_MS"] ?? String(10 * 60 * 1000),
  10 * 60 * 1000,
);
const OTP_RESEND_COOLDOWN_MS = parsePositiveInteger(
  process.env["PASSWORD_RESET_OTP_RESEND_COOLDOWN_MS"] ?? String(60 * 1000),
  60 * 1000,
);
const OTP_MAX_ATTEMPTS = parsePositiveInteger(
  process.env["PASSWORD_RESET_OTP_MAX_ATTEMPTS"] ?? "5",
  5,
);

export type PasswordResetOtpSession = {
  uid: string;
  email: string;
  otpHash: string;
  expiresAt: number;
  resendAvailableAt: number;
  failedAttempts: number;
};

const getOtpSecret = () => {
  const secret = process.env["PASSWORD_RESET_OTP_SECRET"] ?? process.env["JWT_SECRET"];

  if (!secret) {
    throw new Error("PASSWORD_RESET_OTP_SECRET or JWT_SECRET is required");
  }

  return secret;
};

const getPasswordResetOtpCacheKey = (email: string) =>
  `auth:password-reset:${email.trim().toLowerCase()}`;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const generateOtpCode = (): string =>
  randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");

export const hashOtpCode = (email: string, otpCode: string): string =>
  createHmac("sha256", getOtpSecret())
    .update(`${normalizeEmail(email)}:${otpCode}`)
    .digest("hex");

export const createPasswordResetOtpSession = async (
  uid: string,
  email: string,
  otpCode: string,
) => {
  const normalizedEmail = normalizeEmail(email);
  const session: PasswordResetOtpSession = {
    uid,
    email: normalizedEmail,
    otpHash: hashOtpCode(normalizedEmail, otpCode),
    expiresAt: Date.now() + OTP_EXPIRES_IN_MS,
    resendAvailableAt: Date.now() + OTP_RESEND_COOLDOWN_MS,
    failedAttempts: 0,
  };

  await cacheSetJson(
    getPasswordResetOtpCacheKey(normalizedEmail),
    session,
    OTP_EXPIRES_IN_MS,
  );

  return session;
};

export const getPasswordResetOtpSession = async (email: string) =>
  cacheGetJson<PasswordResetOtpSession>(getPasswordResetOtpCacheKey(email));

export const deletePasswordResetOtpSession = async (email: string) =>
  cacheDelete(getPasswordResetOtpCacheKey(email));

export const increasePasswordResetOtpFailedAttempts = async (
  session: PasswordResetOtpSession,
) => {
  const nextSession: PasswordResetOtpSession = {
    ...session,
    failedAttempts: session.failedAttempts + 1,
  };
  const ttlMs = Math.max(1000, session.expiresAt - Date.now());

  await cacheSetJson(getPasswordResetOtpCacheKey(session.email), nextSession, ttlMs);

  return nextSession;
};

export const isPasswordResetOtpExpired = (session: PasswordResetOtpSession) =>
  session.expiresAt <= Date.now();

export const canResendPasswordResetOtp = (session: PasswordResetOtpSession) =>
  session.resendAvailableAt <= Date.now();

export const verifyPasswordResetOtpCode = (
  session: PasswordResetOtpSession,
  otpCode: string,
) => {
  const expectedHash = Buffer.from(session.otpHash, "hex");
  const actualHash = Buffer.from(hashOtpCode(session.email, otpCode), "hex");

  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
};

export const getPasswordResetOtpConfig = () => ({
  otpLength: OTP_LENGTH,
  expiresInMs: OTP_EXPIRES_IN_MS,
  resendCooldownMs: OTP_RESEND_COOLDOWN_MS,
  maxAttempts: OTP_MAX_ATTEMPTS,
});
