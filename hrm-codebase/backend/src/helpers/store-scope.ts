import type { UserType } from "../repository/firestore/user/user.types.js";

export type StoreScoped = {
  storeId?: string | undefined;
};

export const getCanonicalStoreId = <T extends StoreScoped>(value: T): string | undefined =>
  value.storeId;

export const getCanonicalOwnerId = (
  user: Pick<UserType, "uid" | "role" | "ownerId">,
) => (user.role === "owner" ? user.uid : user.ownerId);
