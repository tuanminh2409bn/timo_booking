// Store-scoped service performance report, limited by serviceLimit.
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

export const getOwnerReportServices = async (req: Request, res: Response) => {
  const timing = new ServerTiming();
  const prepared = await prepareReportRequest(req, res);

  if (!prepared) {
    return;
  }

  return getOrSetCacheableResponse({
    request: req,
    response: res,
    cacheKey: buildReportResponseCacheKey(prepared, "report-services-v1"),
    ttlMs: prepared.responseTtlMs,
    cacheControl: reportCacheControl(prepared.isHistoricalSummaryRange),
    timing,
    producer: async () => {
      // Facet service performance always uses weekly reports and settlements when available.
      const data = await timing.measure("report_data", () =>
        resolveReportData({
          ...toReportDataContext(prepared),
          summaryOnly: true,
        }),
      );
      const serviceReport = data.reportAggregates.serviceReport.slice(0, prepared.serviceLimit);

      return {
        serviceReport,
        meta: buildReportMeta(
          prepared,
          { ...data, totalCount: data.reportAggregates.summary.totalAttendance },
          { returnedCount: serviceReport.length },
        ),
      };
    },
  });
};
