import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

// Firebase-only: không còn phiên server để thu hồi. Client tự `signOut()` phía Firebase; khi đổi
// mật khẩu / khoá tài khoản thì `revokeRefreshTokens` lo (hiệu lực ≤1h). Giữ endpoint cho FE gọi.
export const logout = async (_req: Request, res: Response) => {
  return res.status(StatusCodes.OK).json({
    success: true,
  });
};
