import { applicationDefault, initializeApp, cert, getApps } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth, type DecodedIdToken, type UserRecord } from "firebase-admin/auth";
import { FirebaseCannotVerifyIdTokenError } from "../../constants/firebase-auth-error.js";
import type { FirestoreAuthClaims } from "../../helpers/firebase-auth-claims.js";
import dotenv from "dotenv";

dotenv.config();

const projectId = process.env["GCP_PROJECT_ID"];
const clientEmail = process.env["FIREBASE_CLIENT_EMAIL"];
const rawPrivateKey = process.env["FIREBASE_PRIVATE_KEY"]?.trim();

const stripWrappingQuotes = (value: string) =>
  value.length >= 2 &&
  ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;

const normalizePrivateKey = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }

  const strippedValue = stripWrappingQuotes(value.trim());

  if (strippedValue.startsWith("{")) {
    try {
      const serviceAccount = JSON.parse(strippedValue) as { private_key?: unknown };
      return normalizePrivateKey(
        typeof serviceAccount.private_key === "string" ? serviceAccount.private_key : undefined,
      );
    } catch {
      return undefined;
    }
  }

  const normalizedValue = strippedValue.replace(/\\n/g, "\n").trim();

  if (normalizedValue.includes("BEGIN PRIVATE KEY")) {
    return normalizedValue;
  }

  try {
    const decodedValue = Buffer.from(normalizedValue, "base64").toString("utf8").trim();

    return decodedValue.includes("BEGIN PRIVATE KEY") ? decodedValue : undefined;
  } catch {
    return undefined;
  }
};

const resolveServiceAccountClientEmail = () => {
  if (clientEmail !== undefined) {
    return clientEmail;
  }

  if (!rawPrivateKey?.startsWith("{")) {
    return undefined;
  }

  try {
    const serviceAccount = JSON.parse(rawPrivateKey) as { client_email?: unknown };
    return typeof serviceAccount.client_email === "string" ? serviceAccount.client_email : undefined;
  } catch {
    return undefined;
  }
};

const privateKey = normalizePrivateKey(rawPrivateKey);

if (!projectId) {
  throw new Error("Missing Firebase Admin project ID");
}

const resolveFirebaseAdminCredential = () => {
  const serviceAccountClientEmail = resolveServiceAccountClientEmail();

  if (serviceAccountClientEmail !== undefined && privateKey !== undefined) {
    return cert({
      projectId,
      clientEmail: serviceAccountClientEmail,
      privateKey,
    });
  }

  return applicationDefault();
};

export const firebaseAdminApp =
  getApps()[0] ??
  initializeApp({
    projectId,
    credential: resolveFirebaseAdminCredential(),
  });

const verifyIdTokenFactory = (app: typeof firebaseAdminApp) => {
  return async (idToken: string): Promise<DecodedIdToken> => {
    const decodedToken = await getAuth(app).verifyIdToken(idToken);

    if (!decodedToken) {
      throw new FirebaseCannotVerifyIdTokenError();
    }

    return decodedToken;
  };
};

const createCustomTokenFactory = (app: typeof firebaseAdminApp) => {
  return async (uid: string, claims: FirestoreAuthClaims): Promise<string> => {
    return getAuth(app).createCustomToken(uid, claims);
  };
};

const setCustomUserClaimsFactory = (app: typeof firebaseAdminApp) => {
  return async (uid: string, claims: FirestoreAuthClaims | null): Promise<void> => {
    await getAuth(app).setCustomUserClaims(uid, claims);
  };
};

const createUserFactory = (app: typeof firebaseAdminApp) => {
  return async (
    user: { email: string; password: string; displayName?: string; disabled?: boolean },
  ): Promise<UserRecord> => {
    const userRecord = await getAuth(app).createUser({
      email: user.email,
      password: user.password,
      ...(user.displayName !== undefined && { displayName: user.displayName }),
      ...(user.disabled !== undefined && { disabled: user.disabled }),
    });

    return userRecord;
  };
};

const getUserByEmailFactory = (app: typeof firebaseAdminApp) => {
  return async (email: string): Promise<UserRecord> => {
    return getAuth(app).getUserByEmail(email.trim().toLowerCase());
  };
};

const getUserFactory = (app: typeof firebaseAdminApp) => {
  return async (uid: string): Promise<UserRecord> => {
    return getAuth(app).getUser(uid);
  };
};

const updateUserPasswordFactory = (app: typeof firebaseAdminApp) => {
  return async (uid: string, password: string): Promise<UserRecord> => {
    return getAuth(app).updateUser(uid, { password });
  };
};

const updateUserProfileFactory = (app: typeof firebaseAdminApp) => {
  return async (
    uid: string,
    data: { displayName?: string; disabled?: boolean; photoURL?: string },
  ): Promise<UserRecord> => {
    return getAuth(app).updateUser(uid, {
      ...(data.displayName !== undefined && { displayName: data.displayName }),
      ...(data.disabled !== undefined && { disabled: data.disabled }),
      ...(data.photoURL !== undefined && { photoURL: data.photoURL }),
    });
  };
};

const revokeRefreshTokensFactory = (app: typeof firebaseAdminApp) => {
  return async (uid: string): Promise<void> => {
    await getAuth(app).revokeRefreshTokens(uid);
  };
};

const deleteUserFactory = (app: typeof firebaseAdminApp) => {
  return async (uid: string): Promise<void> => {
    await getAuth(app).deleteUser(uid);
  };
};

const verifyAppCheckTokenFactory = (app: typeof firebaseAdminApp) => {
  return async (token: string): Promise<void> => {
    await getAppCheck(app).verifyToken(token);
  };
};

export const firebaseAuthRepository = {
  auth: {
    verifyIdToken: verifyIdTokenFactory(firebaseAdminApp),
    createCustomToken: createCustomTokenFactory(firebaseAdminApp),
    setCustomUserClaims: setCustomUserClaimsFactory(firebaseAdminApp),
    createUser: createUserFactory(firebaseAdminApp),
    getUser: getUserFactory(firebaseAdminApp),
    getUserByEmail: getUserByEmailFactory(firebaseAdminApp),
    updateUserPassword: updateUserPasswordFactory(firebaseAdminApp),
    updateUserProfile: updateUserProfileFactory(firebaseAdminApp),
    revokeRefreshTokens: revokeRefreshTokensFactory(firebaseAdminApp),
    deleteUser: deleteUserFactory(firebaseAdminApp),
  },
  appCheck: {
    verifyToken: verifyAppCheckTokenFactory(firebaseAdminApp),
  },
};
