import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../constants/firestore-error.js";
import {
  createErrorResponse,
  type ErrorResponseBodyType,
} from "../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firebaseAuthRepository } from "../../repository/firebase-auth/index.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import type { UserType } from "../../repository/firestore/user/user.types.js";
import { resolveOwnerDataRetentionPlanResponse } from "./data-retention-plan-shared.js";

const SERVICE_ERRORS = {
  userNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/account/security/user-not-found",
    message: "User not found",
  },
  internalError: {
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    type: "/account/security/internal-error",
    message: "Internal Server Error",
  },
};

export type AccountSecurityResponse = {
  lastLoginAt?: number;
  passwordUpdatedAt?: number;
  twoFactorEnabled: boolean;
  deletion: {
    status: "active" | "requested";
    requestedAt?: number;
  };
  retention?: {
    plan: "standard" | "premium";
    detailRetentionMonths: number | null;
    planChangedAt: number;
    standardRetentionEligibleAt?: number;
  };
};

const parseFirebaseTimestamp = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const toAccountSecurityResponse = (
  user: UserType,
  firebaseUser: Awaited<ReturnType<typeof firebaseAuthRepository.auth.getUser>>,
  now: number,
): AccountSecurityResponse => {
  const firebaseLastLoginAt = parseFirebaseTimestamp(firebaseUser.metadata?.lastSignInTime);
  let lastLoginAt = user.lastLoginAt;

  if (
    firebaseLastLoginAt !== undefined &&
    (lastLoginAt === undefined || firebaseLastLoginAt > lastLoginAt)
  ) {
    lastLoginAt = firebaseLastLoginAt;
  }
  const response: AccountSecurityResponse = {
    ...(lastLoginAt !== undefined && { lastLoginAt }),
    ...(user.passwordUpdatedAt !== undefined && { passwordUpdatedAt: user.passwordUpdatedAt }),
    twoFactorEnabled:
      firebaseUser.multiFactor?.enrolledFactors.some((factor) => factor.factorId === "totp") ??
      false,
    deletion: {
      status: user.accountDeletionRequestedAt === undefined ? "active" : "requested",
      ...(user.accountDeletionRequestedAt !== undefined && {
        requestedAt: user.accountDeletionRequestedAt,
      }),
    },
  };

  if (user.role === "owner") {
    response.retention = resolveOwnerDataRetentionPlanResponse(user, now);
  }

  return response;
};

export const getAccountSecurity = async (
  req: Request,
  res: Response<AccountSecurityResponse | ErrorResponseBodyType>,
) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  let user: UserType;

  try {
    user = await firestoreRepository.user.getUser(authContext.uid);
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_ERRORS.userNotFound, { userId: authContext.uid });
    }

    return createErrorResponse(res, SERVICE_ERRORS.internalError, {
      userId: authContext.uid,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const firebaseUser = await firebaseAuthRepository.auth.getUser(authContext.uid);
    return res
      .status(StatusCodes.OK)
      .json(toAccountSecurityResponse(user, firebaseUser, Date.now()));
  } catch (error) {
    return createErrorResponse(res, SERVICE_ERRORS.internalError, {
      userId: authContext.uid,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
};
