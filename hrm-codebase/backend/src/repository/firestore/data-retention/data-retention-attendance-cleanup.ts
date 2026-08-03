import { FieldValue, type Firestore } from "@google-cloud/firestore";
import { createStoreWorkDateKey } from "../../../helpers/work-date-utils.js";
import { getStoreSubcollection } from "../collection-paths.js";
import { DEFAULT_BOOKING_STATUS, type ShopAttendanceBookingStatus } from "../shop/shop.types.js";
import {
  getDataRetentionErrorTraceContext,
  setActiveDataRetentionSpanAttributes,
  withDataRetentionSpan,
} from "../../../business/data-retention/data-retention-observability.js";
import {
  DATA_RETENTION_TRACE_CHILD_SPANS,
  DATA_RETENTION_TRACE_EVENTS,
  type DataRetentionTraceAttributes,
} from "../../../business/data-retention/data-retention-tracing-contract.js";
import {
  countQuery,
  createCleanupTraceCounts,
  invalidateRetentionCaches,
  markStoreCleanupFailure,
  recordCommittedStage,
  runCleanupScan,
  type StoreCleanupTraceState,
  type StoreDataRetentionInput,
  type StoreDataRetentionResult,
} from "./data-retention-cleanup-shared.js";

const ATTENDANCES_SUBCOLLECTION = "attendances";
const CUSTOMERS_SUBCOLLECTION = "customers";
const MAX_ATTENDANCE_RETRIES = 3;

export type ArchivedAttendanceCounterIncrement = {
  totalAppointments: number;
  requestedAppointments: number;
  confirmedAppointments: number;
  processingAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  completedAppointments: number;
};

const createEmptyCounterIncrement = (): ArchivedAttendanceCounterIncrement => ({
  totalAppointments: 0,
  requestedAppointments: 0,
  confirmedAppointments: 0,
  processingAppointments: 0,
  cancelledAppointments: 0,
  noShowAppointments: 0,
  completedAppointments: 0,
});

export const incrementArchivedAttendanceCounter = (
  counters: ArchivedAttendanceCounterIncrement,
  bookingStatus: ShopAttendanceBookingStatus = DEFAULT_BOOKING_STATUS,
  attendanceStatus: "open" | "closed" = "open",
) => {
  counters.totalAppointments += 1;

  if (bookingStatus === "requested") counters.requestedAppointments += 1;
  else if (bookingStatus === "processing") counters.processingAppointments += 1;
  else if (bookingStatus === "cancelled") counters.cancelledAppointments += 1;
  else if (bookingStatus === "no_show") counters.noShowAppointments += 1;
  else counters.confirmedAppointments += 1;

  if (
    attendanceStatus === "closed" &&
    bookingStatus !== "cancelled" &&
    bookingStatus !== "no_show"
  ) {
    counters.completedAppointments += 1;
  }
};

const getAttendanceBookingStatus = (data: Record<string, unknown>): ShopAttendanceBookingStatus => {
  const bookingStatus = data["bookingStatus"];

  if (
    bookingStatus === "requested" ||
    bookingStatus === "confirmed" ||
    bookingStatus === "processing" ||
    bookingStatus === "cancelled" ||
    bookingStatus === "no_show"
  ) {
    return bookingStatus;
  }

  return DEFAULT_BOOKING_STATUS;
};

const addArchivedCustomerCounterWrites = (
  firestoreDB: Firestore,
  storeId: string,
  writeBatch: ReturnType<Firestore["batch"]>,
  countersByCustomer: ReadonlyMap<string, ArchivedAttendanceCounterIncrement>,
) => {
  for (const [customerId, counters] of countersByCustomer) {
    const customerRef = getStoreSubcollection(firestoreDB, storeId, CUSTOMERS_SUBCOLLECTION).doc(
      customerId,
    );
    writeBatch.set(
      customerRef,
      {
        archivedAttendanceCounters: {
          totalAppointments: FieldValue.increment(counters.totalAppointments),
          requestedAppointments: FieldValue.increment(counters.requestedAppointments),
          confirmedAppointments: FieldValue.increment(counters.confirmedAppointments),
          processingAppointments: FieldValue.increment(counters.processingAppointments),
          cancelledAppointments: FieldValue.increment(counters.cancelledAppointments),
          noShowAppointments: FieldValue.increment(counters.noShowAppointments),
          completedAppointments: FieldValue.increment(counters.completedAppointments),
        },
        archivedAttendanceCountersUpdatedAt: Date.now(),
      },
      { merge: true },
    );
  }
};

const isRetryablePreconditionError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  ((error as { code?: number }).code === 9 || (error as { code?: number }).code === 10);

const commitAttendanceBatch = async (
  input: StoreDataRetentionInput,
  state: StoreCleanupTraceState,
  writeBatch: ReturnType<Firestore["batch"]>,
  attendanceWriteCount: number,
  customerCounterCount: number,
  deletedStoreWorkDateKeys: ReadonlySet<string>,
) =>
  withDataRetentionSpan(
    DATA_RETENTION_TRACE_CHILD_SPANS.attendanceBatchCommit,
    { "app.store_id": input.storeId },
    async () => {
      try {
        await writeBatch.commit();
        recordCommittedStage(
          state,
          "attendance_batch",
          DATA_RETENTION_TRACE_EVENTS.attendanceBatchCommitted,
          {
            "retention.eligible_count": attendanceWriteCount,
            "retention.customer_counters_archived_count": customerCounterCount,
          },
        );
        await invalidateRetentionCaches(input, deletedStoreWorkDateKeys, state);
        setActiveDataRetentionSpanAttributes({
          "retention.outcome": "success",
          "retention.eligible_count": attendanceWriteCount,
        });
      } catch (error) {
        if (getDataRetentionErrorTraceContext(error) === undefined) {
          setActiveDataRetentionSpanAttributes({
            "retention.outcome": "dependency_failure",
            "retention.failure_phase": "attendance_batch_commit",
          });
        }

        throw error;
      }
    },
  );

const createAttendanceScanAttributes = (
  input: StoreDataRetentionInput,
  batchSize: number,
): DataRetentionTraceAttributes => ({
  "app.store_id": input.storeId,
  "retention.cutoff_work_date": input.cutoffWorkDate,
  "retention.batch_size": batchSize,
});

export const runAttendanceRetention = async (
  firestoreDB: Firestore,
  input: StoreDataRetentionInput,
  result: StoreDataRetentionResult,
  state: StoreCleanupTraceState,
  dryRun: boolean,
  batchSize: number,
) => {
  const attendanceCollection = getStoreSubcollection(
    firestoreDB,
    input.storeId,
    ATTENDANCES_SUBCOLLECTION,
  );
  const expiredAttendanceQuery = attendanceCollection.where("workDate", "<", input.cutoffWorkDate);
  const counts = createCleanupTraceCounts();

  await runCleanupScan(
    DATA_RETENTION_TRACE_CHILD_SPANS.attendanceScan,
    createAttendanceScanAttributes(input, batchSize),
    counts,
    dryRun,
    async () => {
      if (dryRun) {
        const count = await countQuery(expiredAttendanceQuery);
        counts.candidateCount = count;
        counts.eligibleCount = count;
        result.attendanceDetailsDeleted = count;
        return;
      }

      let consecutiveRetryCount = 0;

      while (true) {
        const snapshot = await expiredAttendanceQuery
          .orderBy("workDate", "asc")
          .limit(batchSize)
          .get();
        counts.candidateCount += snapshot.size;

        if (snapshot.empty) {
          return;
        }

        const countersByCustomer = new Map<string, ArchivedAttendanceCounterIncrement>();
        const deletedStoreWorkDateKeys = new Set<string>();
        const writeBatch = firestoreDB.batch();
        let attendanceWriteCount = 0;

        for (const document of snapshot.docs) {
          const data = document.data() as Record<string, unknown>;
          const workDate = data["workDate"];

          if (typeof workDate !== "string" || document.updateTime === undefined) {
            counts.invalidDocumentCount += 1;
            continue;
          }

          if (
            data["ownerId"] !== input.ownerId ||
            data["storeId"] !== input.storeId ||
            workDate >= input.cutoffWorkDate
          ) {
            counts.skippedScopeCount += 1;
            continue;
          }

          counts.eligibleCount += 1;
          const customerId =
            typeof data["customerId"] === "string" ? data["customerId"] : undefined;

          if (customerId !== undefined) {
            const counters = countersByCustomer.get(customerId) ?? createEmptyCounterIncrement();
            incrementArchivedAttendanceCounter(
              counters,
              getAttendanceBookingStatus(data),
              data["status"] === "closed" ? "closed" : "open",
            );
            countersByCustomer.set(customerId, counters);
          }

          writeBatch.delete(document.ref, { lastUpdateTime: document.updateTime });
          deletedStoreWorkDateKeys.add(createStoreWorkDateKey(input.storeId, workDate));
          attendanceWriteCount += 1;
        }

        addArchivedCustomerCounterWrites(
          firestoreDB,
          input.storeId,
          writeBatch,
          countersByCustomer,
        );

        if (attendanceWriteCount === 0) {
          return;
        }

        let shouldRetry = false;

        try {
          await commitAttendanceBatch(
            input,
            state,
            writeBatch,
            attendanceWriteCount,
            countersByCustomer.size,
            deletedStoreWorkDateKeys,
          );
        } catch (error) {
          if (
            isRetryablePreconditionError(error) &&
            consecutiveRetryCount < MAX_ATTENDANCE_RETRIES
          ) {
            consecutiveRetryCount += 1;
            counts.retryCount += 1;
            shouldRetry = true;
          } else if (getDataRetentionErrorTraceContext(error) === undefined) {
            const outcome =
              isRetryablePreconditionError(error) && consecutiveRetryCount >= MAX_ATTENDANCE_RETRIES
                ? "batch_retry_exhausted"
                : "dependency_failure";
            markStoreCleanupFailure(error, state, "attendance_batch_commit", outcome);
          }

          if (!shouldRetry) {
            throw error;
          }
        }

        if (shouldRetry) {
          continue;
        }

        counts.batchCount += 1;
        result.attendanceDetailsDeleted += attendanceWriteCount;
        result.customerCountersArchived += countersByCustomer.size;
        consecutiveRetryCount = 0;
      }
    },
    state,
    "attendance_scan",
  );
};
