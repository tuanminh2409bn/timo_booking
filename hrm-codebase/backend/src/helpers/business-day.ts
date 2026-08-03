import { getNextWorkDate } from "./work-date-utils.js";

export const DEFAULT_SETTLEMENT_CUTOFF_TIME = "23:00";
export const DEFAULT_BUSINESS_TIME_ZONE = "Europe/Berlin";

const TIME_OF_DAY_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type LocalDateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
};

const getTimeZoneFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

const getLocalDateTimeParts = (
  timestamp: number | Date,
  timeZone: string,
): LocalDateTimeParts => {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const parts = (() => {
    try {
      return getTimeZoneFormatter(timeZone).formatToParts(date);
    } catch {
      return getTimeZoneFormatter(DEFAULT_BUSINESS_TIME_ZONE).formatToParts(date);
    }
  })();

  return {
    year: parts.find((part) => part.type === "year")?.value ?? "1970",
    month: parts.find((part) => part.type === "month")?.value ?? "01",
    day: parts.find((part) => part.type === "day")?.value ?? "01",
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0),
  };
};

const getTimeZoneOffsetMilliseconds = (timestamp: number, timeZone: string): number => {
  const localParts = getLocalDateTimeParts(timestamp, timeZone);
  const timestampRepresentedAsUtc = Date.UTC(
    Number(localParts.year),
    Number(localParts.month) - 1,
    Number(localParts.day),
    localParts.hour,
    localParts.minute,
  );

  return timestampRepresentedAsUtc - timestamp;
};

export const isValidTimeOfDay = (value: unknown): value is string =>
  typeof value === "string" && TIME_OF_DAY_PATTERN.test(value);

export const normalizeSettlementCutoffTime = (value: string | undefined): string =>
  isValidTimeOfDay(value) ? value : DEFAULT_SETTLEMENT_CUTOFF_TIME;

export const isValidBusinessTimeZone = (value: unknown): value is string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  try {
    getTimeZoneFormatter(value.trim()).format(new Date(0));
    return true;
  } catch {
    return false;
  }
};

export const normalizeBusinessTimeZone = (value: string | undefined): string =>
  isValidBusinessTimeZone(value) ? value.trim() : DEFAULT_BUSINESS_TIME_ZONE;

export const getCutoffMinutes = (value: string | undefined): number => {
  const [hours, minutes] = normalizeSettlementCutoffTime(value).split(":").map(Number);

  return (hours ?? 23) * 60 + (minutes ?? 0);
};

export const resolveBusinessWorkDate = (
  timestamp: number | Date,
  options: {
    timeZone?: string | undefined;
    settlementCutoffTime?: string | undefined;
  } = {},
): string => {
  const timeZone = normalizeBusinessTimeZone(options.timeZone);
  const localParts = getLocalDateTimeParts(timestamp, timeZone);
  const workDate = `${localParts.year}-${localParts.month}-${localParts.day}`;
  const currentMinutes = localParts.hour * 60 + localParts.minute;

  return currentMinutes >= getCutoffMinutes(options.settlementCutoffTime)
    ? getNextWorkDate(workDate)
    : workDate;
};

export const resolveSettlementEligibleAt = (
  workDate: string,
  options: {
    timeZone?: string | undefined;
    settlementCutoffTime?: string | undefined;
  } = {},
): number => {
  const [yearValue, monthValue, dayValue] = workDate.split("-").map(Number);
  const workDateStartUtc = Date.UTC(yearValue ?? 1970, (monthValue ?? 1) - 1, dayValue ?? 1);
  const previousCalendarDate = new Date(workDateStartUtc);
  previousCalendarDate.setUTCDate(previousCalendarDate.getUTCDate() - 1);

  const [cutoffHour, cutoffMinute] = normalizeSettlementCutoffTime(
    options.settlementCutoffTime,
  )
    .split(":")
    .map(Number);
  const localWallClockTimestamp = Date.UTC(
    previousCalendarDate.getUTCFullYear(),
    previousCalendarDate.getUTCMonth(),
    previousCalendarDate.getUTCDate(),
    cutoffHour ?? 23,
    cutoffMinute ?? 0,
  );
  const timeZone = normalizeBusinessTimeZone(options.timeZone);
  let eligibleAt = localWallClockTimestamp;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextEligibleAt =
      localWallClockTimestamp - getTimeZoneOffsetMilliseconds(eligibleAt, timeZone);

    if (nextEligibleAt === eligibleAt) {
      break;
    }

    eligibleAt = nextEligibleAt;
  }

  return eligibleAt;
};

export const getMinutesOfDayInTimeZone = (
  timestamp: number | Date,
  timeZone?: string,
): number => {
  const localParts = getLocalDateTimeParts(timestamp, normalizeBusinessTimeZone(timeZone));

  return localParts.hour * 60 + localParts.minute;
};

export const resolveZonedDateTimeEpoch = (
  workDate: string,
  minutesOfDay: number,
  timeZone?: string,
): number => {
  const [year, month, day] = workDate.split("-").map(Number);
  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  const localWallClockTimestamp = Date.UTC(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    hours,
    minutes,
  );
  const normalizedTimeZone = normalizeBusinessTimeZone(timeZone);
  let epoch = localWallClockTimestamp;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextEpoch = localWallClockTimestamp - getTimeZoneOffsetMilliseconds(epoch, normalizedTimeZone);
    if (nextEpoch === epoch) break;
    epoch = nextEpoch;
  }
  return epoch;
};

export const resolveAttendanceCalendarWorkDate = (
  workDate: string,
  startTime: number,
  settlementCutoffTime?: string,
): string => {
  if (startTime < getCutoffMinutes(settlementCutoffTime)) {
    return workDate;
  }

  const date = new Date(`${workDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};
