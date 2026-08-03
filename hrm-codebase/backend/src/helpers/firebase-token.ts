// Decode payload của Firebase ID token KHÔNG verify chữ ký — chỉ dùng cho fingerprint/scope ở
// middleware (rate-limit, idempotency), nơi cần identity rẻ+đồng bộ. KHÔNG dùng cho authz;
// handler vẫn verify thật qua verifyAuthorizationHeader (verifyIdToken).
export const decodeFirebaseIdTokenUnverified = (
  token: string,
): { uid?: string; ownerId?: string } => {
  const parts = token.split(".");

  if (parts.length < 2 || !parts[1]) {
    return {};
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const result: { uid?: string; ownerId?: string } = {};

    if (typeof payload["user_id"] === "string") {
      result.uid = payload["user_id"];
    } else if (typeof payload["sub"] === "string") {
      result.uid = payload["sub"];
    }

    if (typeof payload["ownerId"] === "string") {
      result.ownerId = payload["ownerId"];
    }

    return result;
  } catch {
    return {};
  }
};
