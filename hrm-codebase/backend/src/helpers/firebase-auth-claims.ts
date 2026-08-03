import { getCanonicalStoreId } from "./store-scope.js";
import type { UserType } from "../repository/firestore/user/user.types.js";

export type FirestoreAuthClaims = {
  role: "owner" | "manager" | "employee";
  ownerId: string;
  storeId?: string;
};

export const buildFirestoreAuthClaims = (user: {
  role: UserType["role"];
  ownerId: string;
  storeId?: string | undefined;
}): FirestoreAuthClaims | undefined => {
  if (user.role !== "owner" && user.role !== "manager" && user.role !== "employee") {
    return undefined;
  }

  const ownerId = user.ownerId?.trim();

  if (!ownerId) {
    return undefined;
  }

  const storeId = getCanonicalStoreId(user);
  const claims: FirestoreAuthClaims = {
    role: user.role,
    ownerId,
  };

  if (storeId !== undefined) {
    claims.storeId = storeId;
  }

  return claims;
};
