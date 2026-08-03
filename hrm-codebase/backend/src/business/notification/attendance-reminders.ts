import { canAccessStore, type AuthorizedAppContext } from "../../helpers/role-access.js";
import { isEmployeeRole } from "../../helpers/user-roles.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import type { ShopAttendanceType } from "../../repository/firestore/shop/shop.types.js";
import type { AppNotification } from "./audit-notifications.js";

const REMINDER_WINDOW_MINUTES = 15;
// Asia/Ho_Chi_Minh cố định UTC+7, không có DST — cộng trừ offset tĩnh là đủ.
const VIETNAM_UTC_OFFSET_MINUTES = 7 * 60;

// Thời điểm reminder "phát sinh" = lúc mở cửa sổ nhắc (startTime − 15 phút),
// derive từ chính lịch hẹn nên ổn định giữa các lần fetch — không dùng
// Date.now() (làm reminder luôn nổi đầu feed và label luôn "Vừa xong").
const getReminderCreatedAt = (workDate: string, startTimeMinutes: number) => {
  const [year, month, day] = workDate.split("-").map(Number);
  const workDateStartUtcMs = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);

  return (
    workDateStartUtcMs +
    (startTimeMinutes - VIETNAM_UTC_OFFSET_MINUTES - REMINDER_WINDOW_MINUTES) * 60_000
  );
};

const getTodayWorkDate = () => {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = dateParts.find((part) => part.type === "year")?.value ?? "1970";
  const month = dateParts.find((part) => part.type === "month")?.value ?? "01";
  const day = dateParts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
};

const getCurrentMinutes = () => {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(dateParts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(dateParts.find((part) => part.type === "minute")?.value ?? 0);

  return hour * 60 + minute;
};

const formatMinuteOfDay = (value: number) => {
  const hour = Math.floor(value / 60);
  const minute = value % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const canSeeAttendance = (authContext: AuthorizedAppContext, attendance: ShopAttendanceType) => {
  if (!canAccessStore(authContext, attendance.storeId)) {
    return false;
  }

  if (!isEmployeeRole(authContext.role)) {
    return true;
  }

  return attendance.assignees.some((assignee) => assignee.employeeUserId === authContext.uid);
};

const buildAttendanceReminder = (
  attendance: ShopAttendanceType,
  currentMinutes: number,
  authContext: AuthorizedAppContext,
): AppNotification | null => {
  if (attendance.status !== "open") {
    return null;
  }

  const startsSoon =
    currentMinutes >= attendance.startTime - REMINDER_WINDOW_MINUTES &&
    currentMinutes <= attendance.startTime + REMINDER_WINDOW_MINUTES;

  if (!startsSoon) {
    return null;
  }

  return {
    id: `attendance-reminder:${attendance.id}:start`,
    type: "attendance_reminder",
    title: "Đến giờ chấm công",
    message: `${attendance.customerName ?? "Khách lẻ"} có lịch lúc ${formatMinuteOfDay(attendance.startTime)} tại ${attendance.storeName}.`,
    severity: "warning",
    createdAt: getReminderCreatedAt(attendance.workDate, attendance.startTime),
    source: "attendance",
    entityType: "attendance",
    entityId: attendance.id,
    storeId: attendance.storeId,
    workDate: attendance.workDate,
    route: isEmployeeRole(authContext.role)
      ? `/employee/check-ins/${attendance.id}`
      : `/attendance/${attendance.id}`,
  };
};

export const buildAttendanceReminderNotifications = async (
  authContext: AuthorizedAppContext,
): Promise<AppNotification[]> => {
  const workDate = getTodayWorkDate();
  const currentMinutes = getCurrentMinutes();
  const attendances =
    authContext.storeId && authContext.role !== "owner"
      ? await firestoreRepository.shop.attendance.listShopAttendanceByStoreWorkDateKey(
          authContext.ownerId,
          authContext.storeId,
          workDate,
        )
      : await firestoreRepository.shop.attendance.listShopAttendanceByWorkDateRange(
          authContext.ownerId,
          workDate,
          workDate,
        );

  return attendances
    .filter((attendance) => canSeeAttendance(authContext, attendance))
    .map((attendance) => buildAttendanceReminder(attendance, currentMinutes, authContext))
    .filter((notification): notification is AppNotification => notification !== null);
};
