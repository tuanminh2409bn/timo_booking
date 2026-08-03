import type { Request, Response } from "express";
import { firestoreRepository } from "../../repository/firestore/index.js";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../constants/firestore-error.js";
import { createErrorResponse } from "../../modules/create-error-response.js";
import { verifyFirebaseAuthHeader } from "../../modules/verify-firebase-auth-header.js";
import { getUserDisplayName } from "../../helpers/user-name.js";

const SERVICE_ERRORS = {
  profileNotConfigured: {
    statusCode: StatusCodes.CONFLICT,
    type: "/auth/admin-signin/profile-not-configured",
    message: "User profile is not configured",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/auth/admin-signin/forbidden-role",
    message: "not a platform admin",
  },
  userDisabled: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/auth/admin-signin/user-disabled",
    message: "user is disabled",
  },
};
export const adminSignin = async (req: Request, res: Response) => {
  const { uid } = await verifyFirebaseAuthHeader(req.headers["authorization"]);

  const verifiedUserFromDatabase = await firestoreRepository.user.getUser(uid).catch((error: unknown) => {
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

  if (verifiedUserFromDatabase.role !== "admin") {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, {
      role: verifiedUserFromDatabase.role,
    });
  }

  if (!verifiedUserFromDatabase.active) {
    return createErrorResponse(res, SERVICE_ERRORS.userDisabled, {
      role: verifiedUserFromDatabase.role,
    });
  }

  await firestoreRepository.user.updateUser(verifiedUserFromDatabase.uid, {
    lastLoginAt: Date.now(),
  });

  const ownerId = verifiedUserFromDatabase.ownerId || verifiedUserFromDatabase.uid;

  return res.status(StatusCodes.CREATED).json({
    user: {
      uid: verifiedUserFromDatabase.uid,
      email: verifiedUserFromDatabase.email,
      ownerId,
      role: verifiedUserFromDatabase.role,
      name: getUserDisplayName(verifiedUserFromDatabase),
    },
  });
};
