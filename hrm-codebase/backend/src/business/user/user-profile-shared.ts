import { z } from "zod";
import type { UserGender, UserType } from "../../repository/firestore/user/user.types.js";
import { USER_GENDER, USER_GENDER_VALUES } from "../../repository/firestore/user/user.types.js";
import { getUserDisplayName } from "../../helpers/user-name.js";

const optionalTrimmedString = (maxLength: number) => z.string().trim().max(maxLength).optional();
const optionalNonEmptyTrimmedString = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength).optional();

export const updateUserProfileSchema = z
  .object({
    name: optionalNonEmptyTrimmedString(100),
    displayName: optionalNonEmptyTrimmedString(100),
    phone: optionalTrimmedString(30),
    gender: z.enum(USER_GENDER_VALUES).optional(),
  })
  .refine((profileUpdate) => Object.keys(profileUpdate).length > 0, {
    message: "At least one field must be updated",
  });

type BaseProfileFields = {
  uid: string;
  email: string;
  ownerId: string;
  active: boolean;
  name: string;
  displayName: string;
  lastLoginAt?: number | undefined;
};

export type OwnerProfileResponseType = BaseProfileFields & {
  role: "owner";
  phone: string;
  gender: UserGender;
  bankAccount: string;
};

// Manager và employee cùng shape response (store-scoped), chỉ khác literal role.
// (SĐT chỉ owner mới có — xem OwnerProfileResponseType.)
export type StoreScopedProfileResponseType = BaseProfileFields & {
  role: "manager" | "employee";
  storeId: string;
  gender: UserGender;
};

export type UserProfileResponseUserType = OwnerProfileResponseType | StoreScopedProfileResponseType;

export type UserProfileResponseType = {
  user: UserProfileResponseUserType;
};

// Giá trị displayName do user tự đặt (displayName-first), có thể rỗng — KHÁC getUserDisplayName
// (name-first, luôn có giá trị). FE cập nhật displayName độc lập nên phải trả đúng giá trị này.
const resolveDisplayName = (user: UserType): string => {
  if (user.displayName !== undefined) {
    return user.displayName;
  }

  if (user.name !== undefined) {
    return user.name;
  }

  return "";
};

const resolveGender = (user: { gender?: UserGender | undefined }): UserGender => {
  if (user.gender !== undefined) {
    return user.gender;
  }

  return USER_GENDER.OTHER;
};

// Endpoint này không phục vụ admin — admin đi /api/v1/auth/admin-sessions riêng
// (xem SIGNIN_ALLOWED_ROLES trong user-roles.ts). Nếu admin lọt vào đây, coi là lỗi hệ thống.
export const toUserProfileResponse = (user: UserType): UserProfileResponseUserType => {
  const name = getUserDisplayName(user);
  const displayName = resolveDisplayName(user);

  if (user.role === "owner") {
    const response: OwnerProfileResponseType = {
      uid: user.uid,
      email: user.email,
      ownerId: user.ownerId,
      active: user.active,
      name: name,
      displayName: displayName,
      role: "owner",
      phone: "",
      gender: resolveGender(user),
      bankAccount: "",
    };

    if (user.phone !== undefined) {
      response.phone = user.phone;
    }

    if (user.bankAccount !== undefined) {
      response.bankAccount = user.bankAccount;
    }

    if (user.lastLoginAt !== undefined) {
      response.lastLoginAt = user.lastLoginAt;
    }

    return response;
  }

  if (user.role === "manager" || user.role === "employee") {
    const response: StoreScopedProfileResponseType = {
      uid: user.uid,
      email: user.email,
      ownerId: user.ownerId,
      active: user.active,
      name: name,
      displayName: displayName,
      role: user.role,
      storeId: user.storeId,
      gender: resolveGender(user),
    };

    if (user.lastLoginAt !== undefined) {
      response.lastLoginAt = user.lastLoginAt;
    }

    return response;
  }

  throw new Error(`Unexpected admin role reached user profile endpoint: ${user.uid}`);
};
