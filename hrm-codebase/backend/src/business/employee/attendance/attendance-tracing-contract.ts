import type { Span } from "@opentelemetry/api";
import { setAppSpanAttributes, type AppSpanAttributeValue } from "../../../modules/tracing.js";

export const ATTENDANCE_TRACE_DOMAIN = "attendance";

export const ATTENDANCE_TRACE_SPANS = {
  listRead: "attendance.list.read",
  formOptionsRead: "attendance.form_options.read",
  calendarRead: "attendance.calendar.read",
  detailRead: "attendance.detail.read",
  create: "attendance.create",
  backfill: "attendance.backfill",
  update: "attendance.update",
  testDataDelete: "attendance.test-data.delete",
  delete: "attendance.delete",
} as const;

export const ATTENDANCE_TRACE_OPERATIONS = {
  listRead: "list",
  formOptionsRead: "form_options",
  calendarRead: "calendar",
  detailRead: "detail",
  create: "create",
  backfill: "backfill",
  update: "update",
  testDataDelete: "test_data_delete",
  delete: "delete",
} as const;

export const ATTENDANCE_TRACE_CHILD_SPANS = {
  scopeResolve: "attendance.scope.resolve",
  attendanceLoad: "attendance.load",
  contextLoad: "attendance.context.load",
  timeTrackingCheck: "attendance.time_tracking.check",
  workDayCheck: "attendance.work_day.check",
  customerResolve: "attendance.customer.resolve",
  persist: "attendance.persist",
  bookingPropagate: "attendance.booking.propagate",
  settlementRecalculate: "attendance.settlement.recalculate",
  settlementSync: "attendance.settlement.sync",
  auditWrite: "attendance.audit.write",
  bulkLoad: "attendance.bulk_load",
  bulkDelete: "attendance.bulk_delete",
  readSource: "attendance.read.source",
  cacheRead: "attendance.cache.read",
  cacheWrite: "attendance.cache.write",
  query: "attendance.query",
  cacheInvalidate: "attendance.cache.invalidate",
  cacheInvalidateDetached: "attendance.cache.invalidate.detached",
} as const;

export const ATTENDANCE_TRACE_EVENTS = {
  writeCommitted: "attendance.write_committed",
  cacheInvalidationScheduled: "attendance.cache_invalidation_scheduled",
} as const;

export const ATTENDANCE_TRACE_OUTCOMES = [
  "success",
  "invalid_payload",
  "forbidden_store",
  "forbidden_role",
  "invalid_service_reference",
  "invalid_assignee",
  "employee_time_tracking_required",
  "employee_main_assignee_required",
  "work_day_closed",
  "work_day_open",
  "past_window_exceeded",
  "confirmation_incomplete",
  "future_status_not_allowed",
  "future_booking_forbidden",
  "customer_blocked",
  "invalid_discount",
  "invalid_settlement_state",
  "attendance_locked",
  "data_inconsistent",
  "dependency_failure",
  "post_write_failure",
] as const;

export const ATTENDANCE_TRACE_ATTRIBUTE_KEYS = [
  "app.domain",
  "app.operation",
  "app.store_id",
  "actor.role",
  "attendance.id",
  "attendance.outcome",
  "attendance.source",
  "attendance.work_date",
  "attendance.work_date_relation",
  "attendance.is_future",
  "attendance.ready_for_confirmation",
  "attendance.customer_lookup_present",
  "attendance.rolled_work_date",
  "attendance.work_day_closed",
  "attendance.date_range.start",
  "attendance.date_range.end",
  "attendance.calendar.view",
  "attendance.employee_filter_present",
  "attendance.booking_status_filter_present",
  "attendance.record_status_filter_present",
  "attendance.booking_status.before",
  "attendance.booking_status.after",
  "attendance.record_status.before",
  "attendance.record_status.after",
  "attendance.main_assignee_present",
  "attendance.assistant_assignee_present",
  "attendance.service_count",
  "attendance.quick_draft",
  "attendance.closed_day_edit",
  "attendance.create_mode",
  "attendance.main_assignee_changed",
  "attendance.assistant_assignee_changed",
  "attendance.work_date_changed",
  "attendance.store_changed",
  "attendance.persist_action",
  "attendance.cleanup_scope",
  "attendance.matched_count",
  "attendance.deleted_count",
  "attendance.deleted_closing_count",
  "attendance.post_write_phase",
  "attendance.returned_count",
  "attendance.total_count",
  "attendance.open_count",
  "attendance.closed_count",
  "booking.id",
  "booking.sibling_count",
  "settlement.affected_date_count",
  "settlement.recalculated_date_count",
  "cache.status",
  "cache.single_flight_role",
  "cache.invalidation_scope",
  "query.strategy",
] as const;

export type AttendanceTraceAttributeKey = (typeof ATTENDANCE_TRACE_ATTRIBUTE_KEYS)[number];
export type AttendanceTraceOutcome = (typeof ATTENDANCE_TRACE_OUTCOMES)[number];
export type AttendanceTraceOperation =
  (typeof ATTENDANCE_TRACE_OPERATIONS)[keyof typeof ATTENDANCE_TRACE_OPERATIONS];
export type AttendanceTraceAttributes = Partial<
  Record<AttendanceTraceAttributeKey, AppSpanAttributeValue | undefined>
>;
export type FilteredAttendanceTraceAttributes = Record<string, AppSpanAttributeValue>;

const attendanceTraceAttributeKeySet = new Set<string>(ATTENDANCE_TRACE_ATTRIBUTE_KEYS);

const isAttendanceTraceAttributeKey = (key: string): key is AttendanceTraceAttributeKey =>
  attendanceTraceAttributeKeySet.has(key);

const isSupportedTraceAttributeValue = (value: unknown): value is AppSpanAttributeValue => {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  return typeof value === "string" || typeof value === "boolean";
};

export const filterAttendanceTraceAttributes = (
  attributes: Record<string, unknown>,
): FilteredAttendanceTraceAttributes => {
  const allowedAttributes: FilteredAttendanceTraceAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (!isAttendanceTraceAttributeKey(key)) {
      continue;
    }

    if (!isSupportedTraceAttributeValue(value)) {
      continue;
    }

    allowedAttributes[key] = value;
  }

  return allowedAttributes;
};

export const setAttendanceSpanAttributes = (span: Span, attributes: AttendanceTraceAttributes) => {
  setAppSpanAttributes(span, filterAttendanceTraceAttributes(attributes));
};
