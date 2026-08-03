import express from "express";
import { handleErrorFunction } from "../../../modules/verify-error-function.js";
import {
  calendarReadRateLimit,
  readRateLimit,
  writeRateLimit,
} from "../../../config/employee-rate-limits.js";
import { getAttendanceList } from "./get-attendance-list.js";
import { getAttendanceFormOptions } from "./get-attendance-form-options.js";
import { getAttendanceCalendar } from "./get-attendance-calendar.js";
import { getAttendanceDetail } from "./get-attendance-detail.js";
import { createAttendance } from "./post-create-attendance.js";
import { backfillAttendance } from "./post-backfill-attendance.js";
import { updateAttendance } from "./patch-update-attendance.js";
import { deleteAttendance } from "./delete-attendance.js";
import { deleteTestAttendanceData } from "./delete-test-attendance-data.js";
import {
  ATTENDANCE_TRACE_OPERATIONS,
  ATTENDANCE_TRACE_SPANS,
} from "./attendance-tracing-contract.js";
import {
  getAttendanceCalendarTraceAttributes,
  getAttendanceFormOptionsTraceAttributes,
  getAttendanceListTraceAttributes,
  getAttendanceTestDataTraceAttributes,
  observeAttendanceHandler,
} from "./attendance-observability.js";

const attendanceRouter = express.Router();

attendanceRouter.get(
  "/api/v1/stores/:storeId/attendances",
  readRateLimit,
  handleErrorFunction(
    observeAttendanceHandler(
      {
        spanName: ATTENDANCE_TRACE_SPANS.listRead,
        route: "/api/v1/stores/:storeId/attendances",
        operation: ATTENDANCE_TRACE_OPERATIONS.listRead,
        getAttributes: getAttendanceListTraceAttributes,
      },
      getAttendanceList,
    ),
  ),
);
attendanceRouter.get(
  "/api/v1/stores/:storeId/attendances/form-options",
  readRateLimit,
  handleErrorFunction(
    observeAttendanceHandler(
      {
        spanName: ATTENDANCE_TRACE_SPANS.formOptionsRead,
        route: "/api/v1/stores/:storeId/attendances/form-options",
        operation: ATTENDANCE_TRACE_OPERATIONS.formOptionsRead,
        getAttributes: getAttendanceFormOptionsTraceAttributes,
      },
      getAttendanceFormOptions,
    ),
  ),
);
attendanceRouter.get(
  "/api/v1/stores/:storeId/attendances/calendar",
  calendarReadRateLimit,
  handleErrorFunction(
    observeAttendanceHandler(
      {
        spanName: ATTENDANCE_TRACE_SPANS.calendarRead,
        route: "/api/v1/stores/:storeId/attendances/calendar",
        operation: ATTENDANCE_TRACE_OPERATIONS.calendarRead,
        getAttributes: getAttendanceCalendarTraceAttributes,
      },
      getAttendanceCalendar,
    ),
  ),
);
attendanceRouter.get(
  "/api/v1/stores/:storeId/attendances/:attendanceId",
  readRateLimit,
  handleErrorFunction(
    observeAttendanceHandler(
      {
        spanName: ATTENDANCE_TRACE_SPANS.detailRead,
        route: "/api/v1/stores/:storeId/attendances/:attendanceId",
        operation: ATTENDANCE_TRACE_OPERATIONS.detailRead,
      },
      getAttendanceDetail,
    ),
  ),
);
attendanceRouter.post(
  "/api/v1/stores/:storeId/attendances",
  writeRateLimit,
  handleErrorFunction(
    observeAttendanceHandler(
      {
        spanName: ATTENDANCE_TRACE_SPANS.create,
        route: "/api/v1/stores/:storeId/attendances",
        operation: ATTENDANCE_TRACE_OPERATIONS.create,
      },
      createAttendance,
    ),
  ),
);
attendanceRouter.post(
  "/api/v1/stores/:storeId/attendances/backfill",
  writeRateLimit,
  handleErrorFunction(
    observeAttendanceHandler(
      {
        spanName: ATTENDANCE_TRACE_SPANS.backfill,
        route: "/api/v1/stores/:storeId/attendances/backfill",
        operation: ATTENDANCE_TRACE_OPERATIONS.backfill,
      },
      backfillAttendance,
    ),
  ),
);
attendanceRouter.patch(
  "/api/v1/stores/:storeId/attendances/:attendanceId",
  writeRateLimit,
  handleErrorFunction(
    observeAttendanceHandler(
      {
        spanName: ATTENDANCE_TRACE_SPANS.update,
        route: "/api/v1/stores/:storeId/attendances/:attendanceId",
        operation: ATTENDANCE_TRACE_OPERATIONS.update,
      },
      updateAttendance,
    ),
  ),
);
attendanceRouter.delete(
  "/api/v1/stores/:storeId/attendances/test-data",
  writeRateLimit,
  handleErrorFunction(
    observeAttendanceHandler(
      {
        spanName: ATTENDANCE_TRACE_SPANS.testDataDelete,
        route: "/api/v1/stores/:storeId/attendances/test-data",
        operation: ATTENDANCE_TRACE_OPERATIONS.testDataDelete,
        getAttributes: getAttendanceTestDataTraceAttributes,
      },
      deleteTestAttendanceData,
    ),
  ),
);
attendanceRouter.delete(
  "/api/v1/stores/:storeId/attendances/:attendanceId",
  writeRateLimit,
  handleErrorFunction(
    observeAttendanceHandler(
      {
        spanName: ATTENDANCE_TRACE_SPANS.delete,
        route: "/api/v1/stores/:storeId/attendances/:attendanceId",
        operation: ATTENDANCE_TRACE_OPERATIONS.delete,
      },
      deleteAttendance,
    ),
  ),
);

export default attendanceRouter;
