import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createErrorResponse } from "../../modules/create-error-response.js";

const SERVICE_ERRORS = {
  refreshDisabled: {
    statusCode: StatusCodes.GONE,
    type: "/auth/refresh-token/refresh-token-disabled",
    message: "Refresh token flow is disabled",
  },
};

export const refreshToken = async (_req: Request, res: Response) => {
  return createErrorResponse(res, SERVICE_ERRORS.refreshDisabled);
};
