import type { Attributes, Context, Link, SpanKind } from "@opentelemetry/api";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
  type SamplingResult,
} from "@opentelemetry/sdk-trace-base";

export type TracingSamplingConfig = {
  rootRatio: number;
  attendanceWriteRatio: number;
  attendanceReadRatio: number;
  employeeTimeTrackingWriteRatio: number;
  employeeTimeTrackingReadRatio: number;
  dataRetentionWriteRatio: number;
  dataRetentionReadRatio: number;
};

export type AttendanceSamplingMode = "read" | "write" | "inherit";
export type EmployeeTimeTrackingSamplingMode = "read" | "write" | "inherit";
export type DataRetentionSamplingMode = "read" | "write" | "inherit";

const TRACE_PROJECT_ID_KEYS = ["OTEL_GOOGLE_CLOUD_PROJECT_ID", "GOOGLE_CLOUD_PROJECT"] as const;

const getConfiguredValue = (
  environment: Record<string, string | undefined>,
  key: string,
): string | undefined => {
  const value = environment[key];

  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  return value.trim();
};

export const getTraceProjectId = (
  environment: Record<string, string | undefined> = process.env,
): string | undefined => {
  for (const key of TRACE_PROJECT_ID_KEYS) {
    const value = getConfiguredValue(environment, key);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

const DEFAULT_ROOT_RATIO = 1;
const DEFAULT_ATTENDANCE_WRITE_RATIO = 1;
const DEFAULT_ATTENDANCE_READ_RATIO = 0.1;
const DEFAULT_EMPLOYEE_TIME_TRACKING_WRITE_RATIO = 1;
const DEFAULT_EMPLOYEE_TIME_TRACKING_READ_RATIO = 0.1;
const DEFAULT_DATA_RETENTION_WRITE_RATIO = 1;
const DEFAULT_DATA_RETENTION_READ_RATIO = 0.1;

const ATTENDANCE_READ_ROOT_SPANS = new Set([
  "attendance.list.read",
  "attendance.form_options.read",
  "attendance.calendar.read",
  "attendance.detail.read",
]);

const ATTENDANCE_WRITE_ROOT_SPANS = new Set([
  "attendance.create",
  "attendance.backfill",
  "attendance.update",
  "attendance.test-data.delete",
  "attendance.delete",
]);

const EMPLOYEE_TIME_TRACKING_READ_ROOT_SPANS = new Set([
  "employee_time_tracking.self.read",
  "employee_time_tracking.store.read",
]);

const EMPLOYEE_TIME_TRACKING_WRITE_ROOT_SPANS = new Set([
  "employee_time_tracking.self.update",
  "employee_time_tracking.store.update",
]);

const DATA_RETENTION_READ_ROOT_SPANS = new Set(["data_retention.plan.read"]);

const DATA_RETENTION_WRITE_ROOT_SPANS = new Set([
  "data_retention.plan.update",
  "data_retention.job.run",
]);

const clampRatio = (ratio: number): number => Math.max(0, Math.min(1, ratio));

export const parseSamplingRatio = (rawValue: string | undefined, fallback: number): number => {
  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }

  const parsedValue = Number.parseFloat(rawValue);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return clampRatio(parsedValue);
};

export const getTracingSamplingConfig = (
  environment: Record<string, string | undefined> = process.env,
): TracingSamplingConfig => ({
  rootRatio: parseSamplingRatio(environment["OTEL_TRACES_SAMPLER_RATIO"], DEFAULT_ROOT_RATIO),
  attendanceWriteRatio: parseSamplingRatio(
    environment["ATTENDANCE_TRACE_WRITE_SAMPLING_RATIO"],
    DEFAULT_ATTENDANCE_WRITE_RATIO,
  ),
  attendanceReadRatio: parseSamplingRatio(
    environment["ATTENDANCE_TRACE_READ_SAMPLING_RATIO"],
    DEFAULT_ATTENDANCE_READ_RATIO,
  ),
  employeeTimeTrackingWriteRatio: parseSamplingRatio(
    environment["EMPLOYEE_TIME_TRACKING_TRACE_WRITE_SAMPLING_RATIO"],
    DEFAULT_EMPLOYEE_TIME_TRACKING_WRITE_RATIO,
  ),
  employeeTimeTrackingReadRatio: parseSamplingRatio(
    environment["EMPLOYEE_TIME_TRACKING_TRACE_READ_SAMPLING_RATIO"],
    DEFAULT_EMPLOYEE_TIME_TRACKING_READ_RATIO,
  ),
  dataRetentionWriteRatio: parseSamplingRatio(
    environment["DATA_RETENTION_TRACE_SAMPLING_RATIO"],
    DEFAULT_DATA_RETENTION_WRITE_RATIO,
  ),
  dataRetentionReadRatio: parseSamplingRatio(
    environment["DATA_RETENTION_TRACE_READ_SAMPLING_RATIO"],
    DEFAULT_DATA_RETENTION_READ_RATIO,
  ),
});

export const getAttendanceSamplingMode = (spanName: string): AttendanceSamplingMode => {
  if (ATTENDANCE_READ_ROOT_SPANS.has(spanName)) {
    return "read";
  }

  if (ATTENDANCE_WRITE_ROOT_SPANS.has(spanName)) {
    return "write";
  }

  return "inherit";
};

export const getEmployeeTimeTrackingSamplingMode = (
  spanName: string,
): EmployeeTimeTrackingSamplingMode => {
  if (EMPLOYEE_TIME_TRACKING_READ_ROOT_SPANS.has(spanName)) {
    return "read";
  }

  if (EMPLOYEE_TIME_TRACKING_WRITE_ROOT_SPANS.has(spanName)) {
    return "write";
  }

  return "inherit";
};

export const getDataRetentionSamplingMode = (spanName: string): DataRetentionSamplingMode => {
  if (DATA_RETENTION_READ_ROOT_SPANS.has(spanName)) {
    return "read";
  }

  if (DATA_RETENTION_WRITE_ROOT_SPANS.has(spanName)) {
    return "write";
  }

  return "inherit";
};

class BusinessOperationSampler implements Sampler {
  private readonly attendanceReadSampler: Sampler;
  private readonly attendanceWriteSampler: Sampler;
  private readonly employeeTimeTrackingReadSampler: Sampler;
  private readonly employeeTimeTrackingWriteSampler: Sampler;
  private readonly dataRetentionReadSampler: Sampler;
  private readonly dataRetentionWriteSampler: Sampler;
  private readonly inheritedSampler: Sampler;

  public constructor(config: TracingSamplingConfig) {
    this.attendanceReadSampler = new TraceIdRatioBasedSampler(config.attendanceReadRatio);
    this.attendanceWriteSampler = new TraceIdRatioBasedSampler(config.attendanceWriteRatio);
    this.employeeTimeTrackingReadSampler = new TraceIdRatioBasedSampler(
      config.employeeTimeTrackingReadRatio,
    );
    this.employeeTimeTrackingWriteSampler = new TraceIdRatioBasedSampler(
      config.employeeTimeTrackingWriteRatio,
    );
    this.dataRetentionReadSampler = new TraceIdRatioBasedSampler(config.dataRetentionReadRatio);
    this.dataRetentionWriteSampler = new TraceIdRatioBasedSampler(config.dataRetentionWriteRatio);
    this.inheritedSampler = new AlwaysOnSampler();
  }

  private getSampler(spanName: string): Sampler {
    const samplingMode = getAttendanceSamplingMode(spanName);

    if (samplingMode === "read") {
      return this.attendanceReadSampler;
    }

    if (samplingMode === "write") {
      return this.attendanceWriteSampler;
    }

    const timeTrackingSamplingMode = getEmployeeTimeTrackingSamplingMode(spanName);

    if (timeTrackingSamplingMode === "read") {
      return this.employeeTimeTrackingReadSampler;
    }

    if (timeTrackingSamplingMode === "write") {
      return this.employeeTimeTrackingWriteSampler;
    }

    const dataRetentionSamplingMode = getDataRetentionSamplingMode(spanName);

    if (dataRetentionSamplingMode === "read") {
      return this.dataRetentionReadSampler;
    }

    if (dataRetentionSamplingMode === "write") {
      return this.dataRetentionWriteSampler;
    }

    return this.inheritedSampler;
  }

  public shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    const sampler = this.getSampler(spanName);

    return sampler.shouldSample(context, traceId, spanName, spanKind, attributes, links);
  }

  public toString(): string {
    return "BusinessOperationSampler";
  }
}

export const createTracingSampler = (config: TracingSamplingConfig): Sampler => {
  const operationSampler = new BusinessOperationSampler(config);
  const neverSampler = new AlwaysOffSampler();

  return new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(config.rootRatio),
    localParentSampled: operationSampler,
    remoteParentSampled: operationSampler,
    localParentNotSampled: neverSampler,
    remoteParentNotSampled: neverSampler,
  });
};
