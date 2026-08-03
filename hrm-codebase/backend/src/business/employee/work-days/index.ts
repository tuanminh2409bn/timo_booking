import express from "express";
import { handleErrorFunction } from "../../../modules/verify-error-function.js";
import { observeBusinessHandler } from "../../../modules/business-observability.js";
import {
  readRateLimit,
  heavyReadRateLimit,
  writeRateLimit,
} from "../../../config/employee-rate-limits.js";
import { getAttendanceSession } from "./get-attendance-session.js";
import { getSettlementList } from "./get-settlement-list.js";
import { getSettlementPreview } from "./get-settlement-preview.js";
import { getSettlementAttendanceItems } from "./get-settlement-attendance-items.js";
import { getClosedWorkDaySettlement } from "./get-closed-work-day-settlement.js";
import { getClosedWorkDaySettlements } from "./get-closed-work-day-settlements.js";
import { getWorkDaySettlementCandidates } from "./get-work-day-settlement-candidates.js";
import { createClosedWorkDaySettlement } from "./post-close-work-day.js";
import { observeWorkDaySettlementHandler } from "./work-day-settlement-observability.js";
import {
  WORK_DAY_SETTLEMENT_TRACE_OPERATIONS,
  WORK_DAY_SETTLEMENT_TRACE_SPANS,
} from "./work-day-settlement-tracing-contract.js";

const workDaysRouter = express.Router();

workDaysRouter.get(
  "/api/v1/stores/:storeId/work-days",
  readRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "attendance_session.get",
        route: "/api/v1/stores/:storeId/work-days",
      },
      getAttendanceSession,
    ),
  ),
);
workDaysRouter.get(
  "/api/v1/stores/:storeId/work-days/settlements",
  heavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "settlement.list",
        route: "/api/v1/stores/:storeId/work-days/settlements",
      },
      getSettlementList,
    ),
  ),
);
workDaysRouter.get(
  "/api/v1/stores/:storeId/work-days/settlement-preview",
  heavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "settlement.preview",
        route: "/api/v1/stores/:storeId/work-days/settlement-preview",
      },
      getSettlementPreview,
    ),
  ),
);
workDaysRouter.get(
  "/api/v1/stores/:storeId/work-day-settlements",
  heavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "work_day_settlement.list_closed",
        route: "/api/v1/stores/:storeId/work-day-settlements",
      },
      getClosedWorkDaySettlements,
    ),
  ),
);
workDaysRouter.get(
  "/api/v1/stores/:storeId/work-day-settlements/:workDate/attendance-items",
  readRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "work_day_settlement.attendance_items",
        route: "/api/v1/stores/:storeId/work-day-settlements/:workDate/attendance-items",
      },
      getSettlementAttendanceItems,
    ),
  ),
);
workDaysRouter.get(
  "/api/v1/stores/:storeId/work-day-settlements/:workDate",
  readRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "work_day_settlement.get",
        route: "/api/v1/stores/:storeId/work-day-settlements/:workDate",
      },
      getClosedWorkDaySettlement,
    ),
  ),
);
workDaysRouter.get(
  "/api/v1/stores/:storeId/work-day-settlement-candidates",
  heavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "work_day_settlement_candidate.list",
        route: "/api/v1/stores/:storeId/work-day-settlement-candidates",
      },
      getWorkDaySettlementCandidates,
    ),
  ),
);
workDaysRouter.post(
  "/api/v1/stores/:storeId/work-day-settlements",
  writeRateLimit,
  handleErrorFunction(
    observeWorkDaySettlementHandler(
      {
        eventName: "work_day.close",
        route: "/api/v1/stores/:storeId/work-day-settlements",
        spanName: WORK_DAY_SETTLEMENT_TRACE_SPANS.storeClose,
        operation: WORK_DAY_SETTLEMENT_TRACE_OPERATIONS.storeClose,
      },
      createClosedWorkDaySettlement,
    ),
  ),
);

export default workDaysRouter;
