import jwt from "jsonwebtoken";

// Token đặt lại mật khẩu: tạo ở endpoint verify-otp, tiêu thụ ở endpoint reset-password.
// audience/issuer/secret phải khớp giữa create và verify nên gom chung một chỗ.
type PasswordResetTokenPayload = {
  uid: string;
  email: string;
  purpose: "password_reset";
};

const PASSWORD_RESET_TOKEN_AUDIENCE = "nail-password-reset";
const PASSWORD_RESET_TOKEN_ISSUER = process.env["AUTH_JWT_ISSUER"] ?? "nail-api";

const getJwtSecret = () => {
  const secret = process.env["JWT_SECRET"];

  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }

  return secret;
};

export const createPasswordResetToken = (payload: Omit<PasswordResetTokenPayload, "purpose">) =>
  jwt.sign(
    {
      uid: payload.uid,
      email: payload.email,
      purpose: "password_reset",
    },
    getJwtSecret(),
    {
      audience: PASSWORD_RESET_TOKEN_AUDIENCE,
      expiresIn: "15m",
      issuer: PASSWORD_RESET_TOKEN_ISSUER,
    },
  );

export const verifyPasswordResetToken = (resetToken: string): PasswordResetTokenPayload => {
  const payload = jwt.verify(resetToken, getJwtSecret(), {
    audience: PASSWORD_RESET_TOKEN_AUDIENCE,
    issuer: PASSWORD_RESET_TOKEN_ISSUER,
  });

  if (
    typeof payload === "string" ||
    typeof payload["uid"] !== "string" ||
    payload["uid"].trim().length === 0 ||
    typeof payload["email"] !== "string" ||
    payload["email"].trim().length === 0 ||
    payload["purpose"] !== "password_reset"
  ) {
    throw new jwt.JsonWebTokenError("Invalid password reset token payload");
  }

  return {
    uid: payload["uid"].trim(),
    email: payload["email"].trim().toLowerCase(),
    purpose: "password_reset",
  };
};
