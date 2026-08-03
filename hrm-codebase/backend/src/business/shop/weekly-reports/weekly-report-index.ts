import express from "express";
import { handleErrorFunction } from "../../../modules/verify-error-function.js";
import { createPolicyRateLimit } from "../../../config/rate-limit-policies.js";
import { observeBusinessHandler } from "../../../modules/business-observability.js";
import { listWeeklyReports } from "./get-weekly-report-list.js";
import { getWeeklyReportDetail } from "./get-weekly-report-detail.js";
import { generateWeeklyReportEndpoint } from "./post-generate-weekly-report.js";


const WEEKLY_REPORT_ROUTES = {
  collection: "/api/v1/stores/:storeId/weekly-reports",
  detail: "/api/v1/stores/:storeId/weekly-reports/:weekStartDate",
};

const weeklyReportRouter = express.Router();

const readRateLimit = createPolicyRateLimit("read", {
  keyPrefix: "ratelimit:weekly-report:read",
  message: "Too many weekly report requests",
});
const heavyReadRateLimit = createPolicyRateLimit("heavyRead", {
  keyPrefix: "ratelimit:weekly-report:heavy-read",
  message: "Too many expensive weekly report requests",
});
weeklyReportRouter.get(
  WEEKLY_REPORT_ROUTES.collection,
  readRateLimit,
  handleErrorFunction(listWeeklyReports),
);
weeklyReportRouter.get(
  WEEKLY_REPORT_ROUTES.detail,
  readRateLimit,
  handleErrorFunction(getWeeklyReportDetail),
);
weeklyReportRouter.post(
  WEEKLY_REPORT_ROUTES.collection,
  heavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "weekly_report.generated",
        route: WEEKLY_REPORT_ROUTES.collection,
        spanName: "weekly_report.generate",
      },
      generateWeeklyReportEndpoint,
    ),
  ),
);
export default weeklyReportRouter;
