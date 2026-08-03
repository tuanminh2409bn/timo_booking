import { FieldPath, FieldValue, type Firestore } from "@google-cloud/firestore";
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
  createCleanupTraceCounts,
  recordCommittedStage,
  runCleanupScan,
  runWithCleanupFailureContext,
  type StoreCleanupTraceState,
  type StoreDataRetentionInput,
  type StoreDataRetentionResult,
} from "./data-retention-cleanup-shared.js";

const WORK_DAY_SETTLEMENTS_SUBCOLLECTION = "work_day_settlements";
const SETTLEMENT_PAGE_SIZE = 400;

type SettlementCursor = {
  workDate: string;
  id: string;
};

export const runSettlementRetention = async (
  firestoreDB: Firestore,
  input: StoreDataRetentionInput,
  result: StoreDataRetentionResult,
  state: StoreCleanupTraceState,
  dryRun: boolean,
) => {
  const settlementCollection = getStoreSubcollection(
    firestoreDB,
    input.storeId,
    WORK_DAY_SETTLEMENTS_SUBCOLLECTION,
  );
  const counts = createCleanupTraceCounts();

  await runCleanupScan(
    DATA_RETENTION_TRACE_CHILD_SPANS.settlementScan,
    {
      "app.store_id": input.storeId,
      "retention.cutoff_work_date": input.cutoffWorkDate,
    },
    counts,
    dryRun,
    async () => {
      let cursor: SettlementCursor | undefined;

      while (true) {
        let query = settlementCollection
          .where("workDate", "<", input.cutoffWorkDate)
          .orderBy("workDate", "asc")
          .orderBy(FieldPath.documentId(), "asc")
          .limit(SETTLEMENT_PAGE_SIZE);

        if (cursor !== undefined) {
          query = query.startAfter(cursor.workDate, cursor.id);
        }

        const snapshot = await query.get();
        counts.candidateCount += snapshot.size;

        if (snapshot.empty) {
          return;
        }

        const writeBatch = firestoreDB.batch();
        let writeCount = 0;

        for (const document of snapshot.docs) {
          const data = document.data() as Record<string, unknown>;

          if (data["ownerId"] !== input.ownerId || data["storeId"] !== input.storeId) {
            counts.skippedScopeCount += 1;
            continue;
          }

          if (!("attendanceItems" in data)) {
            continue;
          }

          counts.eligibleCount += 1;
          writeCount += 1;

          if (!dryRun) {
            writeBatch.update(document.ref, { attendanceItems: FieldValue.delete() });
          }
        }

        if (!dryRun && writeCount > 0) {
          await withDataRetentionSpan(
            DATA_RETENTION_TRACE_CHILD_SPANS.settlementBatchCommit,
            { "app.store_id": input.storeId },
            () =>
              runWithCleanupFailureContext(
                async () => {
                  await writeBatch.commit();
                  recordCommittedStage(
                    state,
                    "settlement_batch",
                    DATA_RETENTION_TRACE_EVENTS.settlementBatchCommitted,
                    { "retention.eligible_count": writeCount },
                  );
                  setActiveDataRetentionSpanAttributes({
                    "retention.outcome": "success",
                    "retention.eligible_count": writeCount,
                  });
                },
                state,
                "settlement_batch_commit",
              ),
          );
          counts.batchCount += 1;
        }

        result.settlementDetailsStripped += writeCount;
        const lastDocument = snapshot.docs[snapshot.docs.length - 1];

        if (lastDocument === undefined || snapshot.size < SETTLEMENT_PAGE_SIZE) {
          return;
        }

        cursor = { workDate: String(lastDocument.get("workDate")), id: lastDocument.id };
      }
    },
    state,
    "settlement_scan",
  );
};
