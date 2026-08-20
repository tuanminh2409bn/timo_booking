import {
  DB_NOT_FOUND,
  FirestoreDataExistingError,
  FirestoreDataNotFoundError,
} from "../../../constants/firestore-error.js";
import {
  cacheDelete,
  cacheDeleteByPrefix,
  cacheGetJson,
  cacheSetJson,
  runSingleFlight,
} from "../../cache/cache-client.js";
import { logger } from "../../../modules/logger.js";
import { EMPLOYEE_ROLE_VALUES } from "../../../helpers/user-roles.js";
import {
  AdminUserType,
  BaseUserType,
  EmployeeCompensationModel,
  EmployeeStatus,
  EmployeeWeeklyWorkingHours,
  OwnerUserType,
  OwnerDataRetentionPlan,
  StoreScopedUserFields,
  StoreScopedUserType,
  UserGender,
  USER_ROLE,
  UserRole,
  UserType,
} from "./user.types.js";
import { FieldValue, Firestore, Query, QueryDocumentSnapshot } from "@google-cloud/firestore";

const ACTIVE_SHOP_EMPLOYEES_CACHE_TTL_MS = 60_000;
const getActiveStoreEmployeeCacheKey = (ownerId: string) => `store:${ownerId}:employee:active`;
const SHOP_EMPLOYEE_LIST_CACHE_TTL_MS = 60_000;
const SIGNIN_USER_CACHE_TTL_MS = Math.min(
  Math.max(Number(process.env["AUTH_SIGNIN_USER_CACHE_TTL_MS"] ?? 300_000), 5_000),
  300_000,
);
export const getSigninUserCacheKey = (uid: string) => `auth:signin-user:${uid}`;
type ListShopEmployeesOptions = {
  storeId?: string;
  active?: boolean;
  skipCache?: boolean;
};
export type UserUpdateInput = Partial<BaseUserType> &
  Partial<StoreScopedUserFields> & {
    role?: UserRole;
    bankAccount?: string;
    dataRetentionPlan?: OwnerDataRetentionPlan;
    dataRetentionPlanChangedAt?: number;
    dataRetentionStandardEligibleAt?: number | undefined;
    serviceIds?: string[] | undefined;
  };
const getShopEmployeeListCachePrefix = (ownerId: string) => `store:${ownerId}:employee:list`;
const resolveActiveCacheSegment = (active: boolean | undefined) => {
  if (active === undefined) {
    return "all";
  }

  return active ? "active" : "inactive";
};
const getShopEmployeeListCacheKey = (ownerId: string, options: ListShopEmployeesOptions = {}) =>
  [
    getShopEmployeeListCachePrefix(ownerId),
    options.storeId ?? "all",
    resolveActiveCacheSegment(options.active),
  ].join(":");
const EMPLOYEE_CACHE_INVALIDATION_FIELDS = new Set([
  "ownerId",
  "role",
  "active",
  "storeId",
  "workerType",
  "name",
  "displayName",
  "gender",
  "compensationModel",
  "ownerCommissionRate",
  "fixedSalary",
  "hourlyRate",
  "weeklyWorkingHours",
  "serviceIds",
  "publicBookingVisible",
]);

const invalidateEmployeeCaches = async (ownerId: string) => {
  await Promise.all([
    cacheDelete(getActiveStoreEmployeeCacheKey(ownerId)),
    cacheDeleteByPrefix(getShopEmployeeListCachePrefix(ownerId)),
  ]);
};

const isRecognizedUserRole = (role: unknown): role is UserRole =>
  role === USER_ROLE.ADMIN ||
  role === USER_ROLE.OWNER ||
  role === USER_ROLE.MANAGER ||
  role === USER_ROLE.EMPLOYEE;

// Đọc dữ liệu thô từ Firestore (không schema) rồi dựng đúng nhánh UserType theo role.
// Field bắt buộc theo role được check ở đây; field optional được cast trực tiếp,
// giữ đúng mức độ kiểm tra như code cũ (không thêm validate sâu hơn).
const parseUserDocument = (uid: string, rawData: unknown): UserType | undefined => {
  if (typeof rawData !== "object" || rawData === null) {
    return undefined;
  }

  const data = rawData as Record<string, unknown>;

  if (typeof data["email"] !== "string") {
    return undefined;
  }

  if (typeof data["ownerId"] !== "string") {
    return undefined;
  }

  if (typeof data["active"] !== "boolean") {
    return undefined;
  }

  if (!isRecognizedUserRole(data["role"])) {
    return undefined;
  }

  const email = data["email"];
  const ownerId = data["ownerId"];
  const active = data["active"];
  const name = data["name"] as string | undefined;
  const displayName = data["displayName"] as string | undefined;
  const lastLoginAt = data["lastLoginAt"] as number | undefined;
  const passwordUpdatedAt = data["passwordUpdatedAt"] as number | undefined;
  const accountDeletionRequestedAt = data["accountDeletionRequestedAt"] as number | undefined;
  const accountDeletionRequestedByUserId = data["accountDeletionRequestedByUserId"] as
    | string
    | undefined;
  const accountDeletionRequestedByRole = data["accountDeletionRequestedByRole"] as
    | UserRole
    | undefined;
  const createdAt = data["createdAt"] as number | undefined;
  const updatedAt = data["updatedAt"] as number | undefined;
  const createdByUserId = data["createdByUserId"] as string | undefined;
  const updatedByUserId = data["updatedByUserId"] as string | undefined;

  if (data["role"] === USER_ROLE.ADMIN) {
    const admin: AdminUserType = {
      uid,
      email,
      ownerId,
      active,
      name,
      displayName,
      lastLoginAt,
      passwordUpdatedAt,
      accountDeletionRequestedAt,
      accountDeletionRequestedByUserId,
      accountDeletionRequestedByRole,
      createdAt,
      updatedAt,
      createdByUserId,
      updatedByUserId,
      role: USER_ROLE.ADMIN,
    };

    return admin;
  }

  if (data["role"] === USER_ROLE.OWNER) {
    const owner: OwnerUserType = {
      uid,
      email,
      ownerId,
      active,
      name,
      displayName,
      lastLoginAt,
      passwordUpdatedAt,
      accountDeletionRequestedAt,
      accountDeletionRequestedByUserId,
      accountDeletionRequestedByRole,
      createdAt,
      updatedAt,
      createdByUserId,
      updatedByUserId,
      role: USER_ROLE.OWNER,
      phone: data["phone"] as string | undefined,
      gender: data["gender"] as UserGender | undefined,
      bankAccount: data["bankAccount"] as string | undefined,
      dataRetentionPlan: data["dataRetentionPlan"] as OwnerDataRetentionPlan | undefined,
      dataRetentionPlanChangedAt: data["dataRetentionPlanChangedAt"] as number | undefined,
      dataRetentionStandardEligibleAt: data["dataRetentionStandardEligibleAt"] as
        | number
        | undefined,
    };

    return owner;
  }

  if (typeof data["storeId"] !== "string") {
    return undefined;
  }

  const storeScopedUser: StoreScopedUserType = {
    uid,
    email,
    ownerId,
    active,
    name,
    displayName,
    lastLoginAt,
    passwordUpdatedAt,
    accountDeletionRequestedAt,
    accountDeletionRequestedByUserId,
    accountDeletionRequestedByRole,
    createdAt,
    updatedAt,
    createdByUserId,
    updatedByUserId,
    role: data["role"],
    storeId: data["storeId"],
    workerType: data["workerType"] as "main" | "assistant" | undefined,
    position: data["position"] as string | undefined,
    gender: data["gender"] as UserGender | undefined,
    employeeStatus: data["employeeStatus"] as EmployeeStatus | undefined,
    compensationModel: data["compensationModel"] as EmployeeCompensationModel | undefined,
    ownerCommissionRate: data["ownerCommissionRate"] as number | undefined,
    fixedSalary: data["fixedSalary"] as number | undefined,
    hourlyRate: data["hourlyRate"] as number | undefined,
    weeklyWorkingHours: data["weeklyWorkingHours"] as EmployeeWeeklyWorkingHours | undefined,
    serviceIds: data["serviceIds"] as string[] | undefined,
    publicBookingVisible: data["publicBookingVisible"] as boolean | undefined,
  };

  return storeScopedUser;
};

const resolveUserDocumentReference = async (firestoreDB: Firestore, uid: string) => {
  const userCollection = firestoreDB.collection("users");
  const directDocument = await userCollection.doc(uid).get();

  if (!directDocument.exists) {
    return undefined;
  }

  const user = parseUserDocument(uid, directDocument.data());

  if (!user) {
    return undefined;
  }

  return {
    ref: directDocument.ref,
    data: user,
  };
};

const mapUserDocument = (doc: QueryDocumentSnapshot): UserType => {
  const user = parseUserDocument(doc.id, doc.data());

  if (!user) {
    throw new TypeError(`Invalid user document: ${doc.ref.path}`);
  }

  return user;
};

export type ShopEmployeePresentationItem = Pick<
  StoreScopedUserType,
  | "uid"
  | "email"
  | "role"
  | "active"
  | "ownerId"
  | "storeId"
  | "workerType"
  | "compensationModel"
  | "ownerCommissionRate"
  | "fixedSalary"
  | "hourlyRate"
  | "weeklyWorkingHours"
  | "serviceIds"
  | "publicBookingVisible"
> & {
  name: string;
  label: string;
};

export type ShopEmployeeListItem = Pick<
  StoreScopedUserType,
  | "uid"
  | "email"
  | "ownerId"
  | "role"
  | "active"
  | "storeId"
  | "workerType"
  | "name"
  | "displayName"
  | "position"
  | "gender"
  | "compensationModel"
  | "ownerCommissionRate"
  | "fixedSalary"
  | "hourlyRate"
  | "weeklyWorkingHours"
  | "serviceIds"
  | "publicBookingVisible"
  | "lastLoginAt"
  | "createdAt"
  | "updatedAt"
>;

// Không Pick từ UserType vì storeId chỉ tồn tại ở manager/employee — signin phải phục vụ cả 4 role.
export type SigninUserRecord = {
  uid: string;
  email: string;
  ownerId: string;
  role: UserRole;
  active: boolean;
  storeId?: string | undefined;
  name?: string | undefined;
  displayName?: string | undefined;
  lastLoginAt?: number | undefined;
};

export const insertUserFactory = (firestoreDB: Firestore) => {
  return async (user: UserType): Promise<UserType> => {
    const userCollection = firestoreDB.collection("users");
    const userDocument = userCollection.doc(user.uid);

    try {
      await userDocument.create(user);
      if (user.ownerId) {
        await invalidateEmployeeCaches(user.ownerId);
      }

      return user;
    } catch (error) {
      const isAlreadyExistsError =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: number }).code === 6;

      if (isAlreadyExistsError) {
        throw new FirestoreDataExistingError();
      }

      throw error;
    }
  };
};

export const getUserFactory = (firestoreDB: Firestore) => {
  return async (uid: string): Promise<UserType> => {
    const resolvedUserDocument = await resolveUserDocumentReference(firestoreDB, uid);

    if (!resolvedUserDocument) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.user);
    }

    return resolvedUserDocument.data;
  };
};

export const getUserByEmailFactory = (firestoreDB: Firestore) => {
  return async (email: string): Promise<UserType> => {
    const normalizedEmail = email.trim().toLowerCase();
    const userSnapshot = await firestoreDB
      .collection("users")
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();

    const userDocument = userSnapshot.docs[0];

    if (!userDocument) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.user);
    }

    return mapUserDocument(userDocument);
  };
};

export const isUserExistingFactory = (firestoreDB: Firestore) => {
  return async (email: string): Promise<boolean> => {
    const normalizedEmail = email.trim().toLowerCase();
    const userCollection = firestoreDB.collection("users");
    const userSnapshot = await userCollection.where("email", "==", normalizedEmail).limit(1).get();

    return !userSnapshot.empty;
  };
};

export const isUserCorrectRoleFactory = (firestoreDB: Firestore) => {
  return async (uid: string, role: UserType["role"]): Promise<boolean> => {
    const resolvedUserDocument = await resolveUserDocumentReference(firestoreDB, uid);

    if (resolvedUserDocument) {
      return resolvedUserDocument.data.role === role;
    }

    const userSnapshot = await firestoreDB
      .collection("users")
      .where("uid", "==", uid)
      .where("role", "==", role)
      .limit(1)
      .get();

    return !userSnapshot.empty;
  };
};

export const updateUserFactory = (firestoreDB: Firestore) => {
  return async (uid: string, userData: UserUpdateInput): Promise<void> => {
    const resolvedUserDocument = await resolveUserDocumentReference(firestoreDB, uid);

    if (!resolvedUserDocument) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.user);
    }

    try {
      const firestorePatch: Record<string, unknown> = { ...userData };

      if ("serviceIds" in userData && userData.serviceIds === undefined) {
        firestorePatch["serviceIds"] = FieldValue.delete();
      }

      if (
        "dataRetentionStandardEligibleAt" in userData &&
        userData.dataRetentionStandardEligibleAt === undefined
      ) {
        firestorePatch["dataRetentionStandardEligibleAt"] = FieldValue.delete();
      }

      await resolvedUserDocument.ref.set(firestorePatch, { merge: true });
      await cacheDelete(getSigninUserCacheKey(uid));

      const resolvedOwnerId =
        (typeof userData.ownerId === "string" && userData.ownerId) ||
        resolvedUserDocument.data.ownerId;

      if (resolvedOwnerId) {
        const updatedFieldNames = Object.keys(userData);
        const shouldInvalidateEmployeeCaches = updatedFieldNames.some((fieldName) =>
          EMPLOYEE_CACHE_INVALIDATION_FIELDS.has(fieldName),
        );

        if (shouldInvalidateEmployeeCaches) {
          await invalidateEmployeeCaches(resolvedOwnerId);
        }
      }
    } catch (error) {
      const isNotFoundError =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: number }).code === 5;

      if (isNotFoundError) {
        throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.user);
      }

      throw error;
    }
  };
};

export const touchUserLastLoginAtFactory = (firestoreDB: Firestore) => {
  return async (uid: string, lastLoginAt: number): Promise<void> => {
    await firestoreDB.collection("users").doc(uid).update({ lastLoginAt });

    const cacheKey = getSigninUserCacheKey(uid);
    const cachedUser = await cacheGetJson<SigninUserRecord>(cacheKey);

    if (cachedUser) {
      await cacheSetJson(cacheKey, { ...cachedUser, lastLoginAt }, SIGNIN_USER_CACHE_TTL_MS);
    }
  };
};

const resolveEmployeeName = (user: StoreScopedUserType): string => {
  const trimmedName = user.name?.trim();

  if (trimmedName) {
    return trimmedName;
  }

  const trimmedDisplayName = user.displayName?.trim();

  if (trimmedDisplayName) {
    return trimmedDisplayName;
  }

  const emailLocalPart = user.email.split("@")[0];

  if (emailLocalPart) {
    return emailLocalPart;
  }

  return user.uid;
};

const resolveEmployeeLabel = (user: StoreScopedUserType): string => {
  const trimmedName = user.name?.trim();

  if (trimmedName) {
    return trimmedName;
  }

  const trimmedDisplayName = user.displayName?.trim();

  if (trimmedDisplayName) {
    return trimmedDisplayName;
  }

  return user.email;
};

export const listActiveShopEmployeesFactory = (firestoreDB: Firestore) => {
  return async (ownerId: string): Promise<ShopEmployeePresentationItem[]> => {
    const cachedEmployees = await cacheGetJson<ShopEmployeePresentationItem[]>(
      getActiveStoreEmployeeCacheKey(ownerId),
    );

    if (cachedEmployees) {
      return cachedEmployees;
    }

    const userSnapshot = await firestoreDB
      .collection("users")
      .where("ownerId", "==", ownerId)
      .where("active", "==", true)
      .where("role", "in", [...EMPLOYEE_ROLE_VALUES])
      .limit(100)
      .get();

    const employees = userSnapshot.docs
      .map(mapUserDocument)
      .filter((user): user is StoreScopedUserType => user.active && user.role === "employee")
      .map((user) => {
        let compensationModel = user.compensationModel;

        if (compensationModel === undefined) {
          if (user.hourlyRate !== undefined) {
            compensationModel = "hourly";
          } else {
            compensationModel = "commission";
          }
        }

        let ownerCommissionRate: number | undefined;

        if (compensationModel === "commission") {
          ownerCommissionRate = user.ownerCommissionRate;

          if (ownerCommissionRate === undefined) {
            ownerCommissionRate = 50;
          }
        }

        const presentationItem: ShopEmployeePresentationItem = {
          uid: user.uid,
          email: user.email,
          role: user.role,
          active: user.active,
          ownerId: user.ownerId,
          storeId: user.storeId,
          compensationModel,
          ownerCommissionRate,
          fixedSalary: user.fixedSalary,
          hourlyRate: user.hourlyRate,
          weeklyWorkingHours: user.weeklyWorkingHours,
          serviceIds: user.serviceIds,
          name: resolveEmployeeName(user),
          label: resolveEmployeeLabel(user),
        };

        return presentationItem;
      })
      .sort((left, right) => left.name.localeCompare(right.name, "vi"));

    await cacheSetJson(
      getActiveStoreEmployeeCacheKey(ownerId),
      employees,
      ACTIVE_SHOP_EMPLOYEES_CACHE_TTL_MS,
    );

    return employees;
  };
};

export const listShopEmployeesFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    options: ListShopEmployeesOptions = {},
  ): Promise<ShopEmployeeListItem[]> => {
    if (options.skipCache !== true) {
      const cachedEmployees = await cacheGetJson<ShopEmployeeListItem[]>(
        getShopEmployeeListCacheKey(ownerId, options),
      );

      if (cachedEmployees) {
        return cachedEmployees;
      }
    }

    let employeeQuery: Query = firestoreDB
      .collection("users")
      .where("ownerId", "==", ownerId)
      .where("role", "==", "employee");

    if (options.storeId !== undefined) {
      employeeQuery = employeeQuery.where("storeId", "==", options.storeId);
    }

    if (options.active !== undefined) {
      employeeQuery = employeeQuery.where("active", "==", options.active);
    }

    const userSnapshot = await employeeQuery
      .select(
        "uid",
        "email",
        "ownerId",
        "role",
        "active",
        "storeId",
        "name",
        "displayName",
        "position",
        "gender",
        "workerType",
        "compensationModel",
        "ownerCommissionRate",
        "fixedSalary",
        "hourlyRate",
        "weeklyWorkingHours",
        "serviceIds",
        "publicBookingVisible",
        "lastLoginAt",
        "createdAt",
        "updatedAt",
      )
      .limit(100)
      .get();

    const employees = userSnapshot.docs
      .map(mapUserDocument)
      .filter((user): user is StoreScopedUserType => user.role === "employee")
      .sort((left, right) => {
        const leftName = left.name?.trim() || left.displayName?.trim() || left.email;
        const rightName = right.name?.trim() || right.displayName?.trim() || right.email;
        return leftName.localeCompare(rightName, "vi");
      });

    if (options.skipCache !== true) {
      await cacheSetJson(
        getShopEmployeeListCacheKey(ownerId, options),
        employees,
        SHOP_EMPLOYEE_LIST_CACHE_TTL_MS,
      );
    }

    return employees;
  };
};

export const countShopEmployeesFactory = (firestoreDB: Firestore) => {
  return async (ownerId: string, options: ListShopEmployeesOptions = {}): Promise<number> => {
    let employeeQuery: Query = firestoreDB
      .collection("users")
      .where("ownerId", "==", ownerId)
      .where("role", "==", "employee");

    if (options.storeId !== undefined) {
      employeeQuery = employeeQuery.where("storeId", "==", options.storeId);
    }

    if (options.active !== undefined) {
      employeeQuery = employeeQuery.where("active", "==", options.active);
    }

    const snapshot = await employeeQuery.count().get();

    return snapshot.data().count;
  };
};

export const getSigninUserFactory = (firestoreDB: Firestore) => {
  return async (uid: string): Promise<SigninUserRecord> => {
    const cacheKey = getSigninUserCacheKey(uid);
    const cachedUser = await cacheGetJson<SigninUserRecord>(cacheKey);

    if (cachedUser) {
      logger.info({ event: "auth.signin_user_cache", cacheHit: true }, "signin user cache hit");
      return cachedUser;
    }

    logger.info({ event: "auth.signin_user_cache", cacheHit: false }, "signin user cache miss");

    return runSingleFlight(cacheKey, async () => {
      const userDocument = await firestoreDB.collection("users").doc(uid).get();

      if (!userDocument.exists) {
        throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.user);
      }

      const user = parseUserDocument(userDocument.id, userDocument.data());

      if (!user) {
        throw new TypeError(`Invalid user document: ${userDocument.ref.path}`);
      }

      let storeId: string | undefined;

      if (user.role === "manager" || user.role === "employee") {
        storeId = user.storeId;
      }

      const signinUser: SigninUserRecord = {
        uid: user.uid,
        email: user.email,
        ownerId: user.ownerId,
        role: user.role,
        active: user.active,
        storeId,
        name: user.name,
        displayName: user.displayName,
        lastLoginAt: user.lastLoginAt,
      };

      await cacheSetJson(cacheKey, signinUser, SIGNIN_USER_CACHE_TTL_MS);

      return signinUser;
    });
  };
};
