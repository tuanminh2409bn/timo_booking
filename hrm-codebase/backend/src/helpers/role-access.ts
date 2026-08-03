import type { UserType } from "../repository/firestore/user/user.types.js";
import { USER_ROLE } from "./user-roles.js";

export type AuthorizedAppContext = {
  uid: string;
  ownerId: string;
  role: UserType["role"];
  storeId?: string;
};

// Identity predicates. "Ai được làm gì" nằm ở permissions.ts (bảng PERMISSIONS + can()).
// Ở đây chỉ có "anh là ai" + các phép kiểm tra phụ thuộc dữ liệu runtime (store, quyền sở hữu record).
export const isOwner = (role: UserType["role"]): boolean => role === USER_ROLE.OWNER;
export const isManager = (role: UserType["role"]): boolean => role === USER_ROLE.MANAGER;
export const isEmployee = (role: UserType["role"]): boolean => role === USER_ROLE.EMPLOYEE;

// Owner quản mọi store; manager/employee chỉ thao tác trong đúng store của mình.
export const canAccessStore = (
  authContext: Pick<AuthorizedAppContext, "role" | "storeId">,
  targetStoreId: string,
): boolean => {
  if (isOwner(authContext.role)) {
    return true;
  }

  return authContext.storeId === targetStoreId;
};

// Đọc hồ sơ 1 nhân viên: cùng owner + (owner đọc mọi employee | manager đọc employee cùng store |
// employee chỉ đọc chính mình). Contextual vì phụ thuộc target — không thể đưa vào bảng permission.
export const canReadEmployeeRecord = (
  actor: Pick<AuthorizedAppContext, "uid" | "role" | "ownerId" | "storeId">,
  target: {
    uid: string;
    role: UserType["role"];
    ownerId: string;
    storeId?: string | undefined;
  },
): boolean => {
  if (actor.ownerId !== target.ownerId) {
    return false;
  }

  if (isEmployee(actor.role)) {
    return target.uid === actor.uid;
  }

  if (!isEmployee(target.role)) {
    return false;
  }

  if (isManager(actor.role)) {
    return actor.storeId !== undefined && target.storeId === actor.storeId;
  }

  return isOwner(actor.role);
};
