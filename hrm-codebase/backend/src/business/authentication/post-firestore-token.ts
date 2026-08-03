import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../constants/firestore-error.js";
import { buildFirestoreAuthClaims } from "../../helpers/firebase-auth-claims.js";
import { getCanonicalOwnerId, getCanonicalStoreId } from "../../helpers/store-scope.js";
import { isEmployeeRole, isSupportedSigninRole } from "../../helpers/user-roles.js";
import { createErrorResponse } from "../../modules/create-error-response.js";
import { logger } from "../../modules/logger.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firebaseAuthRepository } from "../../repository/firebase-auth/index.js";
import { firestoreRepository } from "../../repository/firestore/index.js";

const SERVICE_ERRORS = {
  profileNotConfigured: {
    statusCode: StatusCodes.CONFLICT,
    type: "/auth/firestore-token/profile-not-configured",
    message: "User profile is not configured",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/auth/firestore-token/forbidden-role",
    message: "requested role is not allowed for this account",
  },
  userDisabled: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/auth/firestore-token/user-disabled",
    message: "user is disabled",
  },
  storeNotConfigured: {
    statusCode: StatusCodes.CONFLICT,
    type: "/auth/firestore-token/store-not-configured",
    message: "Store-scoped account is missing store configuration",
  },
};
/**
 * @deprecated Firebase-only: client giờ auth bằng Firebase ID token (đã mang sẵn custom claims
 * role/ownerId/storeId), nên nói chuyện Firestore trực tiếp được — không cần đổi lấy custom token.
 * Giữ tạm cho tương thích; xoá khi FE ngừng gọi (theo dõi qua log `auth.firestore_token.deprecated`).
 * Xem docs/auth-firebase-token-migration.md.
 */
export const issueFirestoreToken = async (req: Request, res: Response) => {
  logger.warn(
    { event: "auth.firestore_token.deprecated" },
    "deprecated /auth/firestore-token called; client should use its Firebase ID token directly",
  );

  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  const user = await firestoreRepository.user
    .getSigninUser(authContext.uid)
    .catch((error: unknown) => {
      if (error instanceof FirestoreDataNotFoundError) {
        return undefined;
      }

      throw error;
    });

  if (!user) {
    return createErrorResponse(res, SERVICE_ERRORS.profileNotConfigured, {
      reason: "no user profile for uid",
    });
  }

  if (!isSupportedSigninRole(user.role)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: user.role });
  }

  if (!user.active) {
    return createErrorResponse(res, SERVICE_ERRORS.userDisabled, { role: user.role });
  }

  const storeId = getCanonicalStoreId(user);

  if (isEmployeeRole(user.role) && !storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.storeNotConfigured, { role: user.role });
  }

  const ownerId = getCanonicalOwnerId(user);
  const claims = buildFirestoreAuthClaims({ role: user.role, ownerId, storeId });

  if (!claims) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, {
      role: user.role,
      reason: "claims build failed",
    });
  }

  const firebaseCustomToken = await firebaseAuthRepository.auth.createCustomToken(user.uid, claims);

  return res.status(StatusCodes.OK).json({ firebaseCustomToken });
};
