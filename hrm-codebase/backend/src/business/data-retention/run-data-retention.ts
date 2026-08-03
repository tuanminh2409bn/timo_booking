import { resolveBusinessWorkDate } from "../../helpers/business-day.js";
import {
  addUtcCalendarMonths,
  resolveStandardRetentionCutoffWorkDate,
} from "../../helpers/data-retention.js";
import {
  getDataRetentionErrorTraceContext,
  markDataRetentionErrorFailurePhase,
  setActiveDataRetentionSpanAttributes,
  withDataRetentionSpan,
  addActiveDataRetentionSpanEvent,
} from "./data-retention-observability.js";
import {
  DATA_RETENTION_TRACE_CHILD_SPANS,
  DATA_RETENTION_TRACE_EVENTS,
  type DataRetentionTraceLastCommittedStage,
  type DataRetentionTraceOutcome,
} from "./data-retention-tracing-contract.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import type {
  OwnerDataRetentionPolicyRecord,
  OwnerDataRetentionPolicyUpdate,
  StoreDataRetentionResult,
} from "../../repository/firestore/data-retention/data-retention.repository.js";

export type DataRetentionRunSummary = StoreDataRetentionResult & {
  dryRun: boolean;
  ownersScanned: number;
  ownersInitialized: number;
  ownersPremium: number;
  ownersInGracePeriod: number;
  standardOwnersProcessed: number;
  storesProcessed: number;
  lastCommittedStage?: DataRetentionTraceLastCommittedStage;
};

type DataRetentionRunOptions = {
  now?: number;
  dryRun?: boolean;
  batchSize?: number;
};

export type DataRetentionRunDependencies = {
  listOwnerDataRetentionPolicies: typeof firestoreRepository.maintenance.listOwnerDataRetentionPolicies;
  updateOwnerDataRetentionPolicy: typeof firestoreRepository.maintenance.updateOwnerDataRetentionPolicy;
  getStoreListWithMetadata: typeof firestoreRepository.shop.store.getStoreListWithMetadata;
  runStoreDataRetention: typeof firestoreRepository.maintenance.runStoreDataRetention;
};

const getDefaultDependencies = (): DataRetentionRunDependencies => ({
  listOwnerDataRetentionPolicies: firestoreRepository.maintenance.listOwnerDataRetentionPolicies,
  updateOwnerDataRetentionPolicy: firestoreRepository.maintenance.updateOwnerDataRetentionPolicy,
  getStoreListWithMetadata: firestoreRepository.shop.store.getStoreListWithMetadata,
  runStoreDataRetention: firestoreRepository.maintenance.runStoreDataRetention,
});

const createSummary = (dryRun: boolean): DataRetentionRunSummary => ({
  dryRun,
  ownersScanned: 0,
  ownersInitialized: 0,
  ownersPremium: 0,
  ownersInGracePeriod: 0,
  standardOwnersProcessed: 0,
  storesProcessed: 0,
  lastCommittedStage: "none",
  attendanceDetailsDeleted: 0,
  customerCountersArchived: 0,
  settlementDetailsStripped: 0,
  employeeWorkDayClosingsDeleted: 0,
});

const addStoreResult = (
  summary: DataRetentionRunSummary,
  storeResult: StoreDataRetentionResult,
) => {
  summary.attendanceDetailsDeleted += storeResult.attendanceDetailsDeleted;
  summary.customerCountersArchived += storeResult.customerCountersArchived;
  summary.settlementDetailsStripped += storeResult.settlementDetailsStripped;
  summary.employeeWorkDayClosingsDeleted += storeResult.employeeWorkDayClosingsDeleted;

  if (storeResult.lastCommittedStage !== undefined && storeResult.lastCommittedStage !== "none") {
    summary.lastCommittedStage = storeResult.lastCommittedStage;
  }
};

const isLegacyPolicy = (policy: OwnerDataRetentionPolicyRecord): boolean =>
  policy.dataRetentionPlan === undefined ||
  policy.dataRetentionPlanChangedAt === undefined ||
  (policy.dataRetentionPlan === "standard" && policy.dataRetentionStandardEligibleAt === undefined);

const getOwnerScanOutcome = (
  summary: DataRetentionRunSummary,
  dryRun: boolean,
): DataRetentionTraceOutcome => {
  if (!dryRun && summary.ownersScanned > 0 && summary.ownersInitialized === summary.ownersScanned) {
    return "legacy_policy_initialized";
  }

  if (summary.ownersScanned > 0 && summary.ownersPremium === summary.ownersScanned) {
    return "skipped_premium";
  }

  if (summary.ownersScanned > 0 && summary.ownersInGracePeriod === summary.ownersScanned) {
    return "skipped_grace_period";
  }

  return dryRun ? "dry_run_success" : "success";
};

const getStoreOutcome = (
  result: StoreDataRetentionResult,
  dryRun: boolean,
): DataRetentionTraceOutcome => {
  const hasEligibleDetail =
    result.attendanceDetailsDeleted > 0 ||
    result.settlementDetailsStripped > 0 ||
    result.employeeWorkDayClosingsDeleted > 0;

  if (!hasEligibleDetail) {
    return "no_eligible_detail";
  }

  return dryRun ? "dry_run_success" : "success";
};

const getOwnerInitializationPatch = (
  policy: OwnerDataRetentionPolicyRecord,
  now: number,
): OwnerDataRetentionPolicyUpdate => {
  const plan = policy.dataRetentionPlan ?? "standard";
  const standardEligibleAt =
    plan === "premium"
      ? undefined
      : (policy.dataRetentionStandardEligibleAt ?? addUtcCalendarMonths(now, 2));

  return {
    dataRetentionPlan: plan,
    dataRetentionPlanChangedAt: policy.dataRetentionPlanChangedAt ?? now,
    ...(standardEligibleAt !== undefined && {
      dataRetentionStandardEligibleAt: standardEligibleAt,
    }),
    updatedAt: now,
    updatedByUserId: "system:data-retention",
  };
};

const scanOwnerPolicies = async (
  summary: DataRetentionRunSummary,
  options: DataRetentionRunOptions,
  dependencies: DataRetentionRunDependencies,
): Promise<OwnerDataRetentionPolicyRecord[]> =>
  withDataRetentionSpan(
    DATA_RETENTION_TRACE_CHILD_SPANS.ownerScan,
    {
      "retention.execution_mode": summary.dryRun ? "dry_run" : "execute",
      ...(options.batchSize !== undefined && { "retention.batch_size": options.batchSize }),
    },
    async () => {
      let policies: OwnerDataRetentionPolicyRecord[];

      try {
        policies = await withDataRetentionSpan(
          DATA_RETENTION_TRACE_CHILD_SPANS.policyLoad,
          {},
          dependencies.listOwnerDataRetentionPolicies,
        );
      } catch (error) {
        markDataRetentionErrorFailurePhase(error, "policy_load");
        setActiveDataRetentionSpanAttributes({
          "retention.outcome": "dependency_failure",
          "retention.failure_phase": "policy_load",
        });
        throw error;
      }

      summary.ownersScanned = policies.length;
      const eligiblePolicies: OwnerDataRetentionPolicyRecord[] = [];

      for (const policy of policies) {
        if (isLegacyPolicy(policy)) {
          summary.ownersInitialized += 1;

          if (!summary.dryRun) {
            await withDataRetentionSpan(
              DATA_RETENTION_TRACE_CHILD_SPANS.policyInitialize,
              { "retention.plan": policy.dataRetentionPlan ?? "standard" },
              async () => {
                try {
                  await dependencies.updateOwnerDataRetentionPolicy(
                    policy.uid,
                    getOwnerInitializationPatch(policy, options.now ?? Date.now()),
                  );
                  addActiveDataRetentionSpanEvent(DATA_RETENTION_TRACE_EVENTS.policyInitialized, {
                    "retention.plan": policy.dataRetentionPlan ?? "standard",
                  });
                } catch (error) {
                  markDataRetentionErrorFailurePhase(error, "policy_initialize");
                  setActiveDataRetentionSpanAttributes({
                    "retention.outcome": "dependency_failure",
                    "retention.failure_phase": "policy_initialize",
                  });
                  throw error;
                }
              },
            );
          }

          // Legacy owners receive a full grace period before any purge.
          continue;
        }

        if (policy.dataRetentionPlan === "premium") {
          summary.ownersPremium += 1;
          continue;
        }

        const eligibleAt = policy.dataRetentionStandardEligibleAt;

        if (eligibleAt === undefined || eligibleAt > (options.now ?? Date.now())) {
          summary.ownersInGracePeriod += 1;
          continue;
        }

        summary.standardOwnersProcessed += 1;
        eligiblePolicies.push(policy);
      }

      setActiveDataRetentionSpanAttributes({
        "retention.owner_count": summary.ownersScanned,
        "retention.owners_initialized": summary.ownersInitialized,
        "retention.owners_premium": summary.ownersPremium,
        "retention.owners_in_grace_period": summary.ownersInGracePeriod,
        "retention.standard_owners_processed": summary.standardOwnersProcessed,
        "retention.outcome": getOwnerScanOutcome(summary, summary.dryRun),
      });

      return eligiblePolicies;
    },
  );

const processOwnerStores = async (
  policy: OwnerDataRetentionPolicyRecord,
  summary: DataRetentionRunSummary,
  options: DataRetentionRunOptions,
  dependencies: DataRetentionRunDependencies,
) => {
  const storeList = await withDataRetentionSpan(
    DATA_RETENTION_TRACE_CHILD_SPANS.storeList,
    { "retention.plan": "standard" },
    async () => {
      try {
        const result = await dependencies.getStoreListWithMetadata(policy.ownerId);
        setActiveDataRetentionSpanAttributes({
          "retention.store_count": result.stores.length,
          "cache.status": result.cacheStatus,
          "retention.outcome": result.stores.length === 0 ? "no_eligible_detail" : "success",
        });
        return result;
      } catch (error) {
        markDataRetentionErrorFailurePhase(error, "store_list");
        setActiveDataRetentionSpanAttributes({
          "retention.outcome": "dependency_failure",
          "retention.failure_phase": "store_list",
        });
        throw error;
      }
    },
  );

  for (const store of storeList.stores) {
    await withDataRetentionSpan(
      DATA_RETENTION_TRACE_CHILD_SPANS.storeProcess,
      { "app.store_id": store.id },
      async () => {
        let currentWorkDate: string;
        let cutoffWorkDate: string;

        try {
          currentWorkDate = resolveBusinessWorkDate(options.now ?? Date.now(), {
            timeZone: store.timezone,
            settlementCutoffTime: store.settlementCutoffTime,
          });
          cutoffWorkDate = resolveStandardRetentionCutoffWorkDate(currentWorkDate);
        } catch (error) {
          markDataRetentionErrorFailurePhase(error, "work_date_resolve");
          setActiveDataRetentionSpanAttributes({
            "retention.outcome": "dependency_failure",
            "retention.failure_phase": "work_date_resolve",
          });
          throw error;
        }

        setActiveDataRetentionSpanAttributes({
          "retention.current_work_date": currentWorkDate,
          "retention.cutoff_work_date": cutoffWorkDate,
        });

        try {
          const storeResult = await dependencies.runStoreDataRetention({
            ownerId: policy.ownerId,
            storeId: store.id,
            cutoffWorkDate,
            dryRun: summary.dryRun,
            ...(options.batchSize !== undefined && { batchSize: options.batchSize }),
          });

          summary.storesProcessed += 1;
          addStoreResult(summary, storeResult);
          setActiveDataRetentionSpanAttributes({
            "retention.outcome": getStoreOutcome(storeResult, summary.dryRun),
            "retention.attendance_deleted_count": storeResult.attendanceDetailsDeleted,
            "retention.customer_counters_archived_count": storeResult.customerCountersArchived,
            "retention.settlement_details_stripped_count": storeResult.settlementDetailsStripped,
            "retention.employee_closings_deleted_count": storeResult.employeeWorkDayClosingsDeleted,
            ...(storeResult.lastCommittedStage !== undefined && {
              "retention.last_committed_stage": storeResult.lastCommittedStage,
            }),
          });
        } catch (error) {
          const errorTraceContext = getDataRetentionErrorTraceContext(error);
          setActiveDataRetentionSpanAttributes({
            "retention.outcome": errorTraceContext?.outcome ?? "dependency_failure",
            ...(errorTraceContext?.failurePhase !== undefined && {
              "retention.failure_phase": errorTraceContext.failurePhase,
            }),
            ...(errorTraceContext?.lastCommittedStage !== undefined && {
              "retention.last_committed_stage": errorTraceContext.lastCommittedStage,
            }),
          });
          throw error;
        }
      },
    );
  }
};

export const runDataRetention = async (
  options: DataRetentionRunOptions = {},
  dependencies: DataRetentionRunDependencies = getDefaultDependencies(),
): Promise<DataRetentionRunSummary> => {
  const now = options.now ?? Date.now();
  const normalizedOptions = { ...options, now };
  const summary = createSummary(options.dryRun !== false);
  const eligiblePolicies = await scanOwnerPolicies(summary, normalizedOptions, dependencies);

  for (const policy of eligiblePolicies) {
    await processOwnerStores(policy, summary, normalizedOptions, dependencies);
  }

  return summary;
};
