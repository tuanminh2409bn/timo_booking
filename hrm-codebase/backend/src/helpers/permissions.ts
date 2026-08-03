import type { UserRole } from "../repository/firestore/user/user.types.js";

/**
 * Central RBAC policy: the single source of truth for "which roles may perform which action".
 *
 * Each key is a capability (`resource:action`); the value lists the roles allowed to use it.
 * Handlers gate with `can(role, capability)` instead of ad-hoc role comparisons, so the whole
 * permission model can be read — and audited — in one place.
 *
 * Contextual checks that depend on runtime data (does the actor's store match the target,
 * does the actor own the record) live in `role-access.ts`, not here — a static table cannot
 * express them.
 *
 * Note: `admin` never signs in through the store-facing API (see SIGNIN_ALLOWED_ROLES), so it
 * is intentionally absent from every capability below.
 */
export const PERMISSIONS = {
  // Store operational actions — owner and manager.
  "store:update": ["owner", "manager"],
  "service:manage": ["owner", "manager"],
  "expense:manage": ["owner", "manager"],
  "employee:manage": ["owner", "manager"],
  "employeeTimeTracking:manage": ["owner", "manager"],
  "leave:manage": ["owner", "manager"],
  "workday:close": ["owner", "manager"],
  // Xoá chấm công KHÔNG dùng capability tĩnh: quyền phụ thuộc ngữ cảnh (owner/manager xoá mọi chấm công
  // trong store; employee chỉ xoá chấm công mình tạo và đang "open") → gate bằng `canManageAttendance`
  // + kiểm status trong delete-attendance.ts, giống patch.
  "attendance:backfill": ["owner", "manager"],
  "attendance:editClosed": ["owner", "manager"],

  // Reads available to everyone signed in (data is still store-scoped at the data layer).
  "service:read": ["owner", "manager", "employee"],
  "customer:view": ["owner", "manager"],
  "customer:block": ["owner", "manager"],

  // Employee self-service portal (`/me/*`).
  "employeePortal:use": ["manager", "employee"],
  "employeeWorkDay:close": ["employee"],

  // Statistics / financials — manager is intentionally excluded.
  "homeSummary:view": ["owner"],
  "report:view": ["owner", "employee"],
  "salary:view": ["owner"],
  "settlement:view": ["owner"],
} as const satisfies Record<string, readonly UserRole[]>;

export type Capability = keyof typeof PERMISSIONS;

export const can = (role: UserRole, capability: Capability): boolean =>
  (PERMISSIONS[capability] as readonly UserRole[]).includes(role);
