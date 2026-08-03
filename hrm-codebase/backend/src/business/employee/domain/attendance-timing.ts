import {
  getMinutesOfDayInTimeZone,
  normalizeBusinessTimeZone,
  resolveBusinessWorkDate,
} from "../../../helpers/business-day.js";

export type ResolvedAttendanceTiming = {
  workDate: string;
  storeTimezone: string;
  startTimestamp?: number;
  endTimestamp?: number;
  startTime: number;
  endTime: number;
};

const MS_PER_DAY = 86_400_000;

// Số ngày `workDate` nằm TRƯỚC `todayWorkDate` (âm nếu workDate ở tương lai). Cả hai là chuỗi
// YYYY-MM-DD đã chuẩn hoá theo giờ tiệm, nên so bằng mốc UTC của riêng phần ngày là đủ.
export const countDaysWorkDateIsInThePast = (workDate: string, todayWorkDate: string): number => {
  const [workYear, workMonth, workDay] = workDate.split("-");
  const [todayYear, todayMonth, todayDay] = todayWorkDate.split("-");
  const workDateUtcMs = Date.UTC(Number(workYear), Number(workMonth) - 1, Number(workDay));
  const todayUtcMs = Date.UTC(Number(todayYear), Number(todayMonth) - 1, Number(todayDay));

  return Math.round((todayUtcMs - workDateUtcMs) / MS_PER_DAY);
};

export const isAttendanceStartInFuture = (
  attendance: {
    workDate: string;
    startTimestamp?: number | undefined;
    startTime: number;
    storeTimezone?: string | undefined;
    settlementCutoffTime?: string | undefined;
  },
  now = Date.now(),
): boolean => {
  if (attendance.startTimestamp !== undefined) {
    return attendance.startTimestamp > now;
  }

  const currentWorkDate = resolveBusinessWorkDate(now, {
    timeZone: attendance.storeTimezone,
    settlementCutoffTime: attendance.settlementCutoffTime,
  });

  if (attendance.workDate !== currentWorkDate) {
    return attendance.workDate > currentWorkDate;
  }

  return (
    attendance.startTime >
    getMinutesOfDayInTimeZone(now, normalizeBusinessTimeZone(attendance.storeTimezone))
  );
};

// Khai riêng thay vì `Pick<NormalizedAttendancePayload, ...>` để tầng thời gian không phụ thuộc ngược
// vào tầng parse payload (tránh vòng import).
type AttendanceTimingInput = {
  workDate: string;
  startTimestamp?: number | undefined;
  endTimestamp?: number | undefined;
  startTime: number;
  endTime: number;
};

const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

const localDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: normalizeBusinessTimeZone(undefined),
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const getBusinessTimeZoneOffsetMs = (timestamp: number): number => {
  const parts = localDateTimeFormatter.formatToParts(new Date(timestamp));
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return (
    Date.UTC(
      getPart("year"),
      getPart("month") - 1,
      getPart("day"),
      getPart("hour"),
      getPart("minute"),
      getPart("second"),
    ) - timestamp
  );
};

// Chuỗi "YYYY-MM-DDTHH:mm" không có offset → hiểu theo giờ cửa hàng, không phải UTC.
// Chạy 2 lượt vì offset có thể đổi ngay tại thời điểm đang tính (mốc đổi giờ mùa).
const parseBusinessLocalDateTimeInput = (value: string): Date | undefined => {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);

  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second = "0", millisecond = "0"] = match;
  const localTimestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, "0")),
  );
  const firstPassTimestamp = localTimestamp - getBusinessTimeZoneOffsetMs(localTimestamp);
  const secondPassTimestamp = localTimestamp - getBusinessTimeZoneOffsetMs(firstPassTimestamp);
  const parsedDate = new Date(secondPassTimestamp);

  return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
};

export const parseDateInput = (value: string | Date): Date | undefined => {
  const parsedDate =
    value instanceof Date
      ? new Date(value)
      : (parseBusinessLocalDateTimeInput(value) ?? new Date(value));

  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }

  return parsedDate;
};

export const parseTimestampInput = (value: number | undefined): Date | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
};

export const toMinutesFromDate = (value: Date): number =>
  getMinutesOfDayInTimeZone(value.getTime());

// Quy giờ bắt đầu/kết thúc về múi giờ cửa hàng và suy ra workDate theo mốc chốt sổ.
// Không có startTimestamp thì giữ nguyên giờ/ngày client gửi lên.
export const resolveAttendanceTimingForStore = (
  payload: AttendanceTimingInput,
  options: {
    storeTimezone?: string | undefined;
    settlementCutoffTime?: string | undefined;
  } = {},
): ResolvedAttendanceTiming => {
  const storeTimezone = normalizeBusinessTimeZone(options.storeTimezone);

  if (payload.startTimestamp === undefined) {
    return {
      workDate: payload.workDate,
      storeTimezone,
      startTime: payload.startTime,
      endTime: payload.endTime,
    };
  }

  const startTime = getMinutesOfDayInTimeZone(payload.startTimestamp, storeTimezone);
  const endTime =
    payload.endTimestamp !== undefined
      ? getMinutesOfDayInTimeZone(payload.endTimestamp, storeTimezone)
      : payload.endTime;
  const durationMinutes =
    payload.endTimestamp !== undefined
      ? Math.max(1, Math.round((payload.endTimestamp - payload.startTimestamp) / 60_000))
      : Math.max(1, payload.endTime - payload.startTime);
  const normalizedEndTime = endTime > startTime ? endTime : startTime + durationMinutes;

  return {
    workDate: resolveBusinessWorkDate(payload.startTimestamp, {
      timeZone: storeTimezone,
      settlementCutoffTime: options.settlementCutoffTime,
    }),
    storeTimezone,
    startTimestamp: payload.startTimestamp,
    ...(payload.endTimestamp !== undefined && { endTimestamp: payload.endTimestamp }),
    startTime,
    endTime: normalizedEndTime,
  };
};
