import type { Request, Response } from "express";
import { roundMoney, sumMoney } from "../../../helpers/money.js";
import { getOrSetCacheableResponse } from "../../../modules/cacheable-response.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { withAppSpan } from "../../../modules/tracing.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { canReadAttendance } from "../domain/attendance-rules.js";
import { resolveReportData } from "./report-data.js";
import {
  buildReportMeta,
  buildReportResponseCacheKey,
  prepareReportRequest,
  reportCacheControl,
  toReportDataContext,
} from "./report-request.js";

export const getOwnerReportDashboard = async (request: Request, response: Response) => {
  const timing = new ServerTiming();
  const preparedReportRequest = await timing.measure("request_prepare", () =>
    prepareReportRequest(request, response, timing),
  );

  if (!preparedReportRequest) {
    return;
  }

  return getOrSetCacheableResponse({
    request,
    response,
    cacheKey: buildReportResponseCacheKey(preparedReportRequest, "report-dashboard-v1"),
    ttlMs: preparedReportRequest.responseTtlMs,
    cacheControl: reportCacheControl(preparedReportRequest.isHistoricalSummaryRange),
    timing,
    producer: async () => {
      let cancellationMetricsPromise: Promise<Array<{ workDate: string; cancelledCount: number }>>;

      if (preparedReportRequest.startDate > preparedReportRequest.effectiveEndDate) {
        cancellationMetricsPromise = Promise.resolve([]);
      } else if (preparedReportRequest.authContext.role === "employee") {
        cancellationMetricsPromise = withAppSpan("report.cancellations.read", {}, () =>
          firestoreRepository.shop.attendance.listShopAttendanceByStoreDateRange(
            preparedReportRequest.authContext.ownerId,
            preparedReportRequest.effectiveStoreId,
            preparedReportRequest.startDate,
            preparedReportRequest.effectiveEndDate,
          ),
        ).then((attendances) => {
          const cancelledCountsByWorkDate = new Map<string, number>();

          for (const attendance of attendances) {
            if (
              attendance.bookingStatus !== "cancelled" ||
              !canReadAttendance(preparedReportRequest.authContext, attendance)
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
            preparedReportRequest.authContext.ownerId,
            preparedReportRequest.effectiveStoreId,
            preparedReportRequest.startDate,
            preparedReportRequest.effectiveEndDate,
          ),
        );
      }

      const expensePromise =
        preparedReportRequest.startDate > preparedReportRequest.effectiveEndDate
          ? Promise.resolve([])
          : withAppSpan("report.expenses.read", {}, () =>
              firestoreRepository.shop.expense.listShopExpenses(
                preparedReportRequest.authContext.ownerId,
                {
                  storeId: preparedReportRequest.effectiveStoreId,
                  fromWorkDate: preparedReportRequest.startDate,
                  toWorkDate: preparedReportRequest.effectiveEndDate,
                },
              ),
            );

      const [reportData, cancellationMetrics, expenses] = await Promise.all([
        timing.measure("report_data", () =>
          resolveReportData({
            ...toReportDataContext(preparedReportRequest),
            summaryOnly: true,
          }),
        ),
        timing.measure("cancellations", () => cancellationMetricsPromise),
        timing.measure("expenses", () => expensePromise),
      ]);
      const { reportAggregates, normalizedAttendances, storeIds, statusCounts, optimizedMeta } =
        reportData;
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
          preparedReportRequest.groupBy === "month"
            ? `${cancellationMetric.workDate.slice(0, 7)}-01`
            : cancellationMetric.workDate;
        const existingAppointmentActivity = appointmentActivityByDate.get(date) ?? {
          date,
          appointmentCount: 0,
          cancelledCount: 0,
        };

        existingAppointmentActivity.cancelledCount += cancellationMetric.cancelledCount;
        appointmentActivityByDate.set(date, existingAppointmentActivity);
        totalCancelledAppointments += cancellationMetric.cancelledCount;
      }

      const dailyAppointments = Array.from(appointmentActivityByDate.values()).sort(
        (leftAppointmentActivity, rightAppointmentActivity) =>
          leftAppointmentActivity.date.localeCompare(rightAppointmentActivity.date),
      );
      const employeePerformance = reportAggregates.employeePerformance.slice(
        0,
        preparedReportRequest.employeeLimit,
      );
      const serviceReport = reportAggregates.serviceReport.slice(
        0,
        preparedReportRequest.serviceLimit,
      );
      const totalAttendance = reportAggregates.summary.totalAttendance;
      const debugMeta = preparedReportRequest.debug
        ? {
            storeIds: optimizedMeta?.storeIds ?? storeIds,
            storeCount: optimizedMeta?.storeCount ?? storeIds.length,
            ...(optimizedMeta
              ? { openCount: optimizedMeta.openCount, closedCount: optimizedMeta.closedCount }
              : statusCounts),
            optimized: optimizedMeta !== undefined,
            ...(optimizedMeta !== undefined && {
              source: "weekly-report-hybrid",
              weeklyReportsUsed: reportData.weeklyReportsUsed,
              rawDateRangesUsed: reportData.rawDateRangesUsed,
              settlementDateRangesUsed: reportData.settlementDateRangesUsed,
              rawAttendanceCount: normalizedAttendances.length,
            }),
          }
        : {};

      return {
        dailyRevenue: reportAggregates.dailyRevenue,
        dailyAppointments,
        employeePerformance,
        serviceReport,
        summary: {
          ...reportAggregates.summary,
          totalExpense: roundMoney(sumMoney(expenses.map((expense) => expense.amount))),
          totalCancelledAppointments,
        },
        meta: {
          ...buildReportMeta(
            preparedReportRequest,
            { ...reportData, totalCount: totalAttendance },
            { returnedCount: employeePerformance.length + serviceReport.length },
          ),
          ...debugMeta,
        },
      };
    },
  });
};
