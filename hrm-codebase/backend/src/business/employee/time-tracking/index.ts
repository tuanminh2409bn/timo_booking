import express from "express";
import { handleErrorFunction } from "../../../modules/verify-error-function.js";
import { readRateLimit, writeRateLimit } from "../../../config/employee-rate-limits.js";
import { observeEmployeeTimeTrackingHandler } from "./employee-time-tracking-observability.js";
import {
  EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS,
  EMPLOYEE_TIME_TRACKING_TRACE_SPANS,
} from "./employee-time-tracking-tracing-contract.js";
import { getStoreEmployeeTimeTracking } from "./get-store-employee-time-tracking.js";
import { updateStoreEmployeeTimeTracking } from "./put-store-employee-time-tracking.js";

const timeTrackingRouter = express.Router();

timeTrackingRouter.get(
  "/api/v1/stores/:storeId/employee-time-tracking",
  readRateLimit,
  handleErrorFunction(
    observeEmployeeTimeTrackingHandler(
      {
        eventName: "employee_time_tracking.manager_read",
        route: "/api/v1/stores/:storeId/employee-time-tracking",
        spanName: EMPLOYEE_TIME_TRACKING_TRACE_SPANS.storeRead,
        operation: EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS.storeRead,
      },
      getStoreEmployeeTimeTracking,
    ),
  ),
);

timeTrackingRouter.put(
  "/api/v1/stores/:storeId/employee-time-tracking/:employeeUserId",
  writeRateLimit,
  handleErrorFunction(
    observeEmployeeTimeTrackingHandler(
      {
        eventName: "employee_time_tracking.manager_update",
        route: "/api/v1/stores/:storeId/employee-time-tracking/:employeeUserId",
        spanName: EMPLOYEE_TIME_TRACKING_TRACE_SPANS.storeUpdate,
        operation: EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS.storeUpdate,
      },
      updateStoreEmployeeTimeTracking,
    ),
  ),
);

export default timeTrackingRouter;
