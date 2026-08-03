import {
  getDataRetentionErrorTraceContext,
  getDataRetentionJobRootSpanAttributes,
  setActiveDataRetentionSpanAttributes,
  withDataRetentionSpan,
} from "../business/data-retention/data-retention-observability.js";
import {
  DATA_RETENTION_TRACE_SPANS,
  type DataRetentionTraceOutcome,
  type DataRetentionTraceAttributes,
} from "../business/data-retention/data-retention-tracing-contract.js";
import {
  runDataRetention,
  type DataRetentionRunSummary,
} from "../business/data-retention/run-data-retention.js";
import { initTracing } from "../config/tracing.js";
import { logger } from "../modules/logger.js";

type DataRetentionTracingHandle = {
  enabled: boolean;
  shutdown: () => Promise<void>;
};

type DataRetentionJobLogger = {
  info: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
};

export type DataRetentionJobDependencies = {
  initTracing: () => DataRetentionTracingHandle;
  runDataRetention: typeof runDataRetention;
  logger: DataRetentionJobLogger;
};

type DataRetentionJobOptions = {
  environment?: Record<string, string | undefined>;
  dependencies?: DataRetentionJobDependencies;
};

const defaultDependencies: DataRetentionJobDependencies = {
  initTracing,
  runDataRetention,
  logger: {
    info: (context, message) => logger.info(context, message),
    error: (context, message) => logger.error(context, message),
    warn: (context, message) => logger.warn(context, message),
  },
};

export const parseDataRetentionBatchSize = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return undefined;
  }

  return Math.min(parsedValue, 200);
};

const getSummaryOutcome = (summary: DataRetentionRunSummary): DataRetentionTraceOutcome => {
  if (
    !summary.dryRun &&
    summary.ownersScanned > 0 &&
    summary.ownersInitialized === summary.ownersScanned
  ) {
    return "legacy_policy_initialized";
  }

  if (summary.ownersScanned > 0 && summary.ownersPremium === summary.ownersScanned) {
    return "skipped_premium";
  }

  if (summary.ownersScanned > 0 && summary.ownersInGracePeriod === summary.ownersScanned) {
    return "skipped_grace_period";
  }

  return summary.dryRun ? "dry_run_success" : "success";
};

const getSummaryTraceAttributes = (
  summary: DataRetentionRunSummary,
): DataRetentionTraceAttributes => ({
  "retention.outcome": getSummaryOutcome(summary),
  "retention.owner_count": summary.ownersScanned,
  "retention.owners_initialized": summary.ownersInitialized,
  "retention.owners_premium": summary.ownersPremium,
  "retention.owners_in_grace_period": summary.ownersInGracePeriod,
  "retention.standard_owners_processed": summary.standardOwnersProcessed,
  "retention.stores_processed": summary.storesProcessed,
  "retention.attendance_deleted_count": summary.attendanceDetailsDeleted,
  "retention.customer_counters_archived_count": summary.customerCountersArchived,
  "retention.settlement_details_stripped_count": summary.settlementDetailsStripped,
  "retention.employee_closings_deleted_count": summary.employeeWorkDayClosingsDeleted,
  ...(summary.lastCommittedStage !== undefined && {
    "retention.last_committed_stage": summary.lastCommittedStage,
  }),
});

const getErrorLogContext = (error: unknown): Record<string, unknown> => ({
  errorName: error instanceof Error ? error.name : "UnknownError",
  errorMessage: error instanceof Error ? error.message : String(error),
  ...(error instanceof Error && error.stack !== undefined && { stack: error.stack }),
});

const shutdownTracing = async (
  tracing: DataRetentionTracingHandle,
  jobLogger: DataRetentionJobLogger,
) => {
  try {
    await tracing.shutdown();
  } catch (error) {
    jobLogger.warn(getErrorLogContext(error), "OpenTelemetry tracing shutdown failed");
  }
};

export const runDataRetentionJob = async (
  options: DataRetentionJobOptions = {},
): Promise<DataRetentionRunSummary> => {
  const environment = options.environment ?? process.env;
  const dependencies = options.dependencies ?? defaultDependencies;
  const tracing = dependencies.initTracing();
  const execute = environment["DATA_RETENTION_EXECUTE"] === "true";
  const executionMode = execute ? "execute" : "dry_run";
  const batchSize = parseDataRetentionBatchSize(environment["DATA_RETENTION_BATCH_SIZE"]);
  let failureLogged = false;

  try {
    return await withDataRetentionSpan(
      DATA_RETENTION_TRACE_SPANS.jobRun,
      {
        ...getDataRetentionJobRootSpanAttributes({
          executionMode,
          ...(batchSize !== undefined && { batchSize }),
        }),
        "retention.last_committed_stage": "none",
      },
      async () => {
        try {
          const summary = await dependencies.runDataRetention({
            dryRun: !execute,
            ...(batchSize !== undefined && { batchSize }),
          });

          setActiveDataRetentionSpanAttributes(getSummaryTraceAttributes(summary));
          dependencies.logger.info(
            { ...summary, executionMode, tracingEnabled: tracing.enabled },
            "data retention job completed",
          );
          return summary;
        } catch (error) {
          failureLogged = true;
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
          dependencies.logger.error(getErrorLogContext(error), "data retention job failed");
          throw error;
        }
      },
    );
  } catch (error) {
    if (!failureLogged) {
      dependencies.logger.error(getErrorLogContext(error), "data retention job failed");
    }

    throw error;
  } finally {
    await shutdownTracing(tracing, dependencies.logger);
  }
};
