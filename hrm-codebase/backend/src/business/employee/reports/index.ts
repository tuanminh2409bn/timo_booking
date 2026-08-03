import express from "express";
import { readRateLimit, heavyReadRateLimit } from "../../../config/employee-rate-limits.js";
import { observeBusinessHandler } from "../../../modules/business-observability.js";
import { handleErrorFunction } from "../../../modules/verify-error-function.js";
import { getOwnerHomeSummary } from "./get-owner-home-summary.js";
import { getOwnerReportDashboard } from "./get-owner-report-dashboard.js";
import { getOwnerReportEmployees } from "./get-owner-report-employees.js";
import { getOwnerReportServices } from "./get-owner-report-services.js";
import { getOwnerReportSummaryOptimized } from "./get-owner-report-summary.js";

const reportsRouter = express.Router();

const REPORT_ROUTES = {
  dashboard: "/api/v1/stores/:storeId/reports/dashboard",
  overview: "/api/v1/stores/:storeId/reports/overview",
  employeePerformance: "/api/v1/stores/:storeId/reports/employee-performance",
  servicePerformance: "/api/v1/stores/:storeId/reports/service-performance",
  homeSummary: "/api/v1/reports/home-summary",
};

reportsRouter.get(
  REPORT_ROUTES.dashboard,
  heavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      { eventName: "report.dashboard.read", route: REPORT_ROUTES.dashboard },
      getOwnerReportDashboard,
    ),
  ),
);

reportsRouter.get(
  REPORT_ROUTES.homeSummary,
  readRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      { eventName: "report.home_summary.read", route: REPORT_ROUTES.homeSummary },
      getOwnerHomeSummary,
    ),
  ),
);

reportsRouter.get(
  REPORT_ROUTES.overview,
  heavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      { eventName: "report.overview.read", route: REPORT_ROUTES.overview },
      getOwnerReportSummaryOptimized,
    ),
  ),
);

reportsRouter.get(
  REPORT_ROUTES.employeePerformance,
  heavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "report.employee_performance.read",
        route: REPORT_ROUTES.employeePerformance,
      },
      getOwnerReportEmployees,
    ),
  ),
);

reportsRouter.get(
  REPORT_ROUTES.servicePerformance,
  heavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "report.service_performance.read",
        route: REPORT_ROUTES.servicePerformance,
      },
      getOwnerReportServices,
    ),
  ),
);

export default reportsRouter;
