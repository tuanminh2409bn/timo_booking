import { trace, type Span, type Tracer } from "@opentelemetry/api";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app, ownerSessionHeader, state, withRequestDefaults } from "./backend-api-fixture.js";
import { firestoreRepository } from "../../src/repository/firestore/index.js";

const createSpanRecorder = () => {
  const attributes = new Map<string, unknown>();
  const events: Array<{ name: string; attributes: Record<string, unknown> }> = [];
  const spanNames: string[] = [];
  const span = {
    addEvent: (name: string, eventAttributes: Record<string, unknown>) => {
      events.push({ name, attributes: eventAttributes });
      return span;
    },
    end: vi.fn(),
    recordException: vi.fn(),
    setAttribute: (key: string, value: unknown) => {
      attributes.set(key, value);
      return span;
    },
    setStatus: vi.fn(),
    spanContext: () => ({
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      traceFlags: 1,
    }),
  } as unknown as Span;
  const tracer = {
    startActiveSpan: <T>(name: string, handler: (activeSpan: Span) => T): T => {
      spanNames.push(name);
      return handler(span);
    },
  } as unknown as Tracer;

  return { attributes, events, span, spanNames, tracer };
};

const makeStaffHourly = () => {
  const employee = state.users.get("staff-1");

  if (!employee || employee.role !== "employee") {
    throw new Error("Missing staff-1 fixture");
  }

  state.users.set(employee.uid, {
    ...employee,
    compensationModel: "hourly",
    hourlyRate: 20,
  });
};

const addHourlyEmployee = (uid: string, name: string) => {
  const employee = state.users.get("staff-1");

  if (!employee || employee.role !== "employee") {
    throw new Error("Missing staff-1 fixture");
  }

  state.users.set(uid, {
    ...employee,
    uid,
    email: `${uid}@example.com`,
    name,
    displayName: name,
    compensationModel: "hourly",
    hourlyRate: 20,
  });
};

describe("employee time-tracking tracing", () => {
  it("records self-read current and pending state without timestamps", async () => {
    makeStaffHourly();
    const now = Date.now();
    state.employeeTimeTracking.set("staff-1__2026-05-06", {
      id: "staff-1__2026-05-06",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-06",
      employeeUserId: "staff-1",
      status: "completed",
      checkedInAt: now - 2 * 60 * 60 * 1000,
      checkedOutAt: now - 60 * 60 * 1000,
      workedMinutes: 60,
      createdAt: now - 2 * 60 * 60 * 1000,
      updatedAt: now - 60 * 60 * 1000,
    });
    state.employeeTimeTracking.set("staff-1__2026-05-05", {
      id: "staff-1__2026-05-05",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-05",
      employeeUserId: "staff-1",
      status: "working",
      checkedInAt: now - 24 * 60 * 60 * 1000,
      createdAt: now - 24 * 60 * 60 * 1000,
      updatedAt: now - 24 * 60 * 60 * 1000,
    });
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .get("/api/v1/me/time-tracking")
          .set("Authorization", employeeAuth)
          .query({ workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(200);
      expect(recorder.spanNames).toEqual([
        "employee_time_tracking.self.read",
        "employee_time_tracking.scope.resolve",
        "employee_time_tracking.context.load",
      ]);
      const attributes = Object.fromEntries(recorder.attributes);
      expect(attributes).toMatchObject({
        "app.operation": "self_read",
        "actor.role": "employee",
        "time_tracking.action": "read",
        "time_tracking.current_status": "completed",
        "time_tracking.pending_checkout_present": true,
        "time_tracking.pending_checkout_count": 1,
        "time_tracking.outcome": "success",
      });
      expect(JSON.stringify(attributes)).not.toContain(String(now));
      expect(JSON.stringify(attributes)).not.toContain("staff-1");
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("records aggregate roster states with one grouped session-loading span", async () => {
    makeStaffHourly();
    addHourlyEmployee("hourly-2", "Hourly Two");
    addHourlyEmployee("hourly-3", "Hourly Three");
    addHourlyEmployee("hourly-4", "Hourly Four");
    const now = Date.now();
    state.employeeTimeTracking.set("hourly-2__2026-05-06", {
      id: "hourly-2__2026-05-06",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-06",
      employeeUserId: "hourly-2",
      status: "working",
      checkedInAt: now - 60 * 60 * 1000,
      createdAt: now - 60 * 60 * 1000,
      updatedAt: now - 60 * 60 * 1000,
    });
    state.employeeTimeTracking.set("hourly-3__2026-05-06", {
      id: "hourly-3__2026-05-06",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-06",
      employeeUserId: "hourly-3",
      status: "completed",
      checkedInAt: now - 2 * 60 * 60 * 1000,
      checkedOutAt: now - 60 * 60 * 1000,
      workedMinutes: 60,
      createdAt: now - 2 * 60 * 60 * 1000,
      updatedAt: now - 60 * 60 * 1000,
    });
    state.employeeTimeTracking.set("hourly-4__2026-05-05", {
      id: "hourly-4__2026-05-05",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-05",
      employeeUserId: "hourly-4",
      status: "working",
      checkedInAt: now - 24 * 60 * 60 * 1000,
      createdAt: now - 24 * 60 * 60 * 1000,
      updatedAt: now - 24 * 60 * 60 * 1000,
    });
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .get("/api/v1/stores/branch-1/employee-time-tracking")
          .set("Authorization", ownerSessionHeader())
          .query({ workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(200);
      expect(recorder.spanNames).toEqual([
        "employee_time_tracking.store.read",
        "employee_time_tracking.roster.load",
        "employee_time_tracking.roster_sessions.load",
      ]);
      const attributes = Object.fromEntries(recorder.attributes);
      expect(attributes).toMatchObject({
        "app.operation": "store_read",
        "actor.role": "owner",
        "time_tracking.action": "read",
        "time_tracking.roster_employee_count": 5,
        "time_tracking.hourly_employee_count": 4,
        "time_tracking.roster_session_read_count": 8,
        "time_tracking.not_started_count": 1,
        "time_tracking.working_count": 1,
        "time_tracking.completed_count": 1,
        "time_tracking.needs_checkout_count": 1,
        "time_tracking.outcome": "success",
      });
      expect(
        recorder.spanNames.filter(
          (spanName) => spanName === "employee_time_tracking.roster_sessions.load",
        ),
      ).toHaveLength(1);
      expect(JSON.stringify(attributes)).not.toContain("hourly-2");
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("returns an empty roster without per-employee spans", async () => {
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .get("/api/v1/stores/branch-1/employee-time-tracking")
          .set("Authorization", ownerSessionHeader())
          .query({ workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
      expect(recorder.spanNames).toEqual([
        "employee_time_tracking.store.read",
        "employee_time_tracking.roster.load",
        "employee_time_tracking.roster_sessions.load",
      ]);
      expect(Object.fromEntries(recorder.attributes)).toMatchObject({
        "time_tracking.roster_employee_count": 2,
        "time_tracking.hourly_employee_count": 0,
        "time_tracking.roster_session_read_count": 0,
        "time_tracking.not_started_count": 0,
        "time_tracking.working_count": 0,
        "time_tracking.completed_count": 0,
        "time_tracking.needs_checkout_count": 0,
      });
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("classifies a self-read repository failure without exporting its message", async () => {
    makeStaffHourly();
    const repositoryFailure = vi
      .spyOn(firestoreRepository.shop.timeTracking, "getEmployeeTimeTracking")
      .mockRejectedValueOnce(new Error("read-secret-internal-message"));
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .get("/api/v1/me/time-tracking")
          .set(
            "Authorization",
            ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" }),
          )
          .query({ workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(500);
      expect(Object.fromEntries(recorder.attributes)).toMatchObject({
        "time_tracking.outcome": "dependency_failure",
      });
      expect(JSON.stringify(Object.fromEntries(recorder.attributes))).not.toContain(
        "read-secret-internal-message",
      );
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
      repositoryFailure.mockRestore();
    }
  });
  it("records the self update root and safe check-in state", async () => {
    makeStaffHourly();
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/time-tracking")
          .set("Authorization", employeeAuth)
          .send({ action: "check_in", workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(200);
      expect(recorder.spanNames).toContain("employee_time_tracking.self.update");
      expect(Object.fromEntries(recorder.attributes)).toMatchObject({
        "app.domain": "employee_time_tracking",
        "app.operation": "self_update",
        "app.store_id": "branch-1",
        "actor.role": "employee",
        "time_tracking.scope": "self",
        "time_tracking.action": "check_in",
        "time_tracking.work_date": "2026-05-06",
        "time_tracking.compensation_model": "hourly",
        "time_tracking.current_status": "missing",
        "time_tracking.status.before": "missing",
        "time_tracking.status.after": "working",
        "time_tracking.pending_checkout_present": false,
        "time_tracking.pending_checkout_count": 0,
        "time_tracking.manual_checkout": false,
        "time_tracking.persist_action": "create",
        "time_tracking.outcome": "success",
      });
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("creates bounded self-update child spans for scope, context, persist, cache, and audit", async () => {
    makeStaffHourly();
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/time-tracking")
          .set("Authorization", employeeAuth)
          .send({ action: "check_in", workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(200);
      expect(recorder.spanNames).toEqual([
        "employee_time_tracking.self.update",
        "employee_time_tracking.scope.resolve",
        "employee_time_tracking.context.load",
        "employee_time_tracking.session.persist",
        "employee_time_tracking.cache.invalidate",
        "employee_time_tracking.audit.write",
      ]);
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("emits one session committed event after a successful write", async () => {
    makeStaffHourly();
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/time-tracking")
          .set("Authorization", employeeAuth)
          .send({ action: "check_in", workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(200);
      expect(recorder.events).toEqual([
        {
          name: "employee_time_tracking.session_committed",
          attributes: expect.objectContaining({
            "app.store_id": "branch-1",
            "time_tracking.action": "check_in",
            "time_tracking.work_date": "2026-05-06",
            "time_tracking.status.before": "missing",
            "time_tracking.status.after": "working",
            "time_tracking.persist_action": "create",
            "time_tracking.last_committed_stage": "session",
          }),
        },
      ]);
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("records the store update root with the acting owner role", async () => {
    makeStaffHourly();
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
          .set("Authorization", ownerSessionHeader())
          .send({ action: "check_in", workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(200);
      expect(recorder.spanNames).toEqual([
        "employee_time_tracking.store.update",
        "employee_time_tracking.scope.resolve",
        "employee_time_tracking.context.load",
        "employee_time_tracking.session.persist",
        "employee_time_tracking.cache.invalidate",
        "employee_time_tracking.audit.write",
      ]);
      expect(Object.fromEntries(recorder.attributes)).toMatchObject({
        "app.domain": "employee_time_tracking",
        "app.operation": "store_update",
        "app.store_id": "branch-1",
        "actor.role": "owner",
        "time_tracking.scope": "store",
        "time_tracking.action": "check_in",
        "time_tracking.current_status": "missing",
        "time_tracking.status.before": "missing",
        "time_tracking.status.after": "working",
        "time_tracking.compensation_model": "hourly",
        "time_tracking.persist_action": "create",
        "time_tracking.outcome": "success",
      });
      expect(
        JSON.stringify({
          attributes: Object.fromEntries(recorder.attributes),
          events: recorder.events,
        }),
      ).not.toContain("staff-1");
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("records the acting manager role without exporting target identity", async () => {
    makeStaffHourly();
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);
    const managerAuth = ownerSessionHeader({
      uid: "manager-1",
      role: "manager",
      ownerId: "shop-1",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
          .set("Authorization", managerAuth)
          .send({ action: "check_in", workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(200);
      expect(Object.fromEntries(recorder.attributes)).toMatchObject({
        "actor.role": "manager",
        "time_tracking.scope": "store",
        "time_tracking.outcome": "success",
      });
      expect(JSON.stringify(Object.fromEntries(recorder.attributes))).not.toContain("staff-1");
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("classifies an older open session as a pending checkout gate", async () => {
    makeStaffHourly();
    const now = Date.now();
    state.employeeTimeTracking.set("staff-1__2026-05-05", {
      id: "staff-1__2026-05-05",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-05",
      employeeUserId: "staff-1",
      status: "working",
      checkedInAt: now - 60 * 60 * 1000,
      createdAt: now - 60 * 60 * 1000,
      updatedAt: now - 60 * 60 * 1000,
    });
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/time-tracking")
          .set("Authorization", employeeAuth)
          .send({ action: "check_in", workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(409);
      expect(response.body.type).toBe("/me/time-tracking/conflict");
      expect(Object.fromEntries(recorder.attributes)).toMatchObject({
        "time_tracking.current_status": "missing",
        "time_tracking.pending_checkout_present": true,
        "time_tracking.pending_checkout_count": 1,
        "time_tracking.outcome": "pending_checkout_required",
      });
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("records manual checkout and a duration bucket without exact timing", async () => {
    makeStaffHourly();
    const now = Date.now();
    state.employeeTimeTracking.set("staff-1__2026-05-06", {
      id: "staff-1__2026-05-06",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-06",
      employeeUserId: "staff-1",
      status: "working",
      checkedInAt: now - 90 * 60 * 1000,
      createdAt: now - 90 * 60 * 1000,
      updatedAt: now - 90 * 60 * 1000,
    });
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/time-tracking")
          .set("Authorization", employeeAuth)
          .send({
            action: "check_out",
            workDate: "2026-05-06",
            checkedOutAt: now - 5 * 60 * 1000,
          }),
      );

      expect(response.status).toBe(200);
      const attributes = Object.fromEntries(recorder.attributes);
      expect(attributes).toMatchObject({
        "time_tracking.current_status": "working",
        "time_tracking.status.before": "working",
        "time_tracking.status.after": "completed",
        "time_tracking.manual_checkout": true,
        "time_tracking.duration_bucket": "under_2h",
        "time_tracking.persist_action": "update",
        "time_tracking.outcome": "success",
      });
      expect(JSON.stringify(attributes)).not.toContain(String(now));
      expect(JSON.stringify(attributes)).not.toContain("workedMinutes");
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it.each([
    ["duplicate check-in", "working", "check_in", undefined, "already_checked_in", 409],
    ["completed-day check-in", "completed", "check_in", undefined, "already_completed", 409],
    ["checkout without check-in", undefined, "check_out", undefined, "not_checked_in", 409],
    ["invalid checkout time", "working", "check_out", "before", "invalid_checkout_time", 400],
  ] as const)(
    "records the trace-only outcome for %s",
    async (_label, status, action, checkoutMode, expectedOutcome, expectedStatus) => {
      makeStaffHourly();
      const now = Date.now();
      if (status !== undefined) {
        state.employeeTimeTracking.set("staff-1__2026-05-06", {
          id: "staff-1__2026-05-06",
          ownerId: "shop-1",
          storeId: "branch-1",
          workDate: "2026-05-06",
          employeeUserId: "staff-1",
          status,
          checkedInAt: now - 60 * 60 * 1000,
          ...(status === "completed" && {
            checkedOutAt: now - 30 * 60 * 1000,
            workedMinutes: 30,
          }),
          createdAt: now - 60 * 60 * 1000,
          updatedAt: now - 30 * 60 * 1000,
        });
      }

      const recorder = createSpanRecorder();
      const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
      const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);
      const employeeAuth = ownerSessionHeader({
        uid: "staff-1",
        role: "employee",
        storeId: "branch-1",
      });

      try {
        const response = await withRequestDefaults(
          request(app)
            .put("/api/v1/me/time-tracking")
            .set("Authorization", employeeAuth)
            .send({
              action,
              workDate: "2026-05-06",
              ...(checkoutMode === "before" && { checkedOutAt: now - 2 * 60 * 60 * 1000 }),
            }),
        );

        expect(response.status).toBe(expectedStatus);
        expect(Object.fromEntries(recorder.attributes)).toMatchObject({
          "time_tracking.outcome": expectedOutcome,
        });
      } finally {
        getActiveSpan.mockRestore();
        getTracer.mockRestore();
      }
    },
  );

  it("classifies an unhandled repository failure without exporting its message", async () => {
    makeStaffHourly();
    const repositoryFailure = vi
      .spyOn(firestoreRepository.shop.timeTracking, "getEmployeeTimeTracking")
      .mockRejectedValueOnce(new Error("firestore-secret-internal-message"));
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/time-tracking")
          .set("Authorization", employeeAuth)
          .send({ action: "check_in", workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(500);
      const attributes = Object.fromEntries(recorder.attributes);
      expect(attributes["time_tracking.outcome"]).toBe("dependency_failure");
      expect(JSON.stringify(attributes)).not.toContain("firestore-secret-internal-message");
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
      repositoryFailure.mockRestore();
    }
  });

  it("marks cache failure after the session commit as post-write", async () => {
    makeStaffHourly();
    const originalUpsert = firestoreRepository.shop.timeTracking.upsertEmployeeTimeTracking;
    const cacheFailure = vi
      .spyOn(firestoreRepository.shop.timeTracking, "upsertEmployeeTimeTracking")
      .mockImplementationOnce(async (ownerId, data, options) => {
        await originalUpsert(ownerId, data, options);
        throw new Error("redis unavailable after commit");
      });
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/time-tracking")
          .set("Authorization", employeeAuth)
          .send({ action: "check_in", workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(500);
      expect(state.employeeTimeTracking.has("staff-1__2026-05-06")).toBe(true);
      expect(Object.fromEntries(recorder.attributes)).toMatchObject({
        "time_tracking.outcome": "post_write_failure",
        "time_tracking.post_write_phase": "cache_invalidation",
        "time_tracking.last_committed_stage": "session",
      });
      expect(recorder.events).toEqual([
        expect.objectContaining({ name: "employee_time_tracking.session_committed" }),
      ]);
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
      cacheFailure.mockRestore();
    }
  });

  it("marks audit failure after the session commit as post-write", async () => {
    makeStaffHourly();
    const auditFailure = vi
      .spyOn(firestoreRepository.shop.audit, "createShopAuditLog")
      .mockRejectedValueOnce(new Error("audit-secret-internal-message"));
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/time-tracking")
          .set("Authorization", employeeAuth)
          .send({ action: "check_in", workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(500);
      expect(state.employeeTimeTracking.has("staff-1__2026-05-06")).toBe(true);
      expect(Object.fromEntries(recorder.attributes)).toMatchObject({
        "time_tracking.outcome": "post_write_failure",
        "time_tracking.post_write_phase": "audit",
        "time_tracking.last_committed_stage": "session",
      });
      expect(recorder.spanNames).toContain("employee_time_tracking.audit.write");
      expect(JSON.stringify(Object.fromEntries(recorder.attributes))).not.toContain(
        "audit-secret-internal-message",
      );
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
      auditFailure.mockRestore();
    }
  });

  it("marks store cache failure after the session commit as post-write", async () => {
    makeStaffHourly();
    const originalUpsert = firestoreRepository.shop.timeTracking.upsertEmployeeTimeTracking;
    const cacheFailure = vi
      .spyOn(firestoreRepository.shop.timeTracking, "upsertEmployeeTimeTracking")
      .mockImplementationOnce(async (ownerId, data, options) => {
        await originalUpsert(ownerId, data, options);
        throw new Error("store redis unavailable after commit");
      });
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
          .set("Authorization", ownerSessionHeader())
          .send({ action: "check_in", workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(500);
      expect(state.employeeTimeTracking.has("staff-1__2026-05-06")).toBe(true);
      expect(Object.fromEntries(recorder.attributes)).toMatchObject({
        "time_tracking.outcome": "post_write_failure",
        "time_tracking.post_write_phase": "cache_invalidation",
        "time_tracking.last_committed_stage": "session",
      });
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
      cacheFailure.mockRestore();
    }
  });

  it("marks store audit failure after the session commit as post-write", async () => {
    makeStaffHourly();
    const auditFailure = vi
      .spyOn(firestoreRepository.shop.audit, "createShopAuditLog")
      .mockRejectedValueOnce(new Error("store-audit-secret-internal-message"));
    const recorder = createSpanRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(recorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(recorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
          .set("Authorization", ownerSessionHeader())
          .send({ action: "check_in", workDate: "2026-05-06" }),
      );

      expect(response.status).toBe(500);
      expect(state.employeeTimeTracking.has("staff-1__2026-05-06")).toBe(true);
      expect(Object.fromEntries(recorder.attributes)).toMatchObject({
        "time_tracking.outcome": "post_write_failure",
        "time_tracking.post_write_phase": "audit",
        "time_tracking.last_committed_stage": "session",
      });
      expect(JSON.stringify(Object.fromEntries(recorder.attributes))).not.toContain(
        "store-audit-secret-internal-message",
      );
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
      auditFailure.mockRestore();
    }
  });
});
