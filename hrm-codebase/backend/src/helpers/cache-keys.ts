import { createHash } from "node:crypto";

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
};

const hashValue = (value: unknown) =>
  createHash("sha1").update(stableStringify(value)).digest("hex");

export const getEmployeeReportResponseCachePrefix = (ownerId: string) =>
  `store:${ownerId}:response:employee-report:`;

export const getEmployeeReportCacheVersionKey = (ownerId: string) =>
  `store:${ownerId}:version:employee-report`;

export const getEmployeeReportResponseCacheKey = (
  ownerId: string,
  scope: {
    role: string;
    userId?: string;
    storeId?: string;
    requestedStoreId?: string;
    startDate: string;
    endDate: string;
    summaryOnly?: boolean;
    includeItems?: boolean;
    groupBy?: string;
    debug?: boolean;
    employeeLimit?: number;
    serviceLimit?: number;
    responseVersion?: string;
  },
) => `${getEmployeeReportResponseCachePrefix(ownerId)}${hashValue(scope)}`;

export const getAuditLogListCachePrefix = (ownerId: string) =>
  `store:${ownerId}:audit-log:list:v1:`;

export const getAuditLogListCacheKey = (ownerId: string, limit: number) =>
  `${getAuditLogListCachePrefix(ownerId)}limit-${limit}`;

export const getOwnerHomeSummaryResponseCachePrefix = (ownerId: string) =>
  `store:${ownerId}:response:owner-home-summary:`;

export const getOwnerHomeSummaryResponseCacheKey = (
  ownerId: string,
  scope: {
    userId: string;
    role: string;
    responseVersion?: string;
    storeId: string;
    workDate: string;
    monthStart: string;
    monthEnd: string;
  },
) => `${getOwnerHomeSummaryResponseCachePrefix(ownerId)}${hashValue(scope)}`;

export const getMonthlySalaryResponseCachePrefix = (ownerId: string, storeId?: string) =>
  storeId
    ? `store:${ownerId}:response:monthly-salary:${storeId}:`
    : `store:${ownerId}:response:monthly-salary:`;

export const getMonthlySalaryResponseCacheKey = (
  ownerId: string,
  scope: {
    storeId: string;
    year: number;
    month: number;
  },
) => `${getMonthlySalaryResponseCachePrefix(ownerId, scope.storeId)}${hashValue(scope)}`;

export const getWeeklySalaryResponseCachePrefix = (ownerId: string, storeId?: string) =>
  storeId
    ? `store:${ownerId}:response:weekly-salary:${storeId}:`
    : `store:${ownerId}:response:weekly-salary:`;

export const getWeeklySalaryResponseCacheKey = (
  ownerId: string,
  scope: {
    storeId: string;
    weekStart: string;
  },
) => `${getWeeklySalaryResponseCachePrefix(ownerId, scope.storeId)}${hashValue(scope)}`;

export const getAttendanceDetailCacheKey = (ownerId: string, attendanceId: string) =>
  `store:${ownerId}:attendance:detail:${attendanceId}`;

export const getAttendanceRangeCachePrefix = (ownerId: string, storeId: string) =>
  `store:${ownerId}:attendance:range:${storeId}:`;

export const getAttendanceRangeCacheKey = (
  ownerId: string,
  storeId: string,
  fromWorkDate: string,
  toWorkDate: string,
) => `${getAttendanceRangeCachePrefix(ownerId, storeId)}${fromWorkDate}:${toWorkDate}`;

export const getAttendanceCalendarRangeCachePrefix = (ownerId: string, storeId: string) =>
  `store:${ownerId}:attendance:calendar-range:${storeId}:`;

export const getAttendanceCalendarRangeCacheKey = (
  ownerId: string,
  storeId: string,
  fromWorkDate: string,
  toWorkDate: string,
) => `${getAttendanceCalendarRangeCachePrefix(ownerId, storeId)}${fromWorkDate}:${toWorkDate}`;

export const getEmployeeWorkDayClosingRangeCachePrefix = (ownerId: string, storeId: string) =>
  `store:${ownerId}:employee-workday-closing:range:v1:${storeId}:`;

export const getEmployeeWorkDayClosingRangeCacheKey = (
  ownerId: string,
  storeId: string,
  fromWorkDate: string,
  toWorkDate: string,
) => `${getEmployeeWorkDayClosingRangeCachePrefix(ownerId, storeId)}${fromWorkDate}:${toWorkDate}`;
