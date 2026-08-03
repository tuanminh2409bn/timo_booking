import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { firebaseAuthRepository } from "../../../repository/firebase-auth/index.js";
import {
  deletePasswordResetOtpSession,
  getPasswordResetOtpConfig,
  getPasswordResetOtpSession,
  increasePasswordResetOtpFailedAttempts,
  isPasswordResetOtpExpired,
  verifyPasswordResetOtpCode,
} from "../../../helpers/password-reset-otp.js";
import { verifyPasswordResetToken } from "../../../helpers/password-reset-token.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";

const resetPasswordByTokenSchema = z.object({
  resetToken: z.string().trim().min(1),
  password: z.string().min(6),
});

const resetPasswordByOtpSchema = z.object({
  email: z.string().trim().email(),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
  password: z.string().min(6),
});

const resetPasswordSchema = z.union([resetPasswordByTokenSchema, resetPasswordByOtpSchema]);

const SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/auth/reset-password/invalid-request",
    message: "Invalid request",
  },
  otpInvalid: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/auth/reset-password/otp-invalid",
    message: "OTP is invalid",
  },
  otpExpired: {
    statusCode: StatusCodes.GONE,
    type: "/auth/reset-password/otp-expired",
    message: "OTP has expired",
  },
  otpTooManyAttempts: {
    statusCode: StatusCodes.TOO_MANY_REQUESTS,
    type: "/auth/reset-password/otp-too-many-attempts",
    message: "Too many invalid OTP attempts",
  },
};

export const resetPassword = async (req: Request, res: Response) => {
  const resetPasswordParseResult = resetPasswordSchema.safeParse(req.body);

  if (!resetPasswordParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: resetPasswordParseResult.error.flatten().fieldErrors,
    });
  }

  let uid: string;
  let emailToDeleteOtp: string | undefined;
  let resetMethod: "otp" | "token";

  if ("resetToken" in resetPasswordParseResult.data) {
    try {
      const resetTokenPayload = verifyPasswordResetToken(resetPasswordParseResult.data.resetToken);
      uid = resetTokenPayload.uid;
      emailToDeleteOtp = resetTokenPayload.email;
      resetMethod = "token";
    } catch {
      return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
        reason: "invalid reset token",
      });
    }
  } else {
    const otpSession = await getPasswordResetOtpSession(resetPasswordParseResult.data.email);

    if (!otpSession) {
      return createErrorResponse(res, SERVICE_ERRORS.otpExpired);
    }

    if (isPasswordResetOtpExpired(otpSession)) {
      await deletePasswordResetOtpSession(otpSession.email);
      return createErrorResponse(res, SERVICE_ERRORS.otpExpired, {
        uid: otpSession.uid,
      });
    }

    if (!verifyPasswordResetOtpCode(otpSession, resetPasswordParseResult.data.otp)) {
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

    uid = otpSession.uid;
    emailToDeleteOtp = otpSession.email;
    resetMethod = "otp";
  }

  const passwordUpdatedAt = Date.now();
  await firebaseAuthRepository.auth.updateUserPassword(uid, resetPasswordParseResult.data.password);
  await firestoreRepository.user
    .updateUser(uid, {
      passwordUpdatedAt,
      updatedAt: passwordUpdatedAt,
      updatedByUserId: uid,
    })
    .catch(() => undefined);
  await firebaseAuthRepository.auth.revokeRefreshTokens(uid);

  if (emailToDeleteOtp) {
    await deletePasswordResetOtpSession(emailToDeleteOtp);
  }

  try {
    const user = await firestoreRepository.user.getUser(uid);

    if (user.ownerId) {
      await writeShopAuditLog({
        ownerId: user.ownerId,
        eventType: "password_reset_completed",
        entityType: "security",
        entityId: uid,
        actor: {
          uid,
          role: user.role,
        },
        metadata: {
          targetUserId: uid,
          resetMethod,
        },
      });
    }
  } catch {
    // Keep password reset successful even if user audit lookup fails.
  }

  return res.status(StatusCodes.OK).json({
    success: true,
  });
};
