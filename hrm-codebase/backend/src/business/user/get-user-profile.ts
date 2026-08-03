import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../constants/firestore-error.js";
import {
  createErrorResponse,
  type ErrorResponseBodyType,
} from "../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import {
  type UserProfileResponseType,
  toUserProfileResponse,
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

export const getUserProfile = async (
  req: Request,
  res: Response<UserProfileResponseType | ErrorResponseBodyType>,
) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const userIdParam = req.params["userId"];
  const requestedUserId =
    typeof userIdParam === "string" && userIdParam.trim() ? userIdParam.trim() : authContext.uid;

  if (!requestedUserId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest);
  }

  if (authContext.uid !== requestedUserId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenProfile, {
      actorUserId: authContext.uid,
      requestedUserId,
    });
  }

  let user;

  try {
    user = await firestoreRepository.user.getUser(requestedUserId);
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_ERRORS.userNotFound, { requestedUserId });
    }

    return createErrorResponse(res, SERVICE_ERRORS.internalError, {
      requestedUserId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  if (user.active === false) {
    return createErrorResponse(res, SERVICE_ERRORS.userDisabled, { requestedUserId });
  }

  return res.status(200).json({
    user: toUserProfileResponse(user),
  });
};
