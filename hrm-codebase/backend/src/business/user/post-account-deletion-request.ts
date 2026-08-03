import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../constants/firestore-error.js";
import { writeShopAuditLog } from "../../helpers/shop-audit-log.js";
import {
  createErrorResponse,
  type ErrorResponseBodyType,
} from "../../modules/create-error-response.js";
import { verifyFirebaseAuthHeader } from "../../modules/verify-firebase-auth-header.js";
import { firebaseAuthRepository } from "../../repository/firebase-auth/index.js";
import { firestoreRepository } from "../../repository/firestore/index.js";

const RECENT_AUTH_WINDOW_SECONDS = 5 * 60;

const SERVICE_ERRORS = {
  recentSigninRequired: {
    statusCode: StatusCodes.UNAUTHORIZED,
    type: "/account/security/deletion/recent-signin-required",
    message: "Recent sign-in is required to request account deletion",
  },
  userNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/account/security/deletion/user-not-found",
    message: "User not found",
  },
  alreadyRequested: {
    statusCode: StatusCodes.CONFLICT,
    type: "/account/security/deletion/already-requested",
    message: "Account deletion has already been requested",
  },
  internalError: {
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    type: "/account/security/deletion/internal-error",
    message: "Unable to request account deletion",
  },
};

export type AccountDeletionResponse = {
  success: true;
  status: "requested";
  requestedAt: number;
};

export const requestAccountDeletion = async (
  req: Request,
  res: Response<AccountDeletionResponse | ErrorResponseBodyType>,
) => {
  const { uid, authTime } = await verifyFirebaseAuthHeader(req.headers["authorization"]);
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);

  if (!authTime || nowSeconds - authTime > RECENT_AUTH_WINDOW_SECONDS) {
    return createErrorResponse(res, SERVICE_ERRORS.recentSigninRequired);
  }

  let user;

  try {
    user = await firestoreRepository.user.getUser(uid);
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_ERRORS.userNotFound, { uid });
    }

    return createErrorResponse(res, SERVICE_ERRORS.internalError, {
      uid,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  if (user.accountDeletionRequestedAt !== undefined) {
    return createErrorResponse(res, SERVICE_ERRORS.alreadyRequested, {
      requestedAt: user.accountDeletionRequestedAt,
    });
  }

  try {
    await firestoreRepository.user.updateUser(uid, {
      active: false,
      accountDeletionRequestedAt: now,
      accountDeletionRequestedByUserId: uid,
      accountDeletionRequestedByRole: user.role,
      updatedAt: now,
      updatedByUserId: uid,
    });

    await firebaseAuthRepository.auth.updateUserProfile(uid, { disabled: true });
    await firebaseAuthRepository.auth.revokeRefreshTokens(uid);

    await writeShopAuditLog({
      ownerId: user.ownerId,
      eventType: "account_deletion_requested",
      entityType: "security",
      entityId: uid,
      actor: {
        uid,
        role: user.role,
      },
      metadata: {
        retentionAction: "preserve_profile_and_counters",
        detailDeletion: "delegated_to_retention_policy",
      },
    }).catch(() => undefined);
  } catch (error) {
    return createErrorResponse(res, SERVICE_ERRORS.internalError, {
      uid,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  return res.status(StatusCodes.OK).json({
    success: true,
    status: "requested",
    requestedAt: now,
  });
};
