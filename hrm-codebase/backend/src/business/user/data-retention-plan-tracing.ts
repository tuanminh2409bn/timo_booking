import type { Response } from "express";
import type { OwnerDataRetentionPlan } from "../../repository/firestore/user/user.types.js";
import type { DataRetentionPolicyUpdateOptions } from "../../repository/firestore/data-retention/data-retention.repository.js";
import {
  addActiveDataRetentionSpanEvent,
  markDataRetentionDependencyFailure,
  markDataRetentionPostWriteFailure,
  setActiveDataRetentionSpanAttributes,
  setDataRetentionLastCommittedStage,
  withDataRetentionSpan,
} from "../data-retention/data-retention-observability.js";
import {
  DATA_RETENTION_TRACE_CHILD_SPANS,
  DATA_RETENTION_TRACE_EVENTS,
  type DataRetentionTraceLastCommittedStage,
} from "../data-retention/data-retention-tracing-contract.js";

type PolicyWriteTraceState = {
  committed: boolean;
  cacheInvalidated: boolean;
};

export type DataRetentionPolicyWriteTrace = {
  state: PolicyWriteTraceState;
  options: DataRetentionPolicyUpdateOptions;
};

export const createDataRetentionPolicyWriteTrace = (
  response: Pick<Response, "locals">,
  plan: OwnerDataRetentionPlan,
  planChanged: boolean,
  commitStage: Extract<
    DataRetentionTraceLastCommittedStage,
    "policy_initialized" | "policy_updated"
  >,
): DataRetentionPolicyWriteTrace => {
  const state: PolicyWriteTraceState = {
    committed: false,
    cacheInvalidated: false,
  };
  const commitEvent =
    commitStage === "policy_initialized"
      ? DATA_RETENTION_TRACE_EVENTS.policyInitialized
      : DATA_RETENTION_TRACE_EVENTS.policyCommitted;

  const options: DataRetentionPolicyUpdateOptions = {
    onCommitted: () => {
      state.committed = true;
      setDataRetentionLastCommittedStage(response, commitStage);
      addActiveDataRetentionSpanEvent(commitEvent, {
        "retention.plan": plan,
        "retention.plan_changed": planChanged,
      });
    },
    runSigninCacheInvalidation: (invalidate) =>
      withDataRetentionSpan(DATA_RETENTION_TRACE_CHILD_SPANS.planCacheInvalidate, {}, async () => {
        try {
          await invalidate();
          state.cacheInvalidated = true;
          setDataRetentionLastCommittedStage(response, "cache_invalidation");
          setActiveDataRetentionSpanAttributes({ "cache.status": "completed" });
          addActiveDataRetentionSpanEvent(DATA_RETENTION_TRACE_EVENTS.cacheInvalidationCompleted, {
            "cache.status": "completed",
          });
        } catch (error) {
          setActiveDataRetentionSpanAttributes({ "cache.status": "failed" });
          throw error;
        }
      }),
  };

  return { state, options };
};

export const markDataRetentionPolicyWriteFailure = (
  response: Pick<Response, "locals">,
  trace: DataRetentionPolicyWriteTrace,
  failureBeforeCommit: "policy_initialize" | "policy_persist",
) => {
  if (!trace.state.committed) {
    markDataRetentionDependencyFailure(response, failureBeforeCommit);
    return;
  }

  const commitStage =
    failureBeforeCommit === "policy_initialize" ? "policy_initialized" : "policy_updated";

  if (!trace.state.cacheInvalidated) {
    markDataRetentionPostWriteFailure(response, "cache_invalidation", commitStage);
    return;
  }

  markDataRetentionPostWriteFailure(response, failureBeforeCommit, "cache_invalidation");
};
