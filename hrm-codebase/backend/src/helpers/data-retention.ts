const WORK_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const STANDARD_DETAIL_RETENTION_MONTHS = 2;

const daysInUtcMonth = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

export const addUtcCalendarMonths = (timestamp: number, months: number): number => {
  const date = new Date(timestamp);
  const targetMonthIndex = date.getUTCMonth() + months;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(date.getUTCDate(), daysInUtcMonth(targetYear, normalizedMonthIndex));

  return Date.UTC(
    targetYear,
    normalizedMonthIndex,
    targetDay,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
};

export const subtractWorkDateCalendarMonths = (workDate: string, months: number): string => {
  const match = WORK_DATE_PATTERN.exec(workDate);

  if (!match) {
    throw new TypeError(`Invalid work date: ${workDate}`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const targetMonthIndex = monthIndex - months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(day, daysInUtcMonth(targetYear, normalizedMonthIndex));

  return [
    String(targetYear).padStart(4, "0"),
    String(normalizedMonthIndex + 1).padStart(2, "0"),
    String(targetDay).padStart(2, "0"),
  ].join("-");
};

export const resolveStandardRetentionCutoffWorkDate = (currentWorkDate: string): string =>
  subtractWorkDateCalendarMonths(currentWorkDate, STANDARD_DETAIL_RETENTION_MONTHS);
