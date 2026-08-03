import type { Query } from "@google-cloud/firestore";
import {
  addActiveDataRetentionSpanEvent,
  getDataRetentionErrorTraceContext,
  markDataRetentionErrorTraceContext,
  setActiveDataRetentionSpanAttributes,
  withDataRetentionSpan,
} from "../../../business/data-retention/data-retention-observability.js";
import {
  DATA_RETENTION_TRACE_CHILD_SPANS,
  DATA_RETENTION_TRACE_EVENTS,
  type DataRetentionTraceAttributes,
  type DataRetentionTraceChildSpan,
  type DataRetentionTraceEvent,
  type DataRetentionTraceFailurePhase,
  type DataRetentionTraceLastCommittedStage,
  type DataRetentionTraceOutcome,
} from "../../../business/data-retention/data-retention-tracing-contract.js";
import { invalidateAttendanceRetentionCaches } from "../shop/shop-attendance-factory.js";

export type StoreDataRetentionInput = {
  ownerId: string;
  storeId: string;
  cutoffWorkDate: string;
  dryRun?: boolean;
  batchSize?: number;
};

export type StoreDataRetentionResult = {
  attendanceDetailsDeleted: number;
  customerCountersArchived: number;
  settlementDetailsStripped: number;
  employeeWorkDayClosingsDeleted: number;
  lastCommittedStage?: DataRetentionTraceLastCommittedStage;
};

export type CleanupTraceCounts = {
  candidateCount: number;
  eligibleCount: number;
  skippedScopeCount: number;
  invalidDocumentCount: number;
  batchCount: number;
  retryCount: number;
};

export type StoreCleanupTraceState = {
  lastCommittedStage: DataRetentionTraceLastCommittedStage;
};

type CleanupFailureOutcome = Extract<
  DataRetentionTraceOutcome,
  "dependency_failure" | "post_write_failure" | "batch_retry_exhausted"
>;

export const createCleanupTraceCounts = (): CleanupTraceCounts => ({
  candidateCount: 0,
  eligibleCount: 0,
  skippedScopeCount: 0,
  invalidDocumentCount: 0,
  batchCount: 0,
  retryCount: 0,
});

export const createStoreDataRetentionResult = (): StoreDataRetentionResult => ({
  attendanceDetailsDeleted: 0,
  customerCountersArchived: 0,
  settlementDetailsStripped: 0,
  employeeWorkDayClosingsDeleted: 0,
  lastCommittedStage: "none",
});

export const createStoreCleanupTraceState = (): StoreCleanupTraceState => ({
  lastCommittedStage: "none",
});

const getCleanupOutcome = (eligibleCount: number, dryRun: boolean): DataRetentionTraceOutcome => {
  if (eligibleCount === 0) {
    return "no_eligible_detail";
  }

  return dryRun ? "dry_run_success" : "success";
};

const setCleanupTraceCounts = (counts: CleanupTraceCounts, dryRun: boolean, completed: boolean) => {
  setActiveDataRetentionSpanAttributes({
    "retention.candidate_count": counts.candidateCount,
    "retention.eligible_count": counts.eligibleCount,
    "retention.skipped_scope_count": counts.skippedScopeCount,
    "retention.invalid_document_count": counts.invalidDocumentCount,
    "retention.batch_count": counts.batchCount,
    "retention.retry_count": counts.retryCount,
    ...(completed && { "retention.outcome": getCleanupOutcome(counts.eligibleCount, dryRun) }),
  });
};

export const markStoreCleanupFailure = (
  error: unknown,
  state: StoreCleanupTraceState,
  failurePhase: DataRetentionTraceFailurePhase,
  outcome: CleanupFailureOutcome = "dependency_failure",
) => {
  markDataRetentionErrorTraceContext(error, {
    outcome,
    failurePhase,
    lastCommittedStage: state.lastCommittedStage,
  });
  setActiveDataRetentionSpanAttributes({
    "retention.outcome": outcome,
    "retention.failure_phase": failurePhase,
    "retention.last_committed_stage": state.lastCommittedStage,
  });
};

export const runWithCleanupFailureContext = async <T>(
  operation: () => Promise<T>,
  state: StoreCleanupTraceState,
  failurePhase: DataRetentionTraceFailurePhase,
  outcome: CleanupFailureOutcome = "dependency_failure",
  onFailure?: () => void,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    onFailure?.();
    if (getDataRetentionErrorTraceContext(error) === undefined) {
      markStoreCleanupFailure(error, state, failurePhase, outcome);
    }

    throw error;
  }
};

export const runCleanupScan = async (
  spanName: DataRetentionTraceChildSpan,
  attributes: DataRetentionTraceAttributes,
  counts: CleanupTraceCounts,
  dryRun: boolean,
  operation: () => Promise<void>,
  state: StoreCleanupTraceState,
  failurePhase: DataRetentionTraceFailurePhase,
) =>
  withDataRetentionSpan(spanName, attributes, async () => {
    let completed = false;

    try {
      await runWithCleanupFailureContext(operation, state, failurePhase);
      completed = true;
    } finally {
      setCleanupTraceCounts(counts, dryRun, completed);
    }
  });

export const recordCommittedStage = (
  state: StoreCleanupTraceState,
  stage: DataRetentionTraceLastCommittedStage,
  eventName: DataRetentionTraceEvent,
  attributes: DataRetentionTraceAttributes,
) => {
  state.lastCommittedStage = stage;
  setActiveDataRetentionSpanAttributes({ "retention.last_committed_stage": stage });
  addActiveDataRetentionSpanEvent(eventName, attributes);
};

export const invalidateRetentionCaches = async (
  input: StoreDataRetentionInput,
  storeWorkDateKeys: Iterable<string>,
  state: StoreCleanupTraceState,
) =>
  withDataRetentionSpan(
    DATA_RETENTION_TRACE_CHILD_SPANS.cacheInvalidate,
    { "app.store_id": input.storeId },
    () =>
      runWithCleanupFailureContext(
        async () => {
          const cacheGroupCount = await invalidateAttendanceRetentionCaches(
            input.ownerId,
            input.storeId,
            storeWorkDateKeys,
          );
          recordCommittedStage(
            state,
            "cache_invalidation",
            DATA_RETENTION_TRACE_EVENTS.cacheInvalidationCompleted,
            {
              "cache.status": "completed",
              "retention.cache_group_count": cacheGroupCount,
            },
          );
          setActiveDataRetentionSpanAttributes({
            "cache.status": "completed",
            "retention.cache_group_count": cacheGroupCount,
            "retention.outcome": "success",
          });
        },
        state,
        "cache_invalidation",
        "post_write_failure",
        () => setActiveDataRetentionSpanAttributes({ "cache.status": "failed" }),
      ),
  );

export const countQuery = async (query: Query) => (await query.count().get()).data().count;

export const hasCleanupErrorContext = (error: unknown) =>
  getDataRetentionErrorTraceContext(error) !== undefined;
