import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { isOwner, type AuthorizedAppContext } from "../../../helpers/role-access.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import type { StoreType } from "../../../repository/firestore/shop/shop.types.js";

type AttendanceStoreScope = {
  storeId: string;
  store?: StoreType;
};

type ResolveAttendanceStoreScopeOptions = {
  skipCache?: boolean;
};

export const resolveAttendanceStoreScope = async (
  authContext: AuthorizedAppContext,
  requestedStoreId?: string,
  options: ResolveAttendanceStoreScopeOptions = {},
): Promise<AttendanceStoreScope | undefined> => {
  if (!isOwner(authContext.role)) {
    if (!authContext.storeId) {
      return undefined;
    }

    const normalizedRequestedStoreId = requestedStoreId?.trim();

    if (!normalizedRequestedStoreId || normalizedRequestedStoreId === authContext.storeId) {
      return { storeId: authContext.storeId };
    }

    try {
      const store = await firestoreRepository.shop.store.getStore(
        authContext.ownerId,
        normalizedRequestedStoreId,
        options,
      );

      return store.id === authContext.storeId
        ? {
            storeId: authContext.storeId,
            store,
          }
        : undefined;
    } catch (error) {
      if (error instanceof FirestoreDataNotFoundError) {
        return undefined;
      }

      throw error;
    }
  }

  const normalizedRequestedStoreId = requestedStoreId?.trim();

  if (!normalizedRequestedStoreId) {
    return undefined;
  }

  try {
    const store = await firestoreRepository.shop.store.getStore(
      authContext.ownerId,
      normalizedRequestedStoreId,
      options,
    );

    return {
      storeId: store.id,
      store,
    };
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return undefined;
    }

    throw error;
  }
};
