import { trace, type Span } from "@opentelemetry/api";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addActiveAttendanceSpanEvent,
  getAttendanceCompletionTraceAttributes,
  getAttendanceCalendarTraceAttributes,
  getAttendanceListTraceAttributes,
  getAttendanceRootSpanAttributes,
  setAttendanceResponseCacheStatus,
} from "../../src/business/employee/attendance/attendance-observability.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const createRequest = (
  params: Record<string, string>,
  query: Record<string, string> = {},
): Request => ({ params, query }) as unknown as Request;

const createResponse = (
  statusCode: number,
  errorType?: string,
): Pick<Response, "locals" | "statusCode"> => ({
  statusCode,
  locals: errorType === undefined ? {} : { requestError: { errorType } },
});

describe("attendance root span attributes", () => {
  it("adds the stable domain, operation, store, and attendance identifiers", () => {
    const request = createRequest({
      storeId: "S-1",
      attendanceId: "attendance-1",
    });

    expect(
      getAttendanceRootSpanAttributes(request, {
        operation: "detail",
      }),
    ).toEqual({
      "app.domain": "attendance",
      "app.operation": "detail",
      "app.store_id": "S-1",
      "attendance.id": "attendance-1",
    });
  });

  it("keeps stable root attributes authoritative over operation-specific attributes", () => {
    const request = createRequest({ storeId: "S-1" });

    expect(
      getAttendanceRootSpanAttributes(request, {
        operation: "calendar",
        getAttributes: () => ({
          "app.domain": "other",
          "app.operation": "update",
          "app.store_id": "S-2",
          "attendance.calendar.view": "week",
        }),
      }),
    ).toEqual({
      "app.domain": "attendance",
      "app.operation": "calendar",
      "app.store_id": "S-1",
      "attendance.calendar.view": "week",
    });
  });

  it("records query shape without copying employee filter identifiers", () => {
    const request = createRequest(
      { storeId: "S-1" },
      {
        workDate: "2026-07-27",
        employeeUserId: "employee-secret-id",
        bookingStatus: "confirmed",
        view: "week",
        fromWorkDate: "2026-07-27",
        toWorkDate: "2026-08-02",
      },
    );

    expect(getAttendanceListTraceAttributes(request)).toEqual({
      "attendance.work_date": "2026-07-27",
      "attendance.employee_filter_present": true,
      "attendance.booking_status_filter_present": true,
      "attendance.record_status_filter_present": false,
    });
    expect(getAttendanceCalendarTraceAttributes(request)).toEqual({
      "attendance.calendar.view": "week",
      "attendance.date_range.start": "2026-07-27",
      "attendance.date_range.end": "2026-08-02",
    });
    expect(JSON.stringify(getAttendanceListTraceAttributes(request))).not.toContain(
      "employee-secret-id",
    );
  });

  it("maps handled Attendance responses to stable domain outcomes", () => {
    expect(getAttendanceCompletionTraceAttributes(createResponse(201))).toEqual({
      "attendance.outcome": "success",
    });
    expect(
      getAttendanceCompletionTraceAttributes(
        createResponse(409, "/stores/attendances/work-day-already-closed"),
      ),
    ).toEqual({
      "attendance.outcome": "work_day_closed",
    });
    expect(
      getAttendanceCompletionTraceAttributes(
        createResponse(409, "/stores/attendances/booking-confirmation-incomplete"),
      ),
    ).toEqual({
      "attendance.outcome": "confirmation_incomplete",
    });
  });

  it("does not invent a domain outcome for an unknown handled error", () => {
    expect(
      getAttendanceCompletionTraceAttributes(createResponse(409, "/stores/unknown-conflict")),
    ).toEqual({});
  });

  it("filters event attributes before writing them to the active span", () => {
    const addEvent = vi.fn();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue({ addEvent } as unknown as Span);

    addActiveAttendanceSpanEvent("attendance.write_committed", {
      "attendance.id": "attendance-1",
      "attendance.persist_action": "update",
      "attendance.deleted_count": 1,
    });

    expect(addEvent).toHaveBeenCalledWith("attendance.write_committed", {
      "attendance.id": "attendance-1",
      "attendance.persist_action": "update",
      "attendance.deleted_count": 1,
    });
  });

  it("marks conditional HTTP cache responses as not modified", () => {
    const setAttribute = vi.fn();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue({ setAttribute } as unknown as Span);

    setAttendanceResponseCacheStatus({ statusCode: 304 });

    expect(setAttribute).toHaveBeenCalledWith("cache.status", "not_modified");
  });
});
