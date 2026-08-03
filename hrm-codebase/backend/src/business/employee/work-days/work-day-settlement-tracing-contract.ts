import type { Span } from "@opentelemetry/api";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { setAppSpanAttributes, type AppSpanAttributeValue } from "../../../modules/tracing.js";

export const WORK_DAY_SETTLEMENT_TRACE_DOMAIN = "work_day_settlement";

export const WORK_DAY_SETTLEMENT_TRACE_SPANS = {
  employeeClose: "work_day_settlement.employee.close",
  storeClose: "work_day_settlement.store.close",
} as const;

export const WORK_DAY_SETTLEMENT_TRACE_OPERATIONS = {
  employeeClose: "employee_close",
  storeClose: "store_close",
} as const;

export const WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS = {
  scopeResolve: "work_day_settlement.scope.resolve",
  contextLoad: "work_day_settlement.context.load",
  previewCalculate: "work_day_settlement.preview.calculate",
  snapshotSync: "work_day_settlement.snapshot.sync",
  employeeClosingPersist: "work_day_settlement.employee_closing.persist",
  aggregateMarkEmployeeClosed: "work_day_settlement.aggregate.mark_employee_closed",
  storeClosingPersist: "work_day_settlement.store_closing.persist",
  closedRecalculate: "work_day_settlement.closed.recalculate",
  cacheInvalidate: "work_day_settlement.cache.invalidate",
  auditWrite: "work_day_settlement.audit.write",
} as const;

export const WORK_DAY_SETTLEMENT_TRACE_EVENTS = {
  employeeClosingCommitted: "work_day_settlement.employee_closing_committed",
  aggregateEmployeeMarkCommitted: "work_day_settlement.aggregate_employee_mark_committed",
  aggregatePreparedCommitted: "work_day_settlement.aggregate_prepared_committed",
  storeClosingCommitted: "work_day_settlement.store_closing_committed",
  closedRecalculationCommitted: "work_day_settlement.closed_recalculation_committed",
  aggregateDeleted: "work_day_settlement.aggregate_deleted",
} as const;

export const WORK_DAY_SETTLEMENT_TRACE_OUTCOMES = [
  "success",
  "idempotent_replay",
  "invalid_payload",
  "forbidden_role",
  "forbidden_store",
  "already_closed",
  "dependency_failure",
  "post_write_failure",
  "concurrent_close_conflict",
  "employee_out_of_scope",
  "time_tracking_required",
  "check_out_required",
  "no_attendance",
  "attendance_incomplete",
  "booking_unresolved",
  "employee_closing_pending",
  "compensation_incomplete",
  "discount_allocation_invalid",
  "invalid_settlement_state",
  "negative_employee_earning",
  "snapshot_changed",
] as const;

export const WORK_DAY_SETTLEMENT_TRACE_SYNC_TRIGGERS = [
  "employee_close",
  "store_close",
  "online_booking",
  "attendance_create",
  "attendance_backfill",
  "attendance_update",
  "attendance_delete",
  "test_cleanup",
] as const;

export const WORK_DAY_SETTLEMENT_TRACE_PERSIST_ACTIONS = [
  "create",
  "overwrite",
  "delete",
  "skip",
] as const;

export const WORK_DAY_SETTLEMENT_TRACE_LAST_COMMITTED_STAGES = [
  "none",
  "employee_closing",
  "aggregate_mark",
  "aggregate_prepared",
  "store_closing",
  "closed_recalculation",
  "aggregate_deleted",
] as const;

export const WORK_DAY_SETTLEMENT_TRACE_POST_WRITE_PHASES = [
  "cache_invalidation",
  "audit",
  "aggregate_mark",
] as const;

export type WorkDaySettlementTraceOutcome = (typeof WORK_DAY_SETTLEMENT_TRACE_OUTCOMES)[number];
export type WorkDaySettlementTraceSpan =
  (typeof WORK_DAY_SETTLEMENT_TRACE_SPANS)[keyof typeof WORK_DAY_SETTLEMENT_TRACE_SPANS];
export type WorkDaySettlementTraceChildSpan =
  (typeof WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS)[keyof typeof WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS];
export type WorkDaySettlementTraceOperation =
  (typeof WORK_DAY_SETTLEMENT_TRACE_OPERATIONS)[keyof typeof WORK_DAY_SETTLEMENT_TRACE_OPERATIONS];
export type WorkDaySettlementTraceEvent =
  (typeof WORK_DAY_SETTLEMENT_TRACE_EVENTS)[keyof typeof WORK_DAY_SETTLEMENT_TRACE_EVENTS];
export type WorkDaySettlementTraceSyncTrigger =
  (typeof WORK_DAY_SETTLEMENT_TRACE_SYNC_TRIGGERS)[number];
export type WorkDaySettlementTracePersistAction =
  (typeof WORK_DAY_SETTLEMENT_TRACE_PERSIST_ACTIONS)[number];
export type WorkDaySettlementTraceLastCommittedStage =
  (typeof WORK_DAY_SETTLEMENT_TRACE_LAST_COMMITTED_STAGES)[number];
export type WorkDaySettlementTracePostWritePhase =
  (typeof WORK_DAY_SETTLEMENT_TRACE_POST_WRITE_PHASES)[number];

export const WORK_DAY_SETTLEMENT_TRACE_ATTRIBUTE_KEYS = [
  "app.domain",
  "app.operation",
  "app.store_id",
  "actor.role",
  "settlement.work_date",
  "settlement.scope",
  "settlement.outcome",
  "settlement.owner_discount_coverage_rate",
  "settlement.existing_status",
  "settlement.status.before",
  "settlement.status.after",
  "settlement.revision.before",
  "settlement.revision.after",
  "settlement.attendance_count",
  "settlement.eligible_attendance_count",
  "settlement.unresolved_booking_count",
  "settlement.incomplete_attendance_count",
  "settlement.responsible_employee_count",
  "settlement.submitted_employee_count",
  "settlement.pending_employee_count",
  "settlement.compensation_error_count",
  "settlement.unallocated_discount_present",
  "settlement.negative_employee_earning_present",
  "settlement.commission_employee_count",
  "settlement.fixed_employee_count",
  "settlement.hourly_employee_count",
  "settlement.employee_compensation_model",
  "settlement.time_tracking_status",
  "settlement.employee_closing_status",
  "settlement.idempotent_replay",
  "settlement.aggregate_present",
  "settlement.aggregate_mark_required",
  "settlement.snapshot_changed_during_close",
  "settlement.attendance_snapshot_changed",
  "settlement.employee_closing_snapshot_changed",
  "settlement.compensation_config_snapshot_changed",
  "settlement.sync_trigger",
  "settlement.persist_action",
  "settlement.last_committed_stage",
  "settlement.post_write_phase",
  "settlement.cache_group_count",
] as const;

export type WorkDaySettlementTraceAttributeKey =
  (typeof WORK_DAY_SETTLEMENT_TRACE_ATTRIBUTE_KEYS)[number];
export type WorkDaySettlementTraceAttributes = Partial<
  Record<WorkDaySettlementTraceAttributeKey, AppSpanAttributeValue | undefined>
>;
export type FilteredWorkDaySettlementTraceAttributes = Record<string, AppSpanAttributeValue>;

const attributeKeySet = new Set<string>(WORK_DAY_SETTLEMENT_TRACE_ATTRIBUTE_KEYS);
const numericAttributeKeys = new Set<WorkDaySettlementTraceAttributeKey>([
  "settlement.owner_discount_coverage_rate",
  "settlement.revision.before",
  "settlement.revision.after",
  "settlement.attendance_count",
  "settlement.eligible_attendance_count",
  "settlement.unresolved_booking_count",
  "settlement.incomplete_attendance_count",
  "settlement.responsible_employee_count",
  "settlement.submitted_employee_count",
  "settlement.pending_employee_count",
  "settlement.compensation_error_count",
  "settlement.commission_employee_count",
  "settlement.fixed_employee_count",
  "settlement.hourly_employee_count",
  "settlement.cache_group_count",
]);
const booleanAttributeKeys = new Set<WorkDaySettlementTraceAttributeKey>([
  "settlement.unallocated_discount_present",
  "settlement.negative_employee_earning_present",
  "settlement.idempotent_replay",
  "settlement.aggregate_present",
  "settlement.aggregate_mark_required",
  "settlement.snapshot_changed_during_close",
  "settlement.attendance_snapshot_changed",
  "settlement.employee_closing_snapshot_changed",
  "settlement.compensation_config_snapshot_changed",
]);
const enumAttributeValues: Partial<
  Record<WorkDaySettlementTraceAttributeKey, ReadonlySet<string>>
> = {
  "app.domain": new Set([WORK_DAY_SETTLEMENT_TRACE_DOMAIN]),
  "app.operation": new Set(Object.values(WORK_DAY_SETTLEMENT_TRACE_OPERATIONS)),
  "actor.role": new Set(["owner", "manager", "employee"]),
  "settlement.scope": new Set(["employee", "store"]),
  "settlement.outcome": new Set(WORK_DAY_SETTLEMENT_TRACE_OUTCOMES),
  "settlement.existing_status": new Set(["missing", "open", "ready", "closed"]),
  "settlement.status.before": new Set(["missing", "open", "ready", "closed"]),
  "settlement.status.after": new Set(["missing", "open", "ready", "closed"]),
  "settlement.employee_compensation_model": new Set(["commission", "fixed", "hourly"]),
  "settlement.time_tracking_status": new Set(["not_required", "missing", "working", "completed"]),
  "settlement.employee_closing_status": new Set(["missing", "stale", "current"]),
  "settlement.sync_trigger": new Set(WORK_DAY_SETTLEMENT_TRACE_SYNC_TRIGGERS),
  "settlement.persist_action": new Set(WORK_DAY_SETTLEMENT_TRACE_PERSIST_ACTIONS),
  "settlement.last_committed_stage": new Set(WORK_DAY_SETTLEMENT_TRACE_LAST_COMMITTED_STAGES),
  "settlement.post_write_phase": new Set(WORK_DAY_SETTLEMENT_TRACE_POST_WRITE_PHASES),
};
const discountCoverageRates = new Set([0, 50, 100]);

const isTraceAttributeKey = (key: string): key is WorkDaySettlementTraceAttributeKey =>
  attributeKeySet.has(key);

const isValidStringAttribute = (
  key: WorkDaySettlementTraceAttributeKey,
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

  if (key === "settlement.work_date") {
    return isValidWorkDate(value);
  }

  const allowedValues = enumAttributeValues[key];
  return allowedValues === undefined || allowedValues.has(value);
};

const isValidNumberAttribute = (
  key: WorkDaySettlementTraceAttributeKey,
  value: number,
): boolean => {
  if (!Number.isFinite(value) || !numericAttributeKeys.has(key)) {
    return false;
  }

  if (key === "settlement.owner_discount_coverage_rate") {
    return discountCoverageRates.has(value);
  }

  return Number.isInteger(value) && value >= 0;
};

const isValidTraceAttributeValue = (
  key: WorkDaySettlementTraceAttributeKey,
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

export const filterWorkDaySettlementTraceAttributes = (
  attributes: Record<string, unknown>,
): FilteredWorkDaySettlementTraceAttributes => {
  const safeAttributes: FilteredWorkDaySettlementTraceAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (!isTraceAttributeKey(key) || !isValidTraceAttributeValue(key, value)) {
      continue;
    }

    safeAttributes[key] = value;
  }

  return safeAttributes;
};

export const setWorkDaySettlementSpanAttributes = (
  span: Span,
  attributes: WorkDaySettlementTraceAttributes,
) => {
  setAppSpanAttributes(span, filterWorkDaySettlementTraceAttributes(attributes));
};
