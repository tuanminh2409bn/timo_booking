import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { FirestoreDataNotFoundError } from "../../constants/firestore-error.js";
import { createErrorResponse } from "../../modules/create-error-response.js";
import { verifyFirebaseAuthHeader } from "../../modules/verify-firebase-auth-header.js";
import { firebaseAuthRepository } from "../../repository/firebase-auth/index.js";
import { firestoreRepository } from "../../repository/firestore/index.js";

const RECENT_AUTH_WINDOW_SECONDS = 5 * 60;

const changePasswordSchema = z.object({
  newPassword: z.string().min(8),
});

const SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/auth/change-password/invalid-request",
    message: "Invalid request",
  },
  recentSigninRequired: {
    statusCode: StatusCodes.UNAUTHORIZED,
    type: "/auth/change-password/recent-signin-required",
    message: "Recent sign-in is required to change password",
  },
  profileNotConfigured: {
    statusCode: StatusCodes.CONFLICT,
    type: "/auth/change-password/profile-not-configured",
    message: "User profile is not configured",
  },
  userDisabled: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/auth/change-password/user-disabled",
    message: "user is disabled",
  },
};

export const changePassword = async (req: Request, res: Response) => {
  const changePasswordParseResult = changePasswordSchema.safeParse(req.body);

  if (!changePasswordParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: changePasswordParseResult.error.flatten().fieldErrors,
    });
  }

  const { uid, authTime } = await verifyFirebaseAuthHeader(req.headers["authorization"]);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (!authTime || nowSeconds - authTime > RECENT_AUTH_WINDOW_SECONDS) {
    return createErrorResponse(res, SERVICE_ERRORS.recentSigninRequired, {
      reason: "signin too old for password change",
    });
  }

  const verifiedUserFromDatabase = await firestoreRepository.user
    .getUser(uid)
    .catch((error: unknown) => {
      if (error instanceof FirestoreDataNotFoundError) {
        return undefined;
      }

      throw error;
    });

  if (!verifiedUserFromDatabase) {
    return createErrorResponse(res, SERVICE_ERRORS.profileNotConfigured, {
      reason: "no user profile for uid",
    });
  }

  if (!verifiedUserFromDatabase.active) {
    return createErrorResponse(res, SERVICE_ERRORS.userDisabled, {
      role: verifiedUserFromDatabase.role,
    });
  }

  const updatedAt = Date.now();
  await firebaseAuthRepository.auth.updateUserPassword(
    uid,
    changePasswordParseResult.data.newPassword,
  );
  await firestoreRepository.user
    .updateUser(uid, {
      passwordUpdatedAt: updatedAt,
      updatedAt,
      updatedByUserId: uid,
    })
    .catch(() => undefined);
  await firebaseAuthRepository.auth.revokeRefreshTokens(uid);

  return res.status(StatusCodes.OK).json({
    success: true,
  });
};
