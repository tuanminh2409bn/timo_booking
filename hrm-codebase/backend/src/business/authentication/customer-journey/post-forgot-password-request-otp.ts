import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { firebaseAuthRepository } from "../../../repository/firebase-auth/index.js";
import {
  createPasswordResetOtpSession,
  generateOtpCode,
  getPasswordResetOtpConfig,
  getPasswordResetOtpSession,
  normalizeEmail,
} from "../../../helpers/password-reset-otp.js";
import { sendPasswordResetOtpEmail } from "../../../helpers/password-reset-mailer.js";

const forgotPasswordRequestSchema = z.object({
  email: z.string().trim().email(),
});

const SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/auth/forgot-password-request-otp/invalid-request",
    message: "Invalid request",
  },
  otpResendTooSoon: {
    statusCode: StatusCodes.TOO_MANY_REQUESTS,
    type: "/auth/forgot-password-request-otp/otp-resend-too-soon",
    message: "Please wait before requesting another OTP",
  },
  otpDeliveryUnavailable: {
    statusCode: StatusCodes.SERVICE_UNAVAILABLE,
    type: "/auth/forgot-password-request-otp/otp-delivery-unavailable",
    message: "OTP delivery is unavailable",
  },
};
const buildGenericResponse = (email: string) => {
  const otpConfig = getPasswordResetOtpConfig();

  return {
    success: true,
    email: normalizeEmail(email),
    otpLength: otpConfig.otpLength,
    expiresInMs: otpConfig.expiresInMs,
    resendCooldownMs: otpConfig.resendCooldownMs,
  };
};

export const requestForgotPasswordOtp = async (req: Request, res: Response) => {
  const forgotPasswordRequestParseResult = forgotPasswordRequestSchema.safeParse(req.body);

  if (!forgotPasswordRequestParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: forgotPasswordRequestParseResult.error.flatten().fieldErrors,
    });
  }

  const normalizedEmail = normalizeEmail(forgotPasswordRequestParseResult.data.email);
  const existingOtpSession = await getPasswordResetOtpSession(normalizedEmail);

  if (existingOtpSession && existingOtpSession.resendAvailableAt > Date.now()) {
    return createErrorResponse(res, SERVICE_ERRORS.otpResendTooSoon, {
      uid: existingOtpSession.uid,
    });
  }

  try {
    const [userFromDatabase, authProviderUser] = await Promise.all([
      firestoreRepository.user.getUserByEmail(normalizedEmail),
      firebaseAuthRepository.auth.getUserByEmail(normalizedEmail),
    ]);

    if (!userFromDatabase.active) {
      return res.status(StatusCodes.OK).json(buildGenericResponse(normalizedEmail));
    }

    const otpCode = generateOtpCode();
    await createPasswordResetOtpSession(authProviderUser.uid, normalizedEmail, otpCode);

    const delivered = await sendPasswordResetOtpEmail(normalizedEmail, otpCode);

    if (!delivered && process.env["NODE_ENV"] === "production") {
      return createErrorResponse(res, SERVICE_ERRORS.otpDeliveryUnavailable, {
        uid: authProviderUser.uid,
      });
    }

    const response: {
      success: boolean;
      email: string;
      otpLength: number;
      expiresInMs: number;
      resendCooldownMs: number;
      delivery: "email" | "debug";
      debugOtpCode?: string | undefined;
    } = {
      ...buildGenericResponse(normalizedEmail),
      delivery: delivered ? "email" : "debug",
    };

    if (!delivered && process.env["NODE_ENV"] !== "production") {
      response.debugOtpCode = otpCode;
    }

    return res.status(StatusCodes.OK).json(response);
  } catch {
    return res.status(StatusCodes.OK).json(buildGenericResponse(normalizedEmail));
  }
};
