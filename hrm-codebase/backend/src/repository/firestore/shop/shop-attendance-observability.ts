import type { Span } from "@opentelemetry/api";
import {
  ATTENDANCE_TRACE_CHILD_SPANS,
  filterAttendanceTraceAttributes,
  setAttendanceSpanAttributes,
  type AttendanceTraceAttributes,
} from "../../../business/employee/attendance/attendance-tracing-contract.js";
import { withAppSpan } from "../../../modules/tracing.js";

type CacheReadOptions<T> = {
  isHit?: (value: T | undefined) => boolean;
  hitStatus?: string;
};

const resolveCacheStatus = (cacheHit: boolean, hitStatus: string | undefined) => {
  if (!cacheHit) {
    return "miss";
  }

  return hitStatus ?? "hit";
};

export const withAttendanceRepositorySpan = <T>(
  spanName: string,
  attributes: AttendanceTraceAttributes,
  handler: (span: Span) => Promise<T>,
) => withAppSpan(spanName, filterAttendanceTraceAttributes(attributes), handler);

export const setAttendanceRepositorySpanAttributes = (
  span: Span,
  attributes: AttendanceTraceAttributes,
) => {
  setAttendanceSpanAttributes(span, attributes);
};

export const addAttendanceRepositorySpanEvent = (
  span: Span,
  eventName: string,
  attributes: AttendanceTraceAttributes = {},
) => {
  span.addEvent(eventName, filterAttendanceTraceAttributes(attributes));
};

export const readAttendanceCache = <T>(
  attributes: AttendanceTraceAttributes,
  reader: () => Promise<T | undefined>,
  options: CacheReadOptions<T> = {},
): Promise<T | undefined> =>
  withAttendanceRepositorySpan(ATTENDANCE_TRACE_CHILD_SPANS.cacheRead, attributes, async (span) => {
    const value = await reader();
    const cacheHit = options.isHit?.(value) ?? value !== undefined;

    setAttendanceRepositorySpanAttributes(span, {
      "cache.status": resolveCacheStatus(cacheHit, options.hitStatus),
    });
    return value;
  });

export const writeAttendanceCache = (
  attributes: AttendanceTraceAttributes,
  writer: () => Promise<void>,
): Promise<void> =>
  withAttendanceRepositorySpan(
    ATTENDANCE_TRACE_CHILD_SPANS.cacheWrite,
    attributes,
    async (span) => {
      await writer();
      setAttendanceRepositorySpanAttributes(span, { "cache.status": "stored" });
    },
  );
