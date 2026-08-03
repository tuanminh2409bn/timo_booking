import type { Span } from "@opentelemetry/api";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { setAppSpanAttributes, type AppSpanAttributeValue } from "../../../modules/tracing.js";

export const EMPLOYEE_TIME_TRACKING_TRACE_DOMAIN = "employee_time_tracking";

export const EMPLOYEE_TIME_TRACKING_TRACE_SPANS = {
  selfRead: "employee_time_tracking.self.read",
  selfUpdate: "employee_time_tracking.self.update",
  storeRead: "employee_time_tracking.store.read",
  storeUpdate: "employee_time_tracking.store.update",
} as const;

export const EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS = {
  scopeResolve: "employee_time_tracking.scope.resolve",
  contextLoad: "employee_time_tracking.context.load",
  sessionPersist: "employee_time_tracking.session.persist",
  cacheInvalidate: "employee_time_tracking.cache.invalidate",
  auditWrite: "employee_time_tracking.audit.write",
  rosterLoad: "employee_time_tracking.roster.load",
  rosterSessionsLoad: "employee_time_tracking.roster_sessions.load",
} as const;

export const EMPLOYEE_TIME_TRACKING_TRACE_EVENTS = {
  sessionCommitted: "employee_time_tracking.session_committed",
} as const;

export const EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS = {
  selfRead: "self_read",
  selfUpdate: "self_update",
  storeRead: "store_read",
  storeUpdate: "store_update",
} as const;

export const EMPLOYEE_TIME_TRACKING_TRACE_OUTCOMES = [
  "success",
  "invalid_payload",
  "forbidden_role",
  "forbidden_store",
  "employee_out_of_scope",
  "non_hourly_employee",
  "pending_checkout_required",
  "already_checked_in",
  "already_completed",
  "not_checked_in",
  "invalid_checkout_time",
  "concurrent_state_conflict",
  "post_write_failure",
  "dependency_failure",
] as const;

export const EMPLOYEE_TIME_TRACKING_TRACE_POST_WRITE_PHASES = [
  "cache_invalidation",
  "audit",
] as const;

export const EMPLOYEE_TIME_TRACKING_TRACE_ATTRIBUTE_KEYS = [
  "app.domain",
  "app.operation",
  "app.store_id",
  "actor.role",
  "time_tracking.scope",
  "time_tracking.action",
  "time_tracking.work_date",
  "time_tracking.outcome",
  "time_tracking.compensation_model",
  "time_tracking.current_status",
  "time_tracking.status.before",
  "time_tracking.status.after",
  "time_tracking.pending_checkout_present",
  "time_tracking.pending_checkout_count",
  "time_tracking.manual_checkout",
  "time_tracking.duration_bucket",
  "time_tracking.persist_action",
  "time_tracking.last_committed_stage",
  "time_tracking.post_write_phase",
  "time_tracking.roster_employee_count",
  "time_tracking.hourly_employee_count",
  "time_tracking.roster_session_read_count",
  "time_tracking.not_started_count",
  "time_tracking.working_count",
  "time_tracking.completed_count",
  "time_tracking.needs_checkout_count",
  "cache.group_count",
] as const;

export type EmployeeTimeTrackingTraceOutcome =
  (typeof EMPLOYEE_TIME_TRACKING_TRACE_OUTCOMES)[number];
export type EmployeeTimeTrackingTracePostWritePhase =
  (typeof EMPLOYEE_TIME_TRACKING_TRACE_POST_WRITE_PHASES)[number];
export type EmployeeTimeTrackingTraceOperation =
  (typeof EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS)[keyof typeof EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS];
export type EmployeeTimeTrackingTraceSpan =
  (typeof EMPLOYEE_TIME_TRACKING_TRACE_SPANS)[keyof typeof EMPLOYEE_TIME_TRACKING_TRACE_SPANS];
export type EmployeeTimeTrackingTraceChildSpan =
  (typeof EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS)[keyof typeof EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS];
export type EmployeeTimeTrackingTraceEvent =
  (typeof EMPLOYEE_TIME_TRACKING_TRACE_EVENTS)[keyof typeof EMPLOYEE_TIME_TRACKING_TRACE_EVENTS];
export type EmployeeTimeTrackingTraceAttributeKey =
  (typeof EMPLOYEE_TIME_TRACKING_TRACE_ATTRIBUTE_KEYS)[number];
export type EmployeeTimeTrackingTraceAttributes = Partial<
  Record<EmployeeTimeTrackingTraceAttributeKey, AppSpanAttributeValue | undefined>
>;
export type FilteredEmployeeTimeTrackingTraceAttributes = Partial<
  Record<EmployeeTimeTrackingTraceAttributeKey, AppSpanAttributeValue>
>;
export type EmployeeTimeTrackingDurationBucket =
  | "zero"
  | "under_2h"
  | "2h_to_8h"
  | "8h_to_12h"
  | "over_12h";
export type EmployeeTimeTrackingAction = "check_in" | "check_out";
export type EmployeeTimeTrackingCurrentStatus = "missing" | "working" | "completed";

const attributeKeySet = new Set<string>(EMPLOYEE_TIME_TRACKING_TRACE_ATTRIBUTE_KEYS);
const numericAttributeKeys = new Set<EmployeeTimeTrackingTraceAttributeKey>([
  "time_tracking.pending_checkout_count",
  "time_tracking.roster_employee_count",
  "time_tracking.hourly_employee_count",
  "time_tracking.roster_session_read_count",
  "time_tracking.not_started_count",
  "time_tracking.working_count",
  "time_tracking.completed_count",
  "time_tracking.needs_checkout_count",
  "cache.group_count",
]);
const booleanAttributeKeys = new Set<EmployeeTimeTrackingTraceAttributeKey>([
  "time_tracking.pending_checkout_present",
  "time_tracking.manual_checkout",
]);
const enumAttributeValues: Partial<
  Record<EmployeeTimeTrackingTraceAttributeKey, ReadonlySet<string>>
> = {
  "app.domain": new Set([EMPLOYEE_TIME_TRACKING_TRACE_DOMAIN]),
  "app.operation": new Set(Object.values(EMPLOYEE_TIME_TRACKING_TRACE_OPERATIONS)),
  "actor.role": new Set(["owner", "manager", "employee"]),
  "time_tracking.scope": new Set(["self", "store"]),
  "time_tracking.action": new Set(["read", "check_in", "check_out"]),
  "time_tracking.outcome": new Set(EMPLOYEE_TIME_TRACKING_TRACE_OUTCOMES),
  "time_tracking.compensation_model": new Set(["hourly", "non_hourly", "unknown"]),
  "time_tracking.current_status": new Set(["missing", "working", "completed"]),
  "time_tracking.status.before": new Set(["missing", "working", "completed"]),
  "time_tracking.status.after": new Set(["missing", "working", "completed"]),
  "time_tracking.duration_bucket": new Set([
    "zero",
    "under_2h",
    "2h_to_8h",
    "8h_to_12h",
    "over_12h",
  ]),
  "time_tracking.persist_action": new Set(["create", "update"]),
  "time_tracking.last_committed_stage": new Set(["session"]),
  "time_tracking.post_write_phase": new Set(EMPLOYEE_TIME_TRACKING_TRACE_POST_WRITE_PHASES),
};

const isAttributeKey = (key: string): key is EmployeeTimeTrackingTraceAttributeKey =>
  attributeKeySet.has(key);

const isValidStringAttribute = (
  key: EmployeeTimeTrackingTraceAttributeKey,
  value: string,
): boolean => {
  if (
    value.length === 0 ||
    value.length > 128 ||
    numericAttributeKeys.has(key) ||
    booleanAttributeKeys.has(key)
  ) {
    return false;
  }

  if (key === "time_tracking.work_date") {
    return isValidWorkDate(value);
  }

  const allowedValues = enumAttributeValues[key];
  return allowedValues === undefined || allowedValues.has(value);
};

const isValidNumberAttribute = (
  key: EmployeeTimeTrackingTraceAttributeKey,
  value: number,
): boolean =>
  Number.isFinite(value) && numericAttributeKeys.has(key) && Number.isInteger(value) && value >= 0;

const isValidAttributeValue = (
  key: EmployeeTimeTrackingTraceAttributeKey,
  value: unknown,
): value is AppSpanAttributeValue => {
  if (typeof value === "string") {
    return isValidStringAttribute(key, value);
  }

  if (typeof value === "number") {
    return isValidNumberAttribute(key, value);
  }

  return typeof value === "boolean" && booleanAttributeKeys.has(key);
};

export const filterEmployeeTimeTrackingTraceAttributes = (
  attributes: Record<string, unknown>,
): FilteredEmployeeTimeTrackingTraceAttributes => {
  const safeAttributes: FilteredEmployeeTimeTrackingTraceAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (!isAttributeKey(key) || !isValidAttributeValue(key, value)) {
      continue;
    }

    safeAttributes[key] = value;
  }

  return safeAttributes;
};

export const setEmployeeTimeTrackingSpanAttributes = (
  span: Span,
  attributes: EmployeeTimeTrackingTraceAttributes,
) => {
  setAppSpanAttributes(span, filterEmployeeTimeTrackingTraceAttributes(attributes));
};

export const getEmployeeTimeTrackingDurationBucket = (
  workedMinutes: number,
): EmployeeTimeTrackingDurationBucket | undefined => {
  if (!Number.isFinite(workedMinutes) || workedMinutes < 0) {
    return undefined;
  }

  if (workedMinutes === 0) {
    return "zero";
  }

  if (workedMinutes < 120) {
    return "under_2h";
  }

  if (workedMinutes <= 480) {
    return "2h_to_8h";
  }

  if (workedMinutes <= 720) {
    return "8h_to_12h";
  }

  return "over_12h";
};

export const getEmployeeTimeTrackingTransitionOutcome = (input: {
  action: EmployeeTimeTrackingAction;
  currentStatus: EmployeeTimeTrackingCurrentStatus;
  pendingCheckoutPresent?: boolean;
  checkoutTimeValid?: boolean;
}): EmployeeTimeTrackingTraceOutcome | undefined => {
  if (input.action === "check_in") {
    if (input.pendingCheckoutPresent === true) {
      return "pending_checkout_required";
    }

    if (input.currentStatus === "working") {
      return "already_checked_in";
    }

    if (input.currentStatus === "completed") {
      return "already_completed";
    }

    return undefined;
  }

  if (input.currentStatus !== "working") {
    return "not_checked_in";
  }

  if (input.checkoutTimeValid === false) {
    return "invalid_checkout_time";
  }

  return undefined;
};
