import express from "express";
import { handleErrorFunction } from "../../../modules/verify-error-function.js";
import { readRateLimit, writeRateLimit } from "../../../config/employee-rate-limits.js";
import { observeWorkDaySettlementHandler } from "../work-days/work-day-settlement-observability.js";
import {
  WORK_DAY_SETTLEMENT_TRACE_OPERATIONS,
  WORK_DAY_SETTLEMENT_TRACE_SPANS,
} from "../work-days/work-day-settlement-tracing-contract.js";
import { observeEmployeeTimeTrackingHandler } from "../time-tracking/employee-time-tracking-observability.js";
import {
  EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS,
  EMPLOYEE_TIME_TRACKING_TRACE_SPANS,
} from "../time-tracking/employee-time-tracking-tracing-contract.js";
import { getEmployeePortalReport } from "./get-employee-portal-report.js";
import { closeEmployeeWorkDay } from "./post-close-employee-work-day.js";
import { getEmployeeTimeTracking } from "./get-employee-time-tracking.js";
import { updateEmployeeTimeTracking } from "./put-employee-time-tracking.js";

const portalRouter = express.Router();

portalRouter.get("/api/v1/me/report", readRateLimit, handleErrorFunction(getEmployeePortalReport));

portalRouter.get(
  "/api/v1/me/time-tracking",
  readRateLimit,
  handleErrorFunction(
    observeEmployeeTimeTrackingHandler(
      {
        eventName: "employee_time_tracking.read",
        route: "/api/v1/me/time-tracking",
        spanName: EMPLOYEE_TIME_TRACKING_TRACE_SPANS.selfRead,
        operation: EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS.selfRead,
      },
      getEmployeeTimeTracking,
    ),
  ),
);

portalRouter.put(
  "/api/v1/me/work-day-closings",
  writeRateLimit,
  handleErrorFunction(
    observeWorkDaySettlementHandler(
      {
        eventName: "employee_work_day.close",
        route: "/api/v1/me/work-day-closings",
        spanName: WORK_DAY_SETTLEMENT_TRACE_SPANS.employeeClose,
        operation: WORK_DAY_SETTLEMENT_TRACE_OPERATIONS.employeeClose,
      },
      closeEmployeeWorkDay,
    ),
  ),
);

portalRouter.put(
  "/api/v1/me/time-tracking",
  writeRateLimit,
  handleErrorFunction(
    observeEmployeeTimeTrackingHandler(
      {
        eventName: "employee_time_tracking.update",
        route: "/api/v1/me/time-tracking",
        spanName: EMPLOYEE_TIME_TRACKING_TRACE_SPANS.selfUpdate,
        operation: EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS.selfUpdate,
      },
      updateEmployeeTimeTracking,
    ),
  ),
);

export default portalRouter;
