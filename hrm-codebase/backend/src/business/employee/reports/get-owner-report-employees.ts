// Store-scoped employee performance report, limited by employeeLimit.
import type { Request, Response } from "express";
import { getOrSetCacheableResponse } from "../../../modules/cacheable-response.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { resolveReportData } from "./report-data.js";
import {
  buildReportMeta,
  buildReportResponseCacheKey,
  prepareReportRequest,
  reportCacheControl,
  toReportDataContext,
} from "./report-request.js";

export const getOwnerReportEmployees = async (req: Request, res: Response) => {
  const timing = new ServerTiming();
  const prepared = await prepareReportRequest(req, res);

  if (!prepared) {
    return;
  }

  return getOrSetCacheableResponse({
    request: req,
    response: res,
    cacheKey: buildReportResponseCacheKey(prepared, "report-employees-v1"),
    ttlMs: prepared.responseTtlMs,
    cacheControl: reportCacheControl(prepared.isHistoricalSummaryRange),
    timing,
    producer: async () => {
      // Facet employee performance always uses weekly reports and settlements when available.
      const data = await timing.measure("report_data", () =>
        resolveReportData({
          ...toReportDataContext(prepared),
          summaryOnly: true,
        }),
      );
      const employeePerformance = data.reportAggregates.employeePerformance.slice(
        0,
        prepared.employeeLimit,
      );

      return {
        employeePerformance,
        meta: buildReportMeta(
          prepared,
          { ...data, totalCount: data.reportAggregates.summary.totalAttendance },
          { returnedCount: employeePerformance.length },
        ),
      };
    },
  });
};
