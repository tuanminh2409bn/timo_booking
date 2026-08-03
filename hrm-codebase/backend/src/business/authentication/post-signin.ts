import { performance } from "node:perf_hooks";
import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { FirestoreDataNotFoundError } from "../../constants/firestore-error.js";
import {
  buildFirestoreAuthClaims,
} from "../../helpers/firebase-auth-claims.js";
import { getCanonicalOwnerId, getCanonicalStoreId } from "../../helpers/store-scope.js";
import { getUserDisplayName } from "../../helpers/user-name.js";
import { isEmployeeRole, isSupportedSigninRole } from "../../helpers/user-roles.js";
import { createErrorResponse } from "../../modules/create-error-response.js";
import { logger } from "../../modules/logger.js";
import { setRequestContextIdentity } from "../../modules/request-context.js";
import { ServerTiming } from "../../modules/server-timing.js";
import { firebaseAuthRepository } from "../../repository/firebase-auth/index.js";
import { firestoreRepository } from "../../repository/firestore/index.js";

const SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/auth/signin/invalid-request",
    message: "Firebase ID token is required",
  },
  invalidCredentials: {
    statusCode: StatusCodes.UNAUTHORIZED,
    type: "/auth/signin/invalid-credentials",
    message: "Email or password is incorrect",
  },
  profileNotConfigured: {
    statusCode: StatusCodes.CONFLICT,
    type: "/auth/signin/profile-not-configured",
    message: "User profile is not configured",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/auth/signin/forbidden-role",
    message: "requested role is not allowed for this account",
  },
  userDisabled: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/auth/signin/user-disabled",
    message: "user is disabled",
  },
  storeNotConfigured: {
    statusCode: StatusCodes.CONFLICT,
    type: "/auth/signin/store-not-configured",
    message: "Store-scoped account is missing store configuration",
  },
};

const signinSchema = z.object({
  idToken: z.string().trim().min(1),
});

const LAST_LOGIN_UPDATE_THROTTLE_MS = 10 * 60 * 1000;

const shouldUpdateLastLoginAt = (lastLoginAt?: number) =>
  typeof lastLoginAt !== "number" || Date.now() - lastLoginAt >= LAST_LOGIN_UPDATE_THROTTLE_MS;

const updateLastLoginAtInBackground = (uid: string, lastLoginAt?: number) => {
  if (!shouldUpdateLastLoginAt(lastLoginAt)) {
    return;
  }

  void firestoreRepository.user.touchLastLoginAt(uid, Date.now()).catch((error: unknown) => {
    logger.warn(
      {
        event: "auth.last_login_update_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      "failed to update last login timestamp",
    );
  });
};

export const signin = async (req: Request, res: Response) => {
  const signinParseResult = signinSchema.safeParse(req.body);

  if (!signinParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: signinParseResult.error.flatten().fieldErrors,
    });
  }

  const timing = new ServerTiming();
  const startedAt = performance.now();
  const { idToken } = signinParseResult.data;

  const decodedFirebaseToken = await timing
    .measure("firebaseVerify", () => firebaseAuthRepository.auth.verifyIdToken(idToken))
    .catch(() => undefined);

  if (!decodedFirebaseToken?.uid) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidCredentials);
  }

  setRequestContextIdentity(decodedFirebaseToken.uid);

  const user = await timing
    .measure("userRead", () => firestoreRepository.user.getSigninUser(decodedFirebaseToken.uid))
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

  updateLastLoginAtInBackground(user.uid, user.lastLoginAt);
  // Protected store APIs authorize from Firebase custom claims. Complete the
  // claim write before responding so the client can force-refresh its ID token
  // once and immediately call those APIs without a login race.
  await timing.measure("claimsSync", () =>
    firebaseAuthRepository.auth.setCustomUserClaims(user.uid, claims),
  );

  timing.add("total", performance.now() - startedAt);
  res.setHeader("Server-Timing", timing.header());
  logger.info(
    {
      event: "auth.signin.timing",
      role: user.role,
      ...timing.toObject(),
    },
    "signin latency breakdown",
  );

  return res.status(StatusCodes.CREATED).json({
    user: {
      uid: user.uid,
      email: user.email,
      ownerId,
      role: user.role,
      storeId,
      name: getUserDisplayName(user),
    },
  });
};
