// Store-scoped overview. Employee and service rankings are served by separate resources.
// Weekly reports and settlements cover history; attendance covers live or unsettled dates.
import type { Request, Response } from "express";
import { getOrSetCacheableResponse } from "../../../modules/cacheable-response.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { roundMoney, sumMoney } from "../../../helpers/money.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { withAppSpan } from "../../../modules/tracing.js";
import { canReadAttendance } from "../domain/attendance-rules.js";
import { resolveReportData } from "./report-data.js";
import {
  buildReportMeta,
  buildReportResponseCacheKey,
  prepareReportRequest,
  reportCacheControl,
  toReportDataContext,
} from "./report-request.js";

export const getOwnerReportSummaryOptimized = async (req: Request, res: Response) => {
  const timing = new ServerTiming();
  const prepared = await prepareReportRequest(req, res);

  if (!prepared) {
    return;
  }

  return getOrSetCacheableResponse({
    request: req,
    response: res,
    cacheKey: buildReportResponseCacheKey(prepared, "report-overview-v2"),
    ttlMs: prepared.responseTtlMs,
    cacheControl: reportCacheControl(prepared.isHistoricalSummaryRange),
    timing,
    producer: async () => {
      let cancellationMetricsPromise: Promise<Array<{ workDate: string; cancelledCount: number }>>;

      if (prepared.startDate > prepared.effectiveEndDate) {
        cancellationMetricsPromise = Promise.resolve([]);
      } else if (prepared.authContext.role === "employee") {
        cancellationMetricsPromise = withAppSpan("report.cancellations.read", {}, () =>
          firestoreRepository.shop.attendance.listShopAttendanceByStoreDateRange(
            prepared.authContext.ownerId,
            prepared.effectiveStoreId,
            prepared.startDate,
            prepared.effectiveEndDate,
          ),
        ).then((attendances) => {
          const cancelledCountsByWorkDate = new Map<string, number>();

          for (const attendance of attendances) {
            if (
              attendance.bookingStatus !== "cancelled" ||
              !canReadAttendance(prepared.authContext, attendance)
            ) {
              continue;
            }

            const currentCancelledCount = cancelledCountsByWorkDate.get(attendance.workDate) ?? 0;
            cancelledCountsByWorkDate.set(attendance.workDate, currentCancelledCount + 1);
          }

          return Array.from(cancelledCountsByWorkDate, ([workDate, cancelledCount]) => ({
            workDate,
            cancelledCount,
          }));
        });
      } else {
        cancellationMetricsPromise = withAppSpan("report.cancellations.read", {}, () =>
          firestoreRepository.shop.attendance.listShopAttendanceCancellationsByStoreDateRange(
            prepared.authContext.ownerId,
            prepared.effectiveStoreId,
            prepared.startDate,
            prepared.effectiveEndDate,
          ),
        );
      }

      const expensePromise =
        prepared.startDate > prepared.effectiveEndDate
          ? Promise.resolve([])
          : withAppSpan("report.expenses.read", {}, () =>
              firestoreRepository.shop.expense.listShopExpenses(prepared.authContext.ownerId, {
                storeId: prepared.effectiveStoreId,
                fromWorkDate: prepared.startDate,
                toWorkDate: prepared.effectiveEndDate,
              }),
            );

      const [data, cancellationMetrics, expenses] = await Promise.all([
        timing.measure("report_data", () => resolveReportData(toReportDataContext(prepared))),
        timing.measure("cancellations", () => cancellationMetricsPromise),
        timing.measure("expenses", () => expensePromise),
      ]);
      const { reportAggregates, normalizedAttendances, storeIds, statusCounts, optimizedMeta } =
        data;
      const totalCount = reportAggregates.summary.totalAttendance;
      const appointmentActivityByDate = new Map<
        string,
        { date: string; appointmentCount: number; cancelledCount: number }
      >();

      for (const dailyRevenue of reportAggregates.dailyRevenue) {
        appointmentActivityByDate.set(dailyRevenue.date, {
          date: dailyRevenue.date,
          appointmentCount: dailyRevenue.attendanceCount,
          cancelledCount: 0,
        });
      }

      let totalCancelledAppointments = 0;

      for (const cancellationMetric of cancellationMetrics) {
        const date =
          prepared.groupBy === "month"
            ? `${cancellationMetric.workDate.slice(0, 7)}-01`
            : cancellationMetric.workDate;
        const existingActivity = appointmentActivityByDate.get(date) ?? {
          date,
          appointmentCount: 0,
          cancelledCount: 0,
        };

        existingActivity.cancelledCount += cancellationMetric.cancelledCount;
        appointmentActivityByDate.set(date, existingActivity);
        totalCancelledAppointments += cancellationMetric.cancelledCount;
      }

      const dailyAppointments = Array.from(appointmentActivityByDate.values()).sort((left, right) =>
        left.date.localeCompare(right.date),
      );

      const debugMeta = prepared.debug
        ? {
            storeIds: optimizedMeta?.storeIds ?? storeIds,
            storeCount: optimizedMeta?.storeCount ?? storeIds.length,
            ...(optimizedMeta
              ? { openCount: optimizedMeta.openCount, closedCount: optimizedMeta.closedCount }
              : statusCounts),
            optimized: optimizedMeta !== undefined,
            ...(optimizedMeta !== undefined && {
              source: "weekly-report-hybrid",
              weeklyReportsUsed: data.weeklyReportsUsed,
              rawDateRangesUsed: data.rawDateRangesUsed,
              settlementDateRangesUsed: data.settlementDateRangesUsed,
              rawAttendanceCount: normalizedAttendances.length,
            }),
          }
        : {};

      return {
        dailyRevenue: reportAggregates.dailyRevenue,
        dailyAppointments,
        summary: {
          ...reportAggregates.summary,
          totalExpense: roundMoney(sumMoney(expenses.map((expense) => expense.amount))),
          totalCancelledAppointments,
        },
        meta: {
          ...buildReportMeta(
            prepared,
            { ...data, totalCount },
            {
              returnedCount: 0,
            },
          ),
          ...debugMeta,
        },
      };
    },
  });
};
