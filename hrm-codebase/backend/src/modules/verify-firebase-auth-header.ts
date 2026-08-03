import dotenv from "dotenv";
import {
  InvalidAuthorizedTokenError,
  NoAuthorizedHeader,
  TokenNotFoundInHeaderError,
} from "../constants/auth-header-error.js";
import { firebaseAuthRepository } from "../repository/firebase-auth/index.js";
import { setRequestContextIdentity } from "./request-context.js";

dotenv.config();

type FirebaseTokenType = {
  uid: string;
  authTime?: number;
};

type DecodedFirebaseToken = Awaited<
  ReturnType<typeof firebaseAuthRepository.auth.verifyIdToken>
>;

export const verifyFirebaseAuthHeader = async (
  authorizationHeader: string | undefined,
): Promise<FirebaseTokenType> => {
  if (!authorizationHeader) throw new NoAuthorizedHeader();

  const [scheme, token] = authorizationHeader.trim().split(/\s+/);
  if (scheme !== "Bearer" || !token) throw new TokenNotFoundInHeaderError();

  let decodedFirebaseToken: DecodedFirebaseToken;

  try {
    decodedFirebaseToken = await firebaseAuthRepository.auth.verifyIdToken(token);
  } catch {
    throw new InvalidAuthorizedTokenError();
  }

  setRequestContextIdentity(decodedFirebaseToken.uid);

  return {
    uid: decodedFirebaseToken.uid,
    ...(typeof decodedFirebaseToken.auth_time === "number" && {
      authTime: decodedFirebaseToken.auth_time,
    }),
  };
};
