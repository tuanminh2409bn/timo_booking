import dotenv from "dotenv";
import {
  InvalidAuthorizedTokenError,
  NoAuthorizedHeader,
  TokenNotFoundInHeaderError,
} from "../constants/auth-header-error.js";
import { firebaseAuthRepository } from "../repository/firebase-auth/index.js";
import { setRequestContextIdentity } from "./request-context.js";

dotenv.config();

// Danh tính người gọi lấy từ Firebase ID token (custom claims role/ownerId/storeId app đã sync).
// Admin không có claims store-facing (buildFirestoreAuthClaims bỏ admin) nên không đi qua đây —
// admin-op verify riêng bằng verifyFirebaseAuthHeader + đọc role từ Firestore.
export type AuthorizedIdentity = {
  uid: string;
  role: "owner" | "manager" | "employee";
  ownerId: string;
  storeId?: string;
};

const getBearerToken = (authorizationHeader: string | undefined): string => {
  if (!authorizationHeader) throw new NoAuthorizedHeader();

  const [scheme, token] = authorizationHeader.trim().split(/\s+/);
  if (scheme !== "Bearer" || !token) throw new TokenNotFoundInHeaderError();

  return token;
};

export const verifyAuthorizationHeader = async (
  authorizationHeader: string | undefined,
): Promise<AuthorizedIdentity> => {
  const token = getBearerToken(authorizationHeader);

  let decodedToken: Awaited<ReturnType<typeof firebaseAuthRepository.auth.verifyIdToken>>;

  try {
    decodedToken = await firebaseAuthRepository.auth.verifyIdToken(token);
  } catch {
    throw new InvalidAuthorizedTokenError();
  }

  const roleClaim: unknown = decodedToken["role"];
  const ownerIdClaim: unknown = decodedToken["ownerId"];
  const storeIdClaim: unknown = decodedToken["storeId"];

  if (roleClaim !== "owner" && roleClaim !== "manager" && roleClaim !== "employee") {
    throw new InvalidAuthorizedTokenError();
  }

  const ownerId = typeof ownerIdClaim === "string" ? ownerIdClaim.trim() : "";

  if (!ownerId) {
    throw new InvalidAuthorizedTokenError();
  }

  setRequestContextIdentity(decodedToken.uid, roleClaim);

  const identity: AuthorizedIdentity = {
    uid: decodedToken.uid,
    role: roleClaim,
    ownerId,
  };

  if (typeof storeIdClaim === "string") {
    identity.storeId = storeIdClaim;
  }

  return identity;
};
