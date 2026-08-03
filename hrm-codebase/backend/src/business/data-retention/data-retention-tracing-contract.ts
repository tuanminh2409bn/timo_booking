import type { Span } from "@opentelemetry/api";
import { isValidWorkDate } from "../../helpers/verify-work-date.js";
import { setAppSpanAttributes, type AppSpanAttributeValue } from "../../modules/tracing.js";

export const DATA_RETENTION_TRACE_DOMAIN = "data_retention";

export const DATA_RETENTION_TRACE_SPANS = {
  planRead: "data_retention.plan.read",
  planUpdate: "data_retention.plan.update",
  jobRun: "data_retention.job.run",
} as const;

export const DATA_RETENTION_TRACE_OPERATIONS = {
  planRead: "plan_read",
  planUpdate: "plan_update",
  jobRun: "job_run",
} as const;

export const DATA_RETENTION_TRACE_CHILD_SPANS = {
  scopeResolve: "data_retention.scope.resolve",
  policyLoad: "data_retention.policy.load",
  policyInitialize: "data_retention.policy.initialize",
  policyPersist: "data_retention.policy.persist",
  planCacheInvalidate: "data_retention.plan.cache.invalidate",
  auditWrite: "data_retention.audit.write",
  ownerScan: "data_retention.owner.scan",
  storeList: "data_retention.store.list",
  storeProcess: "data_retention.store.process",
  attendanceScan: "data_retention.attendance.scan",
  attendanceBatchCommit: "data_retention.attendance.batch.commit",
  settlementScan: "data_retention.settlement.scan",
  settlementBatchCommit: "data_retention.settlement.batch.commit",
  employeeClosingScan: "data_retention.employee_closing.scan",
  employeeClosingBatchCommit: "data_retention.employee_closing.batch.commit",
  cacheInvalidate: "data_retention.cache.invalidate",
} as const;

export const DATA_RETENTION_TRACE_EVENTS = {
  policyInitialized: "data_retention.policy_initialized",
  policyCommitted: "data_retention.policy_committed",
  attendanceBatchCommitted: "data_retention.attendance_batch_committed",
  settlementBatchCommitted: "data_retention.settlement_batch_committed",
  employeeClosingBatchCommitted: "data_retention.employee_closing_batch_committed",
  cacheInvalidationCompleted: "data_retention.cache_invalidation_completed",
} as const;

export const DATA_RETENTION_TRACE_OUTCOMES = [
  "success",
  "dry_run_success",
  "idempotent_replay",
  "invalid_payload",
  "payment_required",
  "forbidden_role",
  "legacy_policy_initialized",
  "skipped_premium",
  "skipped_grace_period",
  "no_eligible_detail",
  "dependency_failure",
  "post_write_failure",
  "batch_retry_exhausted",
] as const;

export const DATA_RETENTION_TRACE_FAILURE_PHASES = [
  "auth",
  "policy_load",
  "policy_initialize",
  "policy_persist",
  "store_list",
  "work_date_resolve",
  "attendance_scan",
  "attendance_batch_commit",
  "settlement_scan",
  "settlement_batch_commit",
  "employee_closing_scan",
  "employee_closing_batch_commit",
  "cache_invalidation",
  "audit",
] as const;

export const DATA_RETENTION_TRACE_LAST_COMMITTED_STAGES = [
  "none",
  "policy_initialized",
  "policy_updated",
  "attendance_batch",
  "settlement_batch",
  "employee_closing_batch",
  "cache_invalidation",
  "audit",
] as const;

export const DATA_RETENTION_TRACE_ATTRIBUTE_KEYS = [
  "app.domain",
  "app.operation",
  "app.store_id",
  "actor.role",
  "retention.outcome",
  "retention.failure_phase",
  "retention.last_committed_stage",
  "retention.execution_mode",
  "retention.plan",
  "retention.plan_changed",
  "retention.grace_period_active",
  "retention.current_work_date",
  "retention.cutoff_work_date",
  "retention.batch_size",
  "retention.owner_count",
  "retention.owners_initialized",
  "retention.owners_premium",
  "retention.owners_in_grace_period",
  "retention.standard_owners_processed",
  "retention.store_count",
  "retention.stores_processed",
  "retention.candidate_count",
  "retention.eligible_count",
  "retention.skipped_scope_count",
  "retention.invalid_document_count",
  "retention.batch_count",
  "retention.retry_count",
  "retention.attendance_deleted_count",
  "retention.customer_counters_archived_count",
  "retention.settlement_details_stripped_count",
  "retention.employee_closings_deleted_count",
  "retention.cache_group_count",
  "cache.status",
  "retention.duration_bucket",
] as const;

export type DataRetentionTraceSpan =
  (typeof DATA_RETENTION_TRACE_SPANS)[keyof typeof DATA_RETENTION_TRACE_SPANS];
export type DataRetentionTraceOperation =
  (typeof DATA_RETENTION_TRACE_OPERATIONS)[keyof typeof DATA_RETENTION_TRACE_OPERATIONS];
export type DataRetentionTraceChildSpan =
  (typeof DATA_RETENTION_TRACE_CHILD_SPANS)[keyof typeof DATA_RETENTION_TRACE_CHILD_SPANS];
export type DataRetentionTraceEvent =
  (typeof DATA_RETENTION_TRACE_EVENTS)[keyof typeof DATA_RETENTION_TRACE_EVENTS];
export type DataRetentionTraceOutcome = (typeof DATA_RETENTION_TRACE_OUTCOMES)[number];
export type DataRetentionTraceFailurePhase = (typeof DATA_RETENTION_TRACE_FAILURE_PHASES)[number];
export type DataRetentionTraceLastCommittedStage =
  (typeof DATA_RETENTION_TRACE_LAST_COMMITTED_STAGES)[number];
export type DataRetentionTraceAttributeKey = (typeof DATA_RETENTION_TRACE_ATTRIBUTE_KEYS)[number];
export type DataRetentionTraceAttributes = Partial<
  Record<DataRetentionTraceAttributeKey, AppSpanAttributeValue | undefined>
>;
export type FilteredDataRetentionTraceAttributes = Partial<
  Record<DataRetentionTraceAttributeKey, AppSpanAttributeValue>
>;

const attributeKeySet = new Set<string>(DATA_RETENTION_TRACE_ATTRIBUTE_KEYS);
const numericAttributeKeys = new Set<DataRetentionTraceAttributeKey>([
  "retention.batch_size",
  "retention.owner_count",
  "retention.owners_initialized",
  "retention.owners_premium",
  "retention.owners_in_grace_period",
  "retention.standard_owners_processed",
  "retention.store_count",
  "retention.stores_processed",
  "retention.candidate_count",
  "retention.eligible_count",
  "retention.skipped_scope_count",
  "retention.invalid_document_count",
  "retention.batch_count",
  "retention.retry_count",
  "retention.attendance_deleted_count",
  "retention.customer_counters_archived_count",
  "retention.settlement_details_stripped_count",
  "retention.employee_closings_deleted_count",
  "retention.cache_group_count",
]);
const booleanAttributeKeys = new Set<DataRetentionTraceAttributeKey>([
  "retention.plan_changed",
  "retention.grace_period_active",
]);
const enumAttributeValues: Partial<Record<DataRetentionTraceAttributeKey, ReadonlySet<string>>> = {
  "app.domain": new Set([DATA_RETENTION_TRACE_DOMAIN]),
  "app.operation": new Set(Object.values(DATA_RETENTION_TRACE_OPERATIONS)),
  "actor.role": new Set(["owner", "system"]),
  "retention.outcome": new Set(DATA_RETENTION_TRACE_OUTCOMES),
  "retention.failure_phase": new Set(DATA_RETENTION_TRACE_FAILURE_PHASES),
  "retention.last_committed_stage": new Set(DATA_RETENTION_TRACE_LAST_COMMITTED_STAGES),
  "retention.execution_mode": new Set(["dry_run", "execute"]),
  "retention.plan": new Set(["standard", "premium"]),
  "cache.status": new Set(["hit", "miss", "bypass", "completed", "failed"]),
  "retention.duration_bucket": new Set(["under_100ms", "100ms_to_1s", "1s_to_5s", "over_5s"]),
};
const storeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const isTraceAttributeKey = (key: string): key is DataRetentionTraceAttributeKey =>
  attributeKeySet.has(key);

const isValidStringAttribute = (key: DataRetentionTraceAttributeKey, value: string): boolean => {
  if (
    value.length === 0 ||
    value.length > 128 ||
    numericAttributeKeys.has(key) ||
    booleanAttributeKeys.has(key)
  ) {
    return false;
  }

  if (key === "app.store_id") {
    return storeIdPattern.test(value);
  }

  if (key === "retention.current_work_date" || key === "retention.cutoff_work_date") {
    return isValidWorkDate(value);
  }

  const allowedValues = enumAttributeValues[key];
  return allowedValues === undefined || allowedValues.has(value);
};

const isValidNumberAttribute = (key: DataRetentionTraceAttributeKey, value: number): boolean => {
  if (!Number.isFinite(value) || !numericAttributeKeys.has(key) || !Number.isInteger(value)) {
    return false;
  }

  if (key === "retention.batch_size") {
    return value >= 1 && value <= 200;
  }

  return value >= 0;
};

const isValidAttributeValue = (
  key: DataRetentionTraceAttributeKey,
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

export const filterDataRetentionTraceAttributes = (
  attributes: Record<string, unknown>,
): FilteredDataRetentionTraceAttributes => {
  const safeAttributes: FilteredDataRetentionTraceAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (!isTraceAttributeKey(key) || !isValidAttributeValue(key, value)) {
      continue;
    }

    safeAttributes[key] = value;
  }

  return safeAttributes;
};

export const setDataRetentionSpanAttributes = (
  span: Span,
  attributes: DataRetentionTraceAttributes,
) => {
  setAppSpanAttributes(span, filterDataRetentionTraceAttributes(attributes));
};
