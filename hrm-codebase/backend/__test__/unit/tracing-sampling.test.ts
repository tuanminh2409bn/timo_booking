import { context, SpanKind, trace, TraceFlags } from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import { ATTENDANCE_TRACE_SPANS } from "../../src/business/employee/attendance/attendance-tracing-contract.js";
import { EMPLOYEE_TIME_TRACKING_TRACE_SPANS } from "../../src/business/employee/time-tracking/employee-time-tracking-tracing-contract.js";
import { DATA_RETENTION_TRACE_SPANS } from "../../src/business/data-retention/data-retention-tracing-contract.js";
import {
  createTracingSampler,
  getAttendanceSamplingMode,
  getDataRetentionSamplingMode,
  getEmployeeTimeTrackingSamplingMode,
  getTraceProjectId,
  getTracingSamplingConfig,
  parseSamplingRatio,
} from "../../src/config/tracing-sampling.js";
import { initTracing } from "../../src/config/tracing.js";

const originalOtelEnabled = process.env["OTEL_ENABLED"];

afterEach(() => {
  if (originalOtelEnabled === undefined) {
    delete process.env["OTEL_ENABLED"];
    return;
  }

  process.env["OTEL_ENABLED"] = originalOtelEnabled;
});

const traceId = "f".repeat(32);
const spanId = "a".repeat(16);

const getSampledParentContext = () =>
  trace.setSpanContext(context.active(), {
    traceId,
    spanId,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: false,
  });

const getUnsampledParentContext = () =>
  trace.setSpanContext(context.active(), {
    traceId,
    spanId,
    traceFlags: TraceFlags.NONE,
    isRemote: false,
  });

const getDecision = (sampler: ReturnType<typeof createTracingSampler>, spanName: string) =>
  sampler.shouldSample(getSampledParentContext(), traceId, spanName, SpanKind.INTERNAL, {}, [])
    .decision;

describe("tracing sampling configuration", () => {
  it("keeps tracing disabled unless explicitly enabled", async () => {
    delete process.env["OTEL_ENABLED"];

    const tracing = initTracing();

    expect(tracing.enabled).toBe(false);
    await tracing.shutdown();
  });

  it("clamps ratios and falls back for invalid values", () => {
    expect(parseSamplingRatio("2", 0.5)).toBe(1);
    expect(parseSamplingRatio("-1", 0.5)).toBe(0);
    expect(parseSamplingRatio("not-a-number", 0.5)).toBe(0.5);
    expect(parseSamplingRatio(undefined, 0.5)).toBe(0.5);
  });

  it("uses safe write/read defaults and accepts explicit environment ratios", () => {
    expect(getTracingSamplingConfig({})).toEqual({
      rootRatio: 1,
      attendanceWriteRatio: 1,
      attendanceReadRatio: 0.1,
      employeeTimeTrackingWriteRatio: 1,
      employeeTimeTrackingReadRatio: 0.1,
      dataRetentionWriteRatio: 1,
      dataRetentionReadRatio: 0.1,
    });
    expect(
      getTracingSamplingConfig({
        OTEL_TRACES_SAMPLER_RATIO: "0.25",
        ATTENDANCE_TRACE_WRITE_SAMPLING_RATIO: "0.8",
        ATTENDANCE_TRACE_READ_SAMPLING_RATIO: "0.05",
        EMPLOYEE_TIME_TRACKING_TRACE_WRITE_SAMPLING_RATIO: "0.9",
        EMPLOYEE_TIME_TRACKING_TRACE_READ_SAMPLING_RATIO: "0.2",
        DATA_RETENTION_TRACE_SAMPLING_RATIO: "0.75",
        DATA_RETENTION_TRACE_READ_SAMPLING_RATIO: "0.15",
      }),
    ).toEqual({
      rootRatio: 0.25,
      attendanceWriteRatio: 0.8,
      attendanceReadRatio: 0.05,
      employeeTimeTrackingWriteRatio: 0.9,
      employeeTimeTrackingReadRatio: 0.2,
      dataRetentionWriteRatio: 0.75,
      dataRetentionReadRatio: 0.15,
    });
  });

  it("keeps the trace project separate from the application data project when configured", () => {
    expect(
      getTraceProjectId({
        GCP_PROJECT_ID: "firestore-project",
        OTEL_GOOGLE_CLOUD_PROJECT_ID: "observability-project",
      }),
    ).toBe("observability-project");
    expect(getTraceProjectId({ GCP_PROJECT_ID: "firestore-project" })).toBeUndefined();
    expect(
      getTraceProjectId({
        OTEL_GOOGLE_CLOUD_PROJECT_ID: " ",
        GOOGLE_CLOUD_PROJECT: " cloud-run-project ",
      }),
    ).toBe("cloud-run-project");
  });

  it("only applies operation ratios to Attendance root spans", () => {
    expect(getAttendanceSamplingMode("attendance.create")).toBe("write");
    expect(getAttendanceSamplingMode("attendance.calendar.read")).toBe("read");
    expect(getAttendanceSamplingMode("attendance.query")).toBe("inherit");
    expect(getAttendanceSamplingMode("db.query")).toBe("inherit");

    for (const rootSpanName of Object.values(ATTENDANCE_TRACE_SPANS)) {
      expect(getAttendanceSamplingMode(rootSpanName)).not.toBe("inherit");
    }
  });

  it("samples Attendance writes and reads independently under a sampled parent", () => {
    const sampler = createTracingSampler({
      rootRatio: 0,
      attendanceWriteRatio: 1,
      attendanceReadRatio: 0,
      employeeTimeTrackingWriteRatio: 1,
      employeeTimeTrackingReadRatio: 1,
      dataRetentionWriteRatio: 1,
      dataRetentionReadRatio: 1,
    });

    expect(getDecision(sampler, "attendance.create")).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(getDecision(sampler, "attendance.calendar.read")).toBe(SamplingDecision.NOT_RECORD);
    expect(getDecision(sampler, "attendance.query")).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(getDecision(sampler, "attendance.cache.read")).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(getDecision(sampler, "db.query")).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it("samples employee time-tracking writes and reads independently", () => {
    expect(getEmployeeTimeTrackingSamplingMode("employee_time_tracking.self.update")).toBe("write");
    expect(getEmployeeTimeTrackingSamplingMode("employee_time_tracking.store.read")).toBe("read");
    expect(getEmployeeTimeTrackingSamplingMode("employee_time_tracking.cache.invalidate")).toBe(
      "inherit",
    );

    for (const rootSpanName of Object.values(EMPLOYEE_TIME_TRACKING_TRACE_SPANS)) {
      expect(getEmployeeTimeTrackingSamplingMode(rootSpanName)).not.toBe("inherit");
    }

    const sampler = createTracingSampler({
      rootRatio: 0,
      attendanceWriteRatio: 1,
      attendanceReadRatio: 1,
      employeeTimeTrackingWriteRatio: 1,
      employeeTimeTrackingReadRatio: 0,
      dataRetentionWriteRatio: 1,
      dataRetentionReadRatio: 1,
    });

    expect(getDecision(sampler, EMPLOYEE_TIME_TRACKING_TRACE_SPANS.selfUpdate)).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
    expect(getDecision(sampler, EMPLOYEE_TIME_TRACKING_TRACE_SPANS.storeRead)).toBe(
      SamplingDecision.NOT_RECORD,
    );
    expect(getDecision(sampler, "employee_time_tracking.context.load")).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });

  it("samples data retention plan reads and writes independently", () => {
    expect(getDataRetentionSamplingMode(DATA_RETENTION_TRACE_SPANS.planRead)).toBe("read");
    expect(getDataRetentionSamplingMode(DATA_RETENTION_TRACE_SPANS.planUpdate)).toBe("write");
    expect(getDataRetentionSamplingMode(DATA_RETENTION_TRACE_SPANS.jobRun)).toBe("write");
    expect(getDataRetentionSamplingMode("data_retention.policy.load")).toBe("inherit");

    const sampler = createTracingSampler({
      rootRatio: 1,
      attendanceWriteRatio: 1,
      attendanceReadRatio: 1,
      employeeTimeTrackingWriteRatio: 1,
      employeeTimeTrackingReadRatio: 1,
      dataRetentionWriteRatio: 1,
      dataRetentionReadRatio: 0,
    });

    expect(getDecision(sampler, DATA_RETENTION_TRACE_SPANS.planUpdate)).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
    expect(getDecision(sampler, DATA_RETENTION_TRACE_SPANS.planRead)).toBe(
      SamplingDecision.NOT_RECORD,
    );
  });

  it("applies the root ratio before Attendance operation sampling", () => {
    const sampler = createTracingSampler({
      rootRatio: 0,
      attendanceWriteRatio: 1,
      attendanceReadRatio: 1,
      employeeTimeTrackingWriteRatio: 1,
      employeeTimeTrackingReadRatio: 1,
      dataRetentionWriteRatio: 1,
      dataRetentionReadRatio: 1,
    });

    const decision = sampler.shouldSample(
      context.active(),
      traceId,
      "GET /api/v1/stores/:storeId/attendances",
      SpanKind.SERVER,
      {},
      [],
    ).decision;

    expect(decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it("keeps an unsampled parent unsampled", () => {
    const sampler = createTracingSampler({
      rootRatio: 1,
      attendanceWriteRatio: 1,
      attendanceReadRatio: 1,
      employeeTimeTrackingWriteRatio: 1,
      employeeTimeTrackingReadRatio: 1,
      dataRetentionWriteRatio: 1,
      dataRetentionReadRatio: 1,
    });

    const decision = sampler.shouldSample(
      getUnsampledParentContext(),
      traceId,
      "attendance.create",
      SpanKind.INTERNAL,
      {},
      [],
    ).decision;

    expect(decision).toBe(SamplingDecision.NOT_RECORD);
  });
});
