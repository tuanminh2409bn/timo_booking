import type { Firestore } from "@google-cloud/firestore";
import {
  setActiveDataRetentionSpanAttributes,
  withDataRetentionSpan,
} from "../../../business/data-retention/data-retention-observability.js";
import {
  DATA_RETENTION_TRACE_CHILD_SPANS,
  DATA_RETENTION_TRACE_EVENTS,
} from "../../../business/data-retention/data-retention-tracing-contract.js";
import { getStoreSubcollection } from "../collection-paths.js";
import {
  countQuery,
  createCleanupTraceCounts,
  recordCommittedStage,
  runCleanupScan,
  runWithCleanupFailureContext,
  type StoreCleanupTraceState,
  type StoreDataRetentionInput,
  type StoreDataRetentionResult,
} from "./data-retention-cleanup-shared.js";

const EMPLOYEE_WORK_DAY_CLOSINGS_SUBCOLLECTION = "employee_work_day_closings";
const EMPLOYEE_CLOSING_PAGE_SIZE = 400;

export const runEmployeeClosingRetention = async (
  firestoreDB: Firestore,
  input: StoreDataRetentionInput,
  result: StoreDataRetentionResult,
  state: StoreCleanupTraceState,
  dryRun: boolean,
) => {
  const closingCollection = getStoreSubcollection(
    firestoreDB,
    input.storeId,
    EMPLOYEE_WORK_DAY_CLOSINGS_SUBCOLLECTION,
  );
  const expiredClosingQuery = closingCollection.where("workDate", "<", input.cutoffWorkDate);
  const counts = createCleanupTraceCounts();

  await runCleanupScan(
    DATA_RETENTION_TRACE_CHILD_SPANS.employeeClosingScan,
    {
      "app.store_id": input.storeId,
      "retention.cutoff_work_date": input.cutoffWorkDate,
    },
    counts,
    dryRun,
    async () => {
      if (dryRun) {
        const count = await countQuery(expiredClosingQuery);
        counts.candidateCount = count;
        counts.eligibleCount = count;
        result.employeeWorkDayClosingsDeleted = count;
        return;
      }

      while (true) {
        const snapshot = await expiredClosingQuery
          .orderBy("workDate", "asc")
          .limit(EMPLOYEE_CLOSING_PAGE_SIZE)
          .get();
        counts.candidateCount += snapshot.size;

        if (snapshot.empty) {
          return;
        }

        const writeBatch = firestoreDB.batch();
        let writeCount = 0;

        for (const document of snapshot.docs) {
          const data = document.data() as Record<string, unknown>;

          if (document.updateTime === undefined) {
            counts.invalidDocumentCount += 1;
            continue;
          }

          if (data["ownerId"] !== input.ownerId || data["storeId"] !== input.storeId) {
            counts.skippedScopeCount += 1;
            continue;
          }

          counts.eligibleCount += 1;
          writeBatch.delete(document.ref, { lastUpdateTime: document.updateTime });
          writeCount += 1;
        }

        if (writeCount === 0) {
          return;
        }

        await withDataRetentionSpan(
          DATA_RETENTION_TRACE_CHILD_SPANS.employeeClosingBatchCommit,
          { "app.store_id": input.storeId },
          () =>
            runWithCleanupFailureContext(
              async () => {
                await writeBatch.commit();
                recordCommittedStage(
                  state,
                  "employee_closing_batch",
                  DATA_RETENTION_TRACE_EVENTS.employeeClosingBatchCommitted,
                  { "retention.eligible_count": writeCount },
                );
                setActiveDataRetentionSpanAttributes({
                  "retention.outcome": "success",
                  "retention.eligible_count": writeCount,
                });
              },
              state,
              "employee_closing_batch_commit",
            ),
        );
        counts.batchCount += 1;
        result.employeeWorkDayClosingsDeleted += writeCount;
      }
    },
    state,
    "employee_closing_scan",
  );
};
