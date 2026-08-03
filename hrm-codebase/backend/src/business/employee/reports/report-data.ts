// Tầng ĐỌC + TỔNG HỢP dữ liệu báo cáo owner (weekly report → settlement → live attendance).
// Tách khỏi builder thuần (report-aggregation.ts) vì tầng này có I/O (Firestore) + quyền.
// Dùng chung cho 3 endpoint report (summary / employees / services) — mỗi endpoint chỉ shape phần của mình.
import {
  canAccessStore,
  isOwner,
  type AuthorizedAppContext,
} from "../../../helpers/role-access.js";
import { getEmployeeReportResponseCacheKey } from "../../../helpers/cache-keys.js";
import { canReadAttendance } from "../domain/attendance-rules.js";
import { normalizeAttendanceForResponse } from "../domain/attendance-presentation.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { withAppSpan } from "../../../modules/tracing.js";
import { runSingleFlight } from "../../../repository/cache/cache-client.js";
import {
  getWeekEndDate,
  getWeeksInRange,
  isCurrentWeek,
} from "../../../helpers/weekly-report-generator.js";
import {
  buildReportAggregatesFromAttendances,
  buildReportAggregatesFromSettlements,
  buildReportAggregatesFromWeeklyReports,
  getInclusiveRangeDays,
  isWeeklyServiceBreakdownMissing,
  MAX_RAW_REPORT_RANGE_DAYS,
  mergeReportAggregates,
  type ServiceBreakdownStatus,
} from "./report-aggregation.js";
import { canUseWeeklyReportForRange, getRawDateRanges } from "../domain/weekly-report-reader.js";

const latestUpdatedAtOf = (
  records: ReadonlyArray<{ updatedAt?: number | undefined; createdAt?: number | undefined }>,
): number =>
  records.reduce(
    (maxUpdatedAt, record) => Math.max(maxUpdatedAt, record.updatedAt ?? record.createdAt ?? 0),
    0,
  );

const countAttendanceStatuses = (
  attendances: ReturnType<typeof normalizeAttendanceForResponse>[],
): { openCount: number; closedCount: number } =>
  attendances.reduce(
    (statusCounts, attendance) => {
      if (attendance.status === "closed") {
        statusCounts.closedCount += 1;
      } else {
        statusCounts.openCount += 1;
      }

      return statusCounts;
    },
    { openCount: 0, closedCount: 0 },
  );

export type ReportDataContext = {
  authContext: AuthorizedAppContext;
  effectiveStoreId: string;
  startDate: string;
  effectiveEndDate: string;
  effectiveRangeDays: number;
  groupBy: "day" | "month";
  // CHỈ trả thống kê tổng hợp, KHÔNG trả items chi tiết → dùng được đường weekly/settlement thay vì
  // quét attendance thô. Xem chi tiết ở PreparedReportRequest.summaryOnly (report-request.ts).
  summaryOnly: boolean;
  todayWorkDate: string;
  requestedStoreId: string | undefined;
};

export type ReportData = {
  reportAggregates: ReturnType<typeof buildReportAggregatesFromAttendances>;
  normalizedAttendances: ReturnType<typeof normalizeAttendanceForResponse>[];
  serviceBreakdownStatus: ServiceBreakdownStatus;
  storeIds: string[];
  statusCounts: { openCount: number; closedCount: number };
  optimizedMeta:
    | {
        totalCount: number;
        latestUpdatedAt: number;
        storeIds: string[];
        storeCount: number;
        openCount: number;
        closedCount: number;
      }
    | undefined;
  weeklyReportsUsed: number;
  rawDateRangesUsed: Array<{ startDate: string; endDate: string }>;
  settlementDateRangesUsed: Array<{ startDate: string; endDate: string }>;
};

export const resolveReportData = async (context: ReportDataContext): Promise<ReportData> => {
  const reportDataSingleFlightKey = getEmployeeReportResponseCacheKey(context.authContext.ownerId, {
    role: context.authContext.role,
    userId: context.authContext.uid,
    requestedStoreId: context.effectiveStoreId,
    startDate: context.startDate,
    endDate: context.effectiveEndDate,
    groupBy: context.groupBy,
    summaryOnly: context.summaryOnly,
    responseVersion: "report-data-v1",
  });

  return runSingleFlight(reportDataSingleFlightKey, async () => {
    const {
      authContext,
      effectiveStoreId,
      startDate,
      effectiveEndDate: aggregationEndDate,
      effectiveRangeDays,
      groupBy,
      summaryOnly,
      todayWorkDate,
      requestedStoreId,
    } = context;

    const hasQueryableRange = aggregationEndDate >= startDate;
    const weeks = hasQueryableRange ? getWeeksInRange(startDate, aggregationEndDate) : [];
    const weeklyReportWeeks = summaryOnly
      ? weeks.filter((week) => !isCurrentWeek(week) && getWeekEndDate(week) < todayWorkDate)
      : [];
    const canUseWeeklyReports = authContext.role !== "employee" && weeklyReportWeeks.length > 0;

    let reportAggregates: ReturnType<typeof buildReportAggregatesFromAttendances>;
    let normalizedAttendances: ReturnType<typeof normalizeAttendanceForResponse>[];
    let serviceBreakdownStatus: ServiceBreakdownStatus = "complete";
    let weeklyReportsUsed = 0;
    let rawDateRangesUsed: Array<{ startDate: string; endDate: string }> = [];
    let settlementDateRangesUsed: Array<{ startDate: string; endDate: string }> = [];
    let optimizedMeta: ReportData["optimizedMeta"];

    if (canUseWeeklyReports) {
      const firstCompletedWeek = weeklyReportWeeks[0];
      const lastCompletedWeek = weeklyReportWeeks[weeklyReportWeeks.length - 1];

      if (!firstCompletedWeek || !lastCompletedWeek) {
        throw new Error("Weekly report range was empty after validation");
      }

      const weeklyReports = await withAppSpan("report.weekly_reports.read", {}, () =>
        firestoreRepository.shop.weeklyReport.listWeeklyReports(
          authContext.ownerId,
          effectiveStoreId,
          firstCompletedWeek,
          lastCompletedWeek,
        ),
      );

      const usableWeeklyReports = weeklyReports.filter((report) =>
        canUseWeeklyReportForRange(report, startDate, aggregationEndDate),
      );
      const missingWeeklyServiceBreakdown = usableWeeklyReports.some((report) =>
        isWeeklyServiceBreakdownMissing(report, startDate, aggregationEndDate),
      );

      weeklyReportsUsed = usableWeeklyReports.length;
      // Reader trả {fromWorkDate, toWorkDate}; reports (meta + downstream) dùng {startDate, endDate} → map tại chỗ.
      rawDateRangesUsed = getRawDateRanges(
        startDate,
        aggregationEndDate,
        usableWeeklyReports.map((report) => report.weekStartDate),
      ).map((range) => ({ startDate: range.fromWorkDate, endDate: range.toWorkDate }));
      const previousWorkDateBeforeTodayValue = new Date(`${todayWorkDate}T00:00:00.000Z`);
      previousWorkDateBeforeTodayValue.setUTCDate(
        previousWorkDateBeforeTodayValue.getUTCDate() - 1,
      );
      const previousWorkDateBeforeToday = previousWorkDateBeforeTodayValue
        .toISOString()
        .slice(0, 10);
      const liveDateRangesUsed: Array<{ startDate: string; endDate: string }> = [];

      for (const rawDateRange of rawDateRangesUsed) {
        const historicalRangeEndDate =
          rawDateRange.endDate < todayWorkDate
            ? rawDateRange.endDate
            : previousWorkDateBeforeToday;

        if (rawDateRange.startDate <= historicalRangeEndDate) {
          settlementDateRangesUsed.push({
            startDate: rawDateRange.startDate,
            endDate: historicalRangeEndDate,
          });
        }

        const liveRangeStartDate =
          rawDateRange.startDate > todayWorkDate ? rawDateRange.startDate : todayWorkDate;

        if (liveRangeStartDate <= rawDateRange.endDate) {
          liveDateRangesUsed.push({
            startDate: liveRangeStartDate,
            endDate: rawDateRange.endDate,
          });
        }
      }
      const settlementChunks = await withAppSpan("report.settlements.read", {}, () =>
        Promise.all(
          settlementDateRangesUsed.map((range) =>
            firestoreRepository.shop.settlement.listClosedWorkDaySettlementFinancialProjectionByStoreDateRange(
              authContext.ownerId,
              effectiveStoreId,
              range.startDate,
              range.endDate,
            ),
          ),
        ),
      );
      const settlements = settlementChunks.flat();
      const historicalRangesWithoutSettlement = settlementDateRangesUsed.filter(
        (range, rangeIndex) =>
          (settlementChunks[rangeIndex]?.length ?? 0) <
          getInclusiveRangeDays(range.startDate, range.endDate),
      );
      const rawAttendanceDateRanges = [...historicalRangesWithoutSettlement, ...liveDateRangesUsed];
      const rawAttendanceChunks = await withAppSpan("report.raw_attendances.read", {}, () =>
        Promise.all(
          rawAttendanceDateRanges.map((range) =>
            firestoreRepository.shop.attendance.listShopAttendanceByStoreDateRange(
              authContext.ownerId,
              effectiveStoreId,
              range.startDate,
              range.endDate,
            ),
          ),
        ),
      );
      const settlementWorkDates = new Set(settlements.map((settlement) => settlement.workDate));
      const rawAttendances = rawAttendanceChunks
        .flat()
        .filter((attendance) => !settlementWorkDates.has(attendance.workDate))
        .filter((attendance) => canReadAttendance(authContext, attendance));

      normalizedAttendances = rawAttendances.map(normalizeAttendanceForResponse);
      const weeklyAggregates = buildReportAggregatesFromWeeklyReports(
        usableWeeklyReports,
        groupBy,
        startDate,
        startDate,
        aggregationEndDate,
      );
      const rawAggregates = buildReportAggregatesFromAttendances(
        normalizedAttendances,
        groupBy,
        startDate,
      );
      const settlementAggregates = buildReportAggregatesFromSettlements(
        settlements,
        groupBy,
        startDate,
      );
      reportAggregates = mergeReportAggregates(
        [weeklyAggregates, settlementAggregates, rawAggregates],
        startDate,
      );
      let latestServiceFallbackUpdatedAt = 0;
      const missingSettlementServiceBreakdown = settlements.some(
        (settlement) =>
          settlement.closing.summary.totalEntries > 0 && settlement.serviceSummaries.length === 0,
      );

      if (missingWeeklyServiceBreakdown || missingSettlementServiceBreakdown) {
        if (effectiveRangeDays <= MAX_RAW_REPORT_RANGE_DAYS) {
          const serviceFallbackAttendances = (
            await withAppSpan("report.service_breakdown_fallback.read", {}, () =>
              firestoreRepository.shop.attendance.listShopAttendanceByStoreDateRange(
                authContext.ownerId,
                effectiveStoreId,
                startDate,
                aggregationEndDate,
              ),
            )
          ).filter((attendance) => canReadAttendance(authContext, attendance));
          const serviceFallbackAggregates = buildReportAggregatesFromAttendances(
            serviceFallbackAttendances.map(normalizeAttendanceForResponse),
            groupBy,
            startDate,
          );

          reportAggregates = {
            ...reportAggregates,
            serviceReport: serviceFallbackAggregates.serviceReport,
          };
          serviceBreakdownStatus = "legacy_fallback";
          latestServiceFallbackUpdatedAt = latestUpdatedAtOf(serviceFallbackAttendances);
        } else {
          serviceBreakdownStatus = "partial";
        }
      }

      const totalAttendance = reportAggregates.summary.totalAttendance;
      const latestUpdatedAt = Math.max(
        latestUpdatedAtOf(weeklyReports),
        latestUpdatedAtOf(settlements),
        latestUpdatedAtOf(rawAttendances),
        latestServiceFallbackUpdatedAt,
      );
      const rawStatusCounts = countAttendanceStatuses(normalizedAttendances);
      optimizedMeta = {
        totalCount: totalAttendance,
        latestUpdatedAt,
        storeIds: [effectiveStoreId],
        storeCount: 1,
        openCount: rawStatusCounts.openCount,
        closedCount: totalAttendance - rawStatusCounts.openCount,
      };
    } else {
      const [closedSettlements, attendances] = hasQueryableRange
        ? await Promise.all([
            withAppSpan("report.settlements.read", {}, () =>
              firestoreRepository.shop.settlement.listClosedWorkDaySettlementFinancialProjectionByStoreDateRange(
                authContext.ownerId,
                effectiveStoreId,
                startDate,
                aggregationEndDate,
              ),
            ),
            withAppSpan("report.raw_attendances.read", {}, () =>
              firestoreRepository.shop.attendance.listShopAttendanceByStoreDateRange(
                authContext.ownerId,
                effectiveStoreId,
                startDate,
                aggregationEndDate,
              ),
            ),
          ])
        : [[], []];

      const historicalSettlements = closedSettlements.filter(
        (settlement) => settlement.workDate < todayWorkDate,
      );
      const historicalSettlementDates = new Set(
        historicalSettlements.map((settlement) => settlement.workDate),
      );
      const attendancesWithinCallerScope = attendances.filter((attendance) => {
        if (requestedStoreId === undefined && !canAccessStore(authContext, attendance.storeId)) {
          return false;
        }

        if (!isOwner(authContext.role)) {
          return canReadAttendance(authContext, attendance);
        }

        return true;
      });

      const liveOrUnsettledAttendances = attendancesWithinCallerScope.filter(
        (attendance) =>
          attendance.workDate >= todayWorkDate ||
          !historicalSettlementDates.has(attendance.workDate),
      );

      normalizedAttendances = liveOrUnsettledAttendances.map(normalizeAttendanceForResponse);
      const settlementAggregates = buildReportAggregatesFromSettlements(
        historicalSettlements,
        groupBy,
        startDate,
      );
      const rawAggregates = buildReportAggregatesFromAttendances(
        normalizedAttendances,
        groupBy,
        startDate,
      );
      reportAggregates = mergeReportAggregates([settlementAggregates, rawAggregates], startDate);
      settlementDateRangesUsed =
        historicalSettlements.length > 0 ? [{ startDate, endDate: aggregationEndDate }] : [];
    }

    const storeIds = Array.from(
      new Set(normalizedAttendances.map((attendance) => attendance.storeId)),
    ).sort((left, right) => left.localeCompare(right));
    const statusCounts = countAttendanceStatuses(normalizedAttendances);

    return {
      reportAggregates,
      normalizedAttendances,
      serviceBreakdownStatus,
      storeIds,
      statusCounts,
      optimizedMeta,
      weeklyReportsUsed,
      rawDateRangesUsed,
      settlementDateRangesUsed,
    };
  });
};
