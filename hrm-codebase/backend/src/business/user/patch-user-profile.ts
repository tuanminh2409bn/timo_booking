import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../constants/firestore-error.js";
import {
  createErrorResponse,
  type ErrorResponseBodyType,
} from "../../modules/create-error-response.js";
import { logger } from "../../modules/logger.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firebaseAuthRepository } from "../../repository/firebase-auth/index.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import type { UserGender } from "../../repository/firestore/user/user.types.js";
import {
  type UserProfileResponseType,
  toUserProfileResponse,
  updateUserProfileSchema,
} from "./user-profile-shared.js";

const SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/users/profile/invalid-request",
    message: "Invalid request",
  },
  forbiddenProfile: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/users/profile/forbidden-profile",
    message: "Forbidden: user profile mismatch",
  },
  userNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/users/profile/user-not-found",
    message: "User not found",
  },
  userDisabled: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/users/profile/user-disabled",
    message: "user is disabled",
  },
  internalError: {
    statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
    type: "/users/profile/internal-error",
    message: "Internal Server Error",
  },
};

export const updateUserProfile = async (
  req: Request,
  res: Response<UserProfileResponseType | ErrorResponseBodyType>,
) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const userIdParam = req.params["userId"];
  const requestedUserId =
    typeof userIdParam === "string" && userIdParam.trim() ? userIdParam.trim() : authContext.uid;
  const updateUserProfileParseResult = updateUserProfileSchema.safeParse(req.body);

  if (authContext.uid !== requestedUserId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenProfile, {
      actorUserId: authContext.uid,
      requestedUserId,
    });
  }

  if (!updateUserProfileParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      requestedUserId,
      issueCount: updateUserProfileParseResult.error.issues.length,
    });
  }

  let currentUser;

  try {
    currentUser = await firestoreRepository.user.getUser(requestedUserId);
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_ERRORS.userNotFound, { requestedUserId });
    }

    return createErrorResponse(res, SERVICE_ERRORS.internalError, {
      requestedUserId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  if (!currentUser.active) {
    return createErrorResponse(res, SERVICE_ERRORS.userDisabled, { requestedUserId });
  }

  const nextDisplayName =
    updateUserProfileParseResult.data.displayName ?? updateUserProfileParseResult.data.name ?? currentUser.displayName;
  const timestamp = Date.now();

  const userUpdate: {
    updatedAt: number;
    updatedByUserId: string;
    name?: string | undefined;
    displayName?: string | undefined;
    phone?: string | undefined;
    gender?: UserGender | undefined;
  } = {
    updatedAt: timestamp,
    updatedByUserId: authContext.uid,
  };

  if (updateUserProfileParseResult.data.name !== undefined) {
    userUpdate.name = updateUserProfileParseResult.data.name;
    userUpdate.displayName = updateUserProfileParseResult.data.name;
  }

  if (updateUserProfileParseResult.data.displayName !== undefined) {
    userUpdate.displayName = updateUserProfileParseResult.data.displayName;
  }

  // SĐT chỉ owner mới có — manager/employee gửi phone thì bỏ qua.
  if (updateUserProfileParseResult.data.phone !== undefined && currentUser.role === "owner") {
    userUpdate.phone = updateUserProfileParseResult.data.phone;
  }

  if (updateUserProfileParseResult.data.gender !== undefined) {
    userUpdate.gender = updateUserProfileParseResult.data.gender;
  }

  await firestoreRepository.user.updateUser(requestedUserId, userUpdate);

  if (nextDisplayName !== undefined) {
    await firebaseAuthRepository.auth.updateUserProfile(requestedUserId, {
      displayName: nextDisplayName,
    });
  }

  const updatedUser = await firestoreRepository.user.getUser(requestedUserId);
  logger.info(
    { event: "user.profile.updated", requestedUserId, actorUserId: authContext.uid },
    "user profile updated",
  );

  return res.status(StatusCodes.OK).json({
    user: toUserProfileResponse(updatedUser),
  });
};
