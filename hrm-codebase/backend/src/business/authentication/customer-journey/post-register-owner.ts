import type { Request, Response } from "express";
import { z } from "zod";
import type { UserRecord } from "firebase-admin/auth";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { verifyFirebaseAuthHeader } from "../../../modules/verify-firebase-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { StatusCodes } from "http-status-codes";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { logger } from "../../../modules/logger.js";
import { firebaseAuthRepository } from "../../../repository/firebase-auth/index.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { addUtcCalendarMonths } from "../../../helpers/data-retention.js";
import { buildFirestoreAuthClaims } from "../../../helpers/firebase-auth-claims.js";
import type { UserType } from "../../../repository/firestore/user/user.types.js";

const SERVICE_ERRORS = {
  ownerRegistrationFailed: {
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    type: "/auth/register-owner/owner-registration-failed",
    message: "Failed to create owner account",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/auth/register-owner/forbidden-role",
    message: "not a platform admin",
  },
  authInvalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/auth/register-owner/invalid-request",
    message: "Invalid request",
  },
  emailAlreadyInUse: {
    statusCode: StatusCodes.CONFLICT,
    type: "/auth/register-owner/email-already-in-use",
    message: "Email is already in use",
  },
  firebaseUserCreationFailed: {
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    type: "/auth/register-owner/firebase-user-creation-failed",
    message: "Failed to create user in Firebase Authentication",
  },
};

const isFirebaseAuthError = (error: unknown): error is { code: string } =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof (error as { code?: unknown }).code === "string";

const registerOwnerSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(6),
});

type OwnerRegistrationActor = {
  uid?: string;
  role: UserType["role"] | "system";
};

const createOwnerAccount = async (
  req: Request,
  res: Response,
  actor: OwnerRegistrationActor,
  invalidRequestError: typeof SERVICE_ERRORS.authInvalidRequest,
) => {
  const registerOwnerParseResult = registerOwnerSchema.safeParse(req.body);

  if (!registerOwnerParseResult.success) {
    return createErrorResponse(res, invalidRequestError, {
      validation: registerOwnerParseResult.error.flatten().fieldErrors,
    });
  }

  let authProviderUser: UserRecord;
  const email = registerOwnerParseResult.data.email.trim().toLowerCase();
  const name = registerOwnerParseResult.data.name.trim();

  try {
    authProviderUser = await firebaseAuthRepository.auth.createUser({
      email,
      password: registerOwnerParseResult.data.password,
      displayName: name,
    });
  } catch (error) {
    if (isFirebaseAuthError(error) && error.code === "auth/email-already-exists") {
      return createErrorResponse(res, SERVICE_ERRORS.emailAlreadyInUse);
    }

    return createErrorResponse(res, SERVICE_ERRORS.firebaseUserCreationFailed);
  }

  try {
    // Canonical model: an owner's ownerId is their own uid (no separate shop entity).
    const ownerId = authProviderUser.uid;
    const claims = buildFirestoreAuthClaims({ ownerId, role: "owner" });

    if (!claims) {
      return createErrorResponse(res, SERVICE_ERRORS.ownerRegistrationFailed, {
        uid: authProviderUser.uid,
      });
    }

    await firebaseAuthRepository.auth.setCustomUserClaims(authProviderUser.uid, claims);

    const timestamp = Date.now();

    await firestoreRepository.user.insertUser({
      uid: authProviderUser.uid,
      email,
      ownerId,
      role: "owner",
      active: true,
      name,
      displayName: name,
      dataRetentionPlan: "standard",
      dataRetentionPlanChangedAt: timestamp,
      dataRetentionStandardEligibleAt: addUtcCalendarMonths(timestamp, 2),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await writeShopAuditLog({
      ownerId,
      eventType: "owner_registered",
      entityType: "owner",
      entityId: authProviderUser.uid,
      actor,
      metadata: {
        ownerUid: authProviderUser.uid,
      },
    });

    return res.status(StatusCodes.CREATED).json({ uid: authProviderUser.uid, email, ownerId });
  } catch (error) {
    logger.error(
      {
        event: "auth.owner_registration_failed",
        uid: authProviderUser.uid,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      "owner registration failed after Firebase user creation; rolling back",
    );

    await firebaseAuthRepository.auth
      .deleteUser(authProviderUser.uid)
      .catch((rollbackError: unknown) => {
        logger.warn(
          {
            event: "auth.owner_registration_rollback_failed",
            uid: authProviderUser.uid,
            errorMessage:
              rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          },
          "failed to delete orphaned Firebase user during rollback",
        );
      });

    return createErrorResponse(res, SERVICE_ERRORS.ownerRegistrationFailed, {
      uid: authProviderUser.uid,
    });
  }
};

// Public owner registration is intentionally separate from admin-created owners.
// The admin handler remains available for a future authenticated admin route.
export const registerOwner = async (req: Request, res: Response) => {
  return createOwnerAccount(req, res, { role: "system" }, SERVICE_ERRORS.authInvalidRequest);
};

export const registerOwnerByAdmin = async (req: Request, res: Response) => {
  const { uid } = await verifyFirebaseAuthHeader(req.headers["authorization"]);
  const actor = await firestoreRepository.user.getUser(uid).catch((error: unknown) => {
    if (error instanceof FirestoreDataNotFoundError) {
      return undefined;
    }

    throw error;
  });

  if (!actor || actor.role !== "admin") {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: actor?.role });
  }

  return createOwnerAccount(
    req,
    res,
    {
      uid,
      role: "admin",
    },
    SERVICE_ERRORS.authInvalidRequest,
  );
};
