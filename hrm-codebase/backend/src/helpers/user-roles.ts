import {
  USER_ROLE,
  USER_ROLE_VALUES,
  type UserRole,
} from "../repository/firestore/user/user.types.js";

export { USER_ROLE };

export const EMPLOYEE_ROLE_VALUES = [USER_ROLE.EMPLOYEE] as const;

export const SIGNIN_ALLOWED_ROLES = [
  USER_ROLE.OWNER,
  USER_ROLE.MANAGER,
  USER_ROLE.EMPLOYEE,
] as const;

export type EmployeeRole = (typeof EMPLOYEE_ROLE_VALUES)[number];

export const isUserRole = (value: unknown): value is UserRole =>
  typeof value === "string" && USER_ROLE_VALUES.some((role) => role === value);

export const isEmployeeRole = (role: UserRole | undefined): role is EmployeeRole =>
  role === USER_ROLE.EMPLOYEE;

export const isSupportedSigninRole = (role: UserRole) =>
  SIGNIN_ALLOWED_ROLES.includes(role as (typeof SIGNIN_ALLOWED_ROLES)[number]);
