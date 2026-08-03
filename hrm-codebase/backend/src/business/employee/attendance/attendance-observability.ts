import { trace } from "@opentelemetry/api";
import type { Request, Response } from "express";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { observeBusinessHandler } from "../../../modules/business-observability.js";
import { getRequestContext } from "../../../modules/request-context.js";
import { withAppSpan } from "../../../modules/tracing.js";
import {
  ATTENDANCE_TRACE_DOMAIN,
  filterAttendanceTraceAttributes,
  setAttendanceSpanAttributes,
  type AttendanceTraceAttributes,
  type AttendanceTraceOperation,
  type AttendanceTraceOutcome,
} from "./attendance-tracing-contract.js";

type AttendanceHandler = (req: Request, res: Response) => Promise<unknown>;

type AttendanceObservabilityOptions = {
  spanName: string;
  route: string;
  operation: AttendanceTraceOperation;
  getAttributes?: (req: Request) => AttendanceTraceAttributes;
};

const attendanceOutcomeByErrorType = new Map<string, AttendanceTraceOutcome>([
  ["/stores/attendances/invalid-request", "invalid_payload"],
  ["/stores/attendances/form-options/invalid-request", "invalid_payload"],
  ["/stores/attendances/calendar/invalid-request", "invalid_payload"],
  ["/stores/attendances/test-data/invalid-request", "invalid_payload"],
  ["/stores/attendances/forbidden-store", "forbidden_store"],
  ["/stores/attendances/form-options/forbidden-store", "forbidden_store"],
  ["/stores/attendances/calendar/forbidden-store", "forbidden_store"],
  ["/stores/attendances/test-data/forbidden-store", "forbidden_store"],
  ["/stores/attendances/forbidden-attendance", "forbidden_role"],
  ["/stores/attendances/employee-assignee-required", "employee_main_assignee_required"],
  ["/stores/attendances/work-day-already-closed", "work_day_closed"],
  ["/stores/attendances/work-day-not-closed", "work_day_open"],
  ["/stores/attendances/past-window-exceeded", "past_window_exceeded"],
  ["/stores/attendances/employee-time-tracking-required", "employee_time_tracking_required"],
  ["/stores/attendances/employee-future-booking-forbidden", "future_booking_forbidden"],
  ["/stores/attendances/customer-blocked", "customer_blocked"],
  ["/stores/attendances/booking-confirmation-incomplete", "confirmation_incomplete"],
  ["/stores/attendances/invalid-discount-value", "invalid_discount"],
  ["/stores/attendances/invalid-discount-allocation", "invalid_discount"],
  ["/stores/attendances/invalid-settlement-state", "invalid_settlement_state"],
  ["/stores/attendances/inconsistent-assignees", "data_inconsistent"],
  ["/stores/attendances/future-booking-status-not-allowed", "future_status_not_allowed"],
  ["/stores/attendances/attendance-locked", "attendance_locked"],
  ["/stores/attendances/attendance-closed", "attendance_locked"],
]);

const getRequestErrorType = (response: Pick<Response, "locals">) => {
  const requestError = response.locals["requestError"];

  if (typeof requestError !== "object" || requestError === null) {
    return undefined;
  }

  const errorType = (requestError as Record<string, unknown>)["errorType"];

  return typeof errorType === "string" ? errorType : undefined;
};

export const getAttendanceCompletionTraceAttributes = (
  response: Pick<Response, "locals" | "statusCode">,
): AttendanceTraceAttributes => {
  if (response.statusCode < 400) {
    return { "attendance.outcome": "success" };
  }

  const errorType = getRequestErrorType(response);

  if (errorType === undefined) {
    return {};
  }

  const outcome = attendanceOutcomeByErrorType.get(errorType);

  if (outcome === undefined) {
    return {};
  }

  return { "attendance.outcome": outcome };
};

const getQueryString = (req: Request, key: string) => {
  const value = req.query[key];

  return typeof value === "string" ? value : undefined;
};

const getRequestedWorkDate = (req: Request) =>
  getQueryString(req, "workDate") ?? getQueryString(req, "date");

export const getAttendanceListTraceAttributes = (req: Request): AttendanceTraceAttributes => ({
  "attendance.work_date": getRequestedWorkDate(req),
  "attendance.employee_filter_present": getQueryString(req, "employeeUserId") !== undefined,
  "attendance.booking_status_filter_present": getQueryString(req, "bookingStatus") !== undefined,
  "attendance.record_status_filter_present": getQueryString(req, "status") !== undefined,
});

export const getAttendanceFormOptionsTraceAttributes = (
  req: Request,
): AttendanceTraceAttributes => ({
  "attendance.work_date": getQueryString(req, "workDate"),
});

export const getAttendanceCalendarTraceAttributes = (req: Request): AttendanceTraceAttributes => {
  const workDate = getRequestedWorkDate(req);

  return {
    "attendance.calendar.view": getQueryString(req, "view"),
    "attendance.date_range.start": getQueryString(req, "fromWorkDate") ?? workDate,
    "attendance.date_range.end": getQueryString(req, "toWorkDate") ?? workDate,
  };
};

export const getAttendanceTestDataTraceAttributes = (req: Request): AttendanceTraceAttributes => ({
  "attendance.work_date": getQueryString(req, "workDate"),
});

const getAttendanceIdFromUrlPath = (req: Request) => {
  const attendanceId = req.params["attendanceId"];

  if (typeof attendanceId !== "string" || attendanceId.length === 0) {
    return undefined;
  }

  return attendanceId;
};

export const getAttendanceRootSpanAttributes = (
  req: Request,
  options: Pick<AttendanceObservabilityOptions, "getAttributes" | "operation">,
): AttendanceTraceAttributes => {
  const attributes: AttendanceTraceAttributes = {};
  let operationAttributes: AttendanceTraceAttributes | undefined;

  if (options.getAttributes !== undefined) {
    operationAttributes = options.getAttributes(req);
  }

  if (operationAttributes !== undefined) {
    Object.assign(attributes, operationAttributes);
  }

  attributes["app.domain"] = ATTENDANCE_TRACE_DOMAIN;
  attributes["app.operation"] = options.operation;

  const storeId = getStoreIdFromUrlPath(req);
  if (storeId !== undefined) {
    attributes["app.store_id"] = storeId;
  }

  const attendanceId = getAttendanceIdFromUrlPath(req);
  if (attendanceId !== undefined) {
    attributes["attendance.id"] = attendanceId;
  }

  return attributes;
};

export const setActiveAttendanceSpanAttributes = (attributes: AttendanceTraceAttributes) => {
  const span = trace.getActiveSpan();

  if (span === undefined) {
    return;
  }

  setAttendanceSpanAttributes(span, attributes);
};

export const setAttendanceResponseCacheStatus = (response: Pick<Response, "statusCode">) => {
  if (response.statusCode === 304) {
    setActiveAttendanceSpanAttributes({ "cache.status": "not_modified" });
  }
};

export const addActiveAttendanceSpanEvent = (
  eventName: string,
  attributes: AttendanceTraceAttributes = {},
) => {
  const span = trace.getActiveSpan();

  if (span === undefined) {
    return;
  }

  span.addEvent(eventName, filterAttendanceTraceAttributes(attributes));
};

export const withAttendanceSpan = <T>(
  spanName: string,
  attributes: AttendanceTraceAttributes,
  handler: () => Promise<T>,
): Promise<T> =>
  withAppSpan(spanName, filterAttendanceTraceAttributes(attributes), () => handler());

const setAttendanceActorRole = () => {
  setActiveAttendanceSpanAttributes({
    "actor.role": getRequestContext()?.role,
  });
};

export const observeAttendanceHandler = (
  options: AttendanceObservabilityOptions,
  handler: AttendanceHandler,
): AttendanceHandler =>
  observeBusinessHandler(
    {
      eventName: options.spanName,
      route: options.route,
      domain: ATTENDANCE_TRACE_DOMAIN,
    },
    async (req, res) => {
      setActiveAttendanceSpanAttributes(getAttendanceRootSpanAttributes(req, options));

      try {
        const result = await handler(req, res);
        setActiveAttendanceSpanAttributes(getAttendanceCompletionTraceAttributes(res));
        return result;
      } finally {
        setAttendanceActorRole();
      }
    },
  );
