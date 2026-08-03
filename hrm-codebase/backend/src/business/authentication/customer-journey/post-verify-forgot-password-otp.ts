import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import {
  deletePasswordResetOtpSession,
  getPasswordResetOtpConfig,
  getPasswordResetOtpSession,
  increasePasswordResetOtpFailedAttempts,
  isPasswordResetOtpExpired,
  verifyPasswordResetOtpCode,
} from "../../../helpers/password-reset-otp.js";
import { createPasswordResetToken } from "../../../helpers/password-reset-token.js";

const verifyForgotPasswordOtpSchema = z.object({
  email: z.string().trim().email(),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

const SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/auth/verify-forgot-password-otp/invalid-request",
    message: "Invalid request",
  },
  otpInvalid: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/auth/verify-forgot-password-otp/otp-invalid",
    message: "OTP is invalid",
  },
  otpExpired: {
    statusCode: StatusCodes.GONE,
    type: "/auth/verify-forgot-password-otp/otp-expired",
    message: "OTP has expired",
  },
  otpTooManyAttempts: {
    statusCode: StatusCodes.TOO_MANY_REQUESTS,
    type: "/auth/verify-forgot-password-otp/otp-too-many-attempts",
    message: "Too many invalid OTP attempts",
  },
};
export const verifyForgotPasswordOtp = async (req: Request, res: Response) => {
  const verifyForgotPasswordOtpParseResult = verifyForgotPasswordOtpSchema.safeParse(req.body);

  if (!verifyForgotPasswordOtpParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: verifyForgotPasswordOtpParseResult.error.flatten().fieldErrors,
    });
  }

  const otpSession = await getPasswordResetOtpSession(verifyForgotPasswordOtpParseResult.data.email);

  if (!otpSession) {
    return createErrorResponse(res, SERVICE_ERRORS.otpExpired);
  }

  if (isPasswordResetOtpExpired(otpSession)) {
    await deletePasswordResetOtpSession(otpSession.email);
    return createErrorResponse(res, SERVICE_ERRORS.otpExpired, {
      uid: otpSession.uid,
    });
  }

  if (!verifyPasswordResetOtpCode(otpSession, verifyForgotPasswordOtpParseResult.data.otp)) {
    const nextSession = await increasePasswordResetOtpFailedAttempts(otpSession);

    if (nextSession.failedAttempts >= getPasswordResetOtpConfig().maxAttempts) {
      await deletePasswordResetOtpSession(otpSession.email);
      return createErrorResponse(res, SERVICE_ERRORS.otpTooManyAttempts, {
        uid: otpSession.uid,
      });
    }

    return createErrorResponse(res, SERVICE_ERRORS.otpInvalid, {
      uid: otpSession.uid,
    });
  }

  return res.status(StatusCodes.OK).json({
    success: true,
    resetToken: createPasswordResetToken({
      uid: otpSession.uid,
      email: otpSession.email,
    }),
  });
};
