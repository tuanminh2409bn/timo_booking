import type { UserRole } from "../../../repository/firestore/user/user.types.js";
import {
  SHOP_ATTENDANCE_SOURCES,
  type ShopAttendanceActorRole,
  type ShopAttendanceSource,
  type ShopAttendanceType,
} from "../../../repository/firestore/shop/shop.types.js";
import { isAttendanceStartInFuture } from "./attendance-timing.js";

const attendanceSourceValues = new Set<string>(SHOP_ATTENDANCE_SOURCES);

export const isShopAttendanceSource = (value: unknown): value is ShopAttendanceSource =>
  typeof value === "string" && attendanceSourceValues.has(value);

export const toAttendanceActorRole = (role: UserRole): ShopAttendanceActorRole => {
  if (role === "manager" || role === "employee") {
    return role;
  }

  return "owner";
};

export const resolveStaffAttendanceSource = (
  attendance: Parameters<typeof isAttendanceStartInFuture>[0],
  now = Date.now(),
): ShopAttendanceSource =>
  isAttendanceStartInFuture(attendance, now) ? "manual_booking" : "walk_in";

export const resolveStoredAttendanceSource = (
  attendance: Pick<
    ShopAttendanceType,
    | "source"
    | "bookingSource"
    | "workDate"
    | "startTimestamp"
    | "startTime"
    | "storeTimezone"
    | "settlementCutoffTime"
    | "createdAt"
  >,
): ShopAttendanceSource => {
  if (isShopAttendanceSource(attendance.source)) {
    return attendance.source;
  }

  if (attendance.bookingSource === "online_booking") {
    return "online_booking";
  }

  return resolveStaffAttendanceSource(attendance, attendance.createdAt);
};
