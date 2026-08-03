import { trace, type Span, type Tracer } from "@opentelemetry/api";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../src/modules/logger.js";
import {
  app,
  getUserOrThrow,
  ownerSessionHeader,
  state,
  withRequestDefaults,
} from "./backend-api-fixture.js";
import { synchronizeWorkDaySettlement } from "../../src/business/employee/work-days/work-day-settlement-sync.js";
import { firestoreRepository } from "../../src/repository/firestore/index.js";
import { FirestoreDataExistingError } from "../../src/constants/firestore-error.js";
import {
  DATA_RETENTION_TRACE_CHILD_SPANS,
  DATA_RETENTION_TRACE_EVENTS,
  DATA_RETENTION_TRACE_SPANS,
} from "../../src/business/data-retention/data-retention-tracing-contract.js";

const createActiveSpanRecorder = () => {
  const attributes = new Map<string, unknown>();
  const events: Array<{ name: string; attributes: Record<string, unknown> }> = [];
  const span = {
    setAttribute: (key: string, value: unknown) => {
      attributes.set(key, value);
      return span;
    },
    addEvent: (name: string, eventAttributes: Record<string, unknown>) => {
      events.push({ name, attributes: eventAttributes });
      return span;
    },
  } as unknown as Span;

  return { attributes, events, span };
};

const createSpanNameRecorder = () => {
  const spanNames: string[] = [];
  const span = {
    addEvent: () => span,
    end: vi.fn(),
    recordException: vi.fn(),
    setAttribute: () => span,
    setStatus: () => span,
    spanContext: () => ({
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      traceFlags: 1,
    }),
  } as unknown as Span;
  const tracer = {
    startActiveSpan: <T>(name: string, handler: (activeSpan: Span) => T) => {
      spanNames.push(name);
      return handler(span);
    },
  } as unknown as Tracer;

  return { span, spanNames, tracer };
};

const closeResponsibleEmployees = async (workDate = "2026-05-05") => {
  for (const uid of ["staff-1", "staff-lead-1"]) {
    const response = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", ownerSessionHeader({ uid, role: "employee", storeId: "branch-1" }))
        .send({ workDate }),
    );

    expect(response.status).toBe(200);
  }
};

describe("backend API integration: observability", () => {
  it("traces legacy data retention policy initialization as one plan-read workflow", async () => {
    const rootSpanRecorder = createActiveSpanRecorder();
    const spanNameRecorder = createSpanNameRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(spanNameRecorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(rootSpanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .get("/api/v1/account/data-retention-plan")
          .set("Authorization", ownerSessionHeader()),
      );

      expect(response.status).toBe(200);
      expect(spanNameRecorder.spanNames).toEqual(
        expect.arrayContaining([
          DATA_RETENTION_TRACE_SPANS.planRead,
          DATA_RETENTION_TRACE_CHILD_SPANS.scopeResolve,
          DATA_RETENTION_TRACE_CHILD_SPANS.policyLoad,
          DATA_RETENTION_TRACE_CHILD_SPANS.policyInitialize,
          DATA_RETENTION_TRACE_CHILD_SPANS.planCacheInvalidate,
        ]),
      );
      expect(Object.fromEntries(rootSpanRecorder.attributes)).toMatchObject({
        "app.domain": "data_retention",
        "app.operation": "plan_read",
        "actor.role": "owner",
        "retention.plan": "standard",
        "retention.outcome": "success",
        "retention.last_committed_stage": "cache_invalidation",
      });
      expect(rootSpanRecorder.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: DATA_RETENTION_TRACE_EVENTS.policyInitialized }),
          expect.objectContaining({ name: DATA_RETENTION_TRACE_EVENTS.cacheInvalidationCompleted }),
        ]),
      );
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("traces a data retention plan update through persistence, cache, and audit", async () => {
    state.users.set("owner-1", {
      ...getUserOrThrow("owner-1"),
      dataRetentionPlan: "premium",
      dataRetentionPlanChangedAt: Date.parse("2026-07-01T00:00:00.000Z"),
    });
    const rootSpanRecorder = createActiveSpanRecorder();
    const spanNameRecorder = createSpanNameRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(spanNameRecorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(rootSpanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .patch("/api/v1/account/data-retention-plan")
          .set("Authorization", ownerSessionHeader())
          .send({ plan: "standard" }),
      );

      expect(response.status).toBe(200);
      expect(spanNameRecorder.spanNames).toEqual(
        expect.arrayContaining([
          DATA_RETENTION_TRACE_SPANS.planUpdate,
          DATA_RETENTION_TRACE_CHILD_SPANS.scopeResolve,
          DATA_RETENTION_TRACE_CHILD_SPANS.policyLoad,
          DATA_RETENTION_TRACE_CHILD_SPANS.policyPersist,
          DATA_RETENTION_TRACE_CHILD_SPANS.planCacheInvalidate,
          DATA_RETENTION_TRACE_CHILD_SPANS.auditWrite,
        ]),
      );
      expect(Object.fromEntries(rootSpanRecorder.attributes)).toMatchObject({
        "app.domain": "data_retention",
        "app.operation": "plan_update",
        "actor.role": "owner",
        "retention.plan": "standard",
        "retention.plan_changed": true,
        "retention.outcome": "success",
        "retention.last_committed_stage": "audit",
      });
      expect(rootSpanRecorder.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: DATA_RETENTION_TRACE_EVENTS.policyCommitted }),
          expect.objectContaining({ name: DATA_RETENTION_TRACE_EVENTS.cacheInvalidationCompleted }),
        ]),
      );
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("classifies a complete same-plan request as an idempotent replay", async () => {
    state.users.set("owner-1", {
      ...getUserOrThrow("owner-1"),
      dataRetentionPlan: "standard",
      dataRetentionPlanChangedAt: Date.parse("2026-07-01T00:00:00.000Z"),
      dataRetentionStandardEligibleAt: Date.parse("2026-09-01T00:00:00.000Z"),
    });
    const rootSpanRecorder = createActiveSpanRecorder();
    const spanNameRecorder = createSpanNameRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(spanNameRecorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(rootSpanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .patch("/api/v1/account/data-retention-plan")
          .set("Authorization", ownerSessionHeader())
          .send({ plan: "standard" }),
      );

      expect(response.status).toBe(200);
      expect(Object.fromEntries(rootSpanRecorder.attributes)).toMatchObject({
        "retention.plan": "standard",
        "retention.plan_changed": false,
        "retention.outcome": "idempotent_replay",
      });
      expect(spanNameRecorder.spanNames).toContain(DATA_RETENTION_TRACE_SPANS.planUpdate);
      expect(spanNameRecorder.spanNames).toContain(DATA_RETENTION_TRACE_CHILD_SPANS.scopeResolve);
      expect(spanNameRecorder.spanNames).toContain(DATA_RETENTION_TRACE_CHILD_SPANS.policyLoad);
      expect(spanNameRecorder.spanNames).not.toContain(
        DATA_RETENTION_TRACE_CHILD_SPANS.policyPersist,
      );
      expect(spanNameRecorder.spanNames).not.toContain(
        DATA_RETENTION_TRACE_CHILD_SPANS.planCacheInvalidate,
      );
      expect(spanNameRecorder.spanNames).not.toContain(DATA_RETENTION_TRACE_CHILD_SPANS.auditWrite);
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("marks a legacy policy cache failure after the user document commit", async () => {
    const originalUpdatePolicy = firestoreRepository.maintenance.updateOwnerDataRetentionPolicy;
    const updatePolicy = vi
      .spyOn(firestoreRepository.maintenance, "updateOwnerDataRetentionPolicy")
      .mockImplementationOnce((uid, patch, options) =>
        originalUpdatePolicy(uid, patch, {
          ...options,
          runSigninCacheInvalidation: async () => {
            throw new Error("redis unavailable");
          },
        }),
      );
    const rootSpanRecorder = createActiveSpanRecorder();
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(rootSpanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .get("/api/v1/account/data-retention-plan")
          .set("Authorization", ownerSessionHeader()),
      );

      expect(response.status).toBe(500);
      expect(getUserOrThrow("owner-1")).toMatchObject({
        dataRetentionPlan: "standard",
        dataRetentionPlanChangedAt: expect.any(Number),
        dataRetentionStandardEligibleAt: expect.any(Number),
      });
      expect(Object.fromEntries(rootSpanRecorder.attributes)).toMatchObject({
        "retention.outcome": "post_write_failure",
        "retention.failure_phase": "cache_invalidation",
        "retention.last_committed_stage": "policy_initialized",
      });
    } finally {
      getActiveSpan.mockRestore();
      updatePolicy.mockRestore();
    }
  });

  it("marks an audit failure after a data retention plan commit", async () => {
    state.users.set("owner-1", {
      ...getUserOrThrow("owner-1"),
      dataRetentionPlan: "premium",
      dataRetentionPlanChangedAt: Date.parse("2026-07-01T00:00:00.000Z"),
    });
    const auditWrite = vi.spyOn(state.auditLogs, "push").mockImplementationOnce(() => {
      throw new Error("audit unavailable");
    });
    const rootSpanRecorder = createActiveSpanRecorder();
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(rootSpanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .patch("/api/v1/account/data-retention-plan")
          .set("Authorization", ownerSessionHeader())
          .send({ plan: "standard" }),
      );

      expect(response.status).toBe(500);
      expect(getUserOrThrow("owner-1")).toMatchObject({ dataRetentionPlan: "standard" });
      expect(Object.fromEntries(rootSpanRecorder.attributes)).toMatchObject({
        "retention.plan": "standard",
        "retention.plan_changed": true,
        "retention.outcome": "post_write_failure",
        "retention.failure_phase": "audit",
        "retention.last_committed_stage": "policy_updated",
      });
      expect(JSON.stringify(Object.fromEntries(rootSpanRecorder.attributes))).not.toContain(
        "owner-1",
      );
      expect(JSON.stringify(rootSpanRecorder.events)).not.toContain("owner-1");
    } finally {
      getActiveSpan.mockRestore();
      auditWrite.mockRestore();
    }
  });

  it("classifies a data retention plan write failure before commit", async () => {
    state.users.set("owner-1", {
      ...getUserOrThrow("owner-1"),
      dataRetentionPlan: "premium",
      dataRetentionPlanChangedAt: Date.parse("2026-07-01T00:00:00.000Z"),
    });
    const updatePolicy = vi
      .spyOn(firestoreRepository.maintenance, "updateOwnerDataRetentionPolicy")
      .mockRejectedValueOnce(new Error("firestore unavailable"));
    const rootSpanRecorder = createActiveSpanRecorder();
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(rootSpanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .patch("/api/v1/account/data-retention-plan")
          .set("Authorization", ownerSessionHeader())
          .send({ plan: "standard" }),
      );

      expect(response.status).toBe(500);
      expect(getUserOrThrow("owner-1").dataRetentionPlan).toBe("premium");
      expect(Object.fromEntries(rootSpanRecorder.attributes)).toMatchObject({
        "retention.outcome": "dependency_failure",
        "retention.failure_phase": "policy_persist",
      });
      expect(rootSpanRecorder.attributes.has("retention.last_committed_stage")).toBe(false);
    } finally {
      getActiveSpan.mockRestore();
      updatePolicy.mockRestore();
    }
  });

  it("keeps invalid retention payloads as handled business rejections", async () => {
    const rootSpanRecorder = createActiveSpanRecorder();
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(rootSpanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .patch("/api/v1/account/data-retention-plan")
          .set("Authorization", ownerSessionHeader())
          .send({ plan: "forever" }),
      );

      expect(response.status).toBe(400);
      expect(Object.fromEntries(rootSpanRecorder.attributes)).toMatchObject({
        "retention.outcome": "invalid_payload",
      });
      expect(rootSpanRecorder.attributes.has("retention.failure_phase")).toBe(false);
    } finally {
      getActiveSpan.mockRestore();
    }
  });

  it("keeps employee retention-plan access as a handled forbidden outcome", async () => {
    const rootSpanRecorder = createActiveSpanRecorder();
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(rootSpanRecorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app).get("/api/v1/account/data-retention-plan").set("Authorization", employeeAuth),
      );

      expect(response.status).toBe(403);
      expect(Object.fromEntries(rootSpanRecorder.attributes)).toMatchObject({
        "retention.outcome": "forbidden_role",
      });
      expect(rootSpanRecorder.attributes.has("retention.failure_phase")).toBe(false);
    } finally {
      getActiveSpan.mockRestore();
    }
  });

  it("adds and preserves request correlation headers", async () => {
    const generatedRequestIdResponse = await withRequestDefaults(
      request(app).get("/api/v1/monitoring/health"),
    );

    expect(generatedRequestIdResponse.status).toBe(200);
    expect(generatedRequestIdResponse.headers["x-request-id"]).toEqual(expect.any(String));

    const preservedRequestIdResponse = await withRequestDefaults(
      request(app).get("/api/v1/monitoring/health").set("X-Request-Id", "client-request-id"),
    );

    expect(preservedRequestIdResponse.status).toBe(200);
    expect(preservedRequestIdResponse.headers["x-request-id"]).toBe("client-request-id");
  });

  it("propagates incoming traceparent trace id when tracing is disabled", async () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/monitoring/health")
        .set("traceparent", `00-${traceId}-00f067aa0ba902b7-01`),
    );

    expect(response.status).toBe(200);
    expect(response.headers["x-trace-id"]).toBe(traceId);
  });

  it("returns request id on error responses", async () => {
    const response = await withRequestDefaults(
      request(app).get("/api/v1/account/profile").set("X-Request-Id", "error-request-id"),
    );

    expect(response.status).toBe(401);
    expect(response.headers["x-request-id"]).toBe("error-request-id");
    expect(response.body).toEqual({
      type: "/auth/header-missing",
      message: "API header error",
    });
  });

  it("writes one structured application log for a handled service error", async () => {
    const warningLog = vi.spyOn(logger, "warn");

    try {
      const response = await withRequestDefaults(request(app).post("/api/v1/auth/signin").send({}));

      expect(response.status).toBe(400);
      expect(warningLog).toHaveBeenCalledTimes(1);
      expect(warningLog).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          errorType: "/auth/signin/invalid-request",
          errorSource: "validation",
          errorScope: "request",
        }),
        "request completed",
      );
    } finally {
      warningLog.mockRestore();
    }
  });

  it("writes one structured application log for an error middleware response", async () => {
    const warningLog = vi.spyOn(logger, "warn");

    try {
      const response = await withRequestDefaults(
        request(app).get("/api/v1/route-that-does-not-exist"),
      );

      expect(response.status).toBe(404);
      expect(warningLog).toHaveBeenCalledTimes(1);
      expect(warningLog).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          errorType: "/request/not-found",
          errorSource: "logic",
          errorScope: "domain",
        }),
        "request completed",
      );
    } finally {
      warningLog.mockRestore();
    }
  });

  it("merges App Check monitor details into the request log", async () => {
    const originalAppCheckMode = process.env["APP_CHECK_MODE"];
    const warningLog = vi.spyOn(logger, "warn");

    try {
      process.env["APP_CHECK_MODE"] = "monitor";
      const response = await withRequestDefaults(
        request(app).get("/api/v1/account/profile").set("Authorization", ownerSessionHeader()),
      );

      expect(response.status).toBe(200);
      expect(warningLog).toHaveBeenCalledTimes(1);
      expect(warningLog).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 200,
          appCheck: {
            mode: "monitor",
            result: "failed",
            reason: "missing-token",
          },
        }),
        "request completed",
      );
    } finally {
      warningLog.mockRestore();

      if (originalAppCheckMode === undefined) {
        delete process.env["APP_CHECK_MODE"];
      } else {
        process.env["APP_CHECK_MODE"] = originalAppCheckMode;
      }
    }
  });

  it("records customer validation and business span data in one request log", async () => {
    const warningLog = vi.spyOn(logger, "warn");

    try {
      const response = await withRequestDefaults(
        request(app)
          .get("/api/v1/stores/store-1/customers?pageSize=0")
          .set("Authorization", ownerSessionHeader()),
      );

      expect(response.status).toBe(400);
      expect(warningLog).toHaveBeenCalledTimes(1);
      expect(warningLog).toHaveBeenCalledWith(
        expect.objectContaining({
          businessEvent: "customer.list",
          spanScope: "customer.list",
          errorType: "/stores/customers/invalid-request",
          errorSource: "validation",
          errorScope: "request",
        }),
        "request completed",
      );
    } finally {
      warningLog.mockRestore();
    }
  });

  it("uses the settlement root span for employee close requests", async () => {
    const warningLog = vi.spyOn(logger, "warn");
    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "invalid-date" }),
      );

      expect(response.status).toBe(400);
      expect(warningLog).toHaveBeenCalledTimes(1);
      expect(warningLog).toHaveBeenCalledWith(
        expect.objectContaining({
          businessEvent: "employee_work_day.close",
          spanScope: "work_day_settlement.employee.close",
          errorType: "/me/work-day-closings/invalid-request",
        }),
        "request completed",
      );
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "app.domain": "work_day_settlement",
        "app.operation": "employee_close",
        "app.store_id": "branch-1",
        "actor.role": "employee",
        "settlement.scope": "employee",
        "settlement.outcome": "invalid_payload",
      });
    } finally {
      activeSpan.mockRestore();
      warningLog.mockRestore();
    }
  });

  it("records employee close state and distinguishes a clean replay", async () => {
    await synchronizeWorkDaySettlement("shop-1", "branch-1", "2026-05-05");

    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const firstResponse = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "2026-05-05" }),
      );

      expect(firstResponse.status).toBe(200);
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.aggregate_present": true,
        "settlement.employee_compensation_model": "commission",
        "settlement.time_tracking_status": "not_required",
        "settlement.employee_closing_status": "missing",
        "settlement.employee_closing_snapshot_changed": false,
        "settlement.idempotent_replay": false,
        "settlement.aggregate_mark_required": true,
        "settlement.outcome": "success",
      });
      expect(spanRecorder.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "work_day_settlement.employee_closing_committed",
            attributes: expect.objectContaining({ "settlement.persist_action": "create" }),
          }),
          expect.objectContaining({
            name: "work_day_settlement.aggregate_employee_mark_committed",
          }),
        ]),
      );

      spanRecorder.attributes.clear();
      spanRecorder.events.length = 0;

      const replayResponse = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "2026-05-05" }),
      );

      const replayAttributes = Object.fromEntries(spanRecorder.attributes);
      expect(replayResponse.status).toBe(200);
      expect(replayAttributes).toMatchObject({
        "settlement.employee_closing_status": "current",
        "settlement.employee_closing_snapshot_changed": false,
        "settlement.idempotent_replay": true,
        "settlement.aggregate_mark_required": false,
        "settlement.outcome": "idempotent_replay",
      });
      expect(spanRecorder.events).toEqual([]);
      expect(JSON.stringify(replayAttributes)).not.toContain("staff-1");
      expect(JSON.stringify(replayAttributes)).not.toContain("attendance-1");
    } finally {
      activeSpan.mockRestore();
    }
  });

  it("distinguishes a replay that repairs a missing aggregate mark", async () => {
    await synchronizeWorkDaySettlement("shop-1", "branch-1", "2026-05-05");

    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const firstResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", employeeAuth)
        .send({ workDate: "2026-05-05" }),
    );
    const settlementKey = "branch-1__2026-05-05";
    const settlement = state.workDaySettlements.get(settlementKey);

    if (!settlement) {
      throw new Error("Missing work-day settlement fixture");
    }

    expect(firstResponse.status).toBe(200);
    state.workDaySettlements.set(settlementKey, {
      ...settlement,
      status: "open",
      attendance: {
        ...settlement.attendance,
        employeeClosedCount: Math.max(0, settlement.attendance.employeeClosedCount - 1),
      },
      employees: settlement.employees.map((employee) =>
        employee.employeeUserId === "staff-1" ? { ...employee, closedCount: 0 } : employee,
      ),
      preview: {
        ...settlement.preview,
        submittedEmployeeUserIds: settlement.preview.submittedEmployeeUserIds.filter(
          (employeeUserId) => employeeUserId !== "staff-1",
        ),
      },
    });

    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);

    try {
      const repairResponse = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "2026-05-05" }),
      );

      expect(repairResponse.status).toBe(200);
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.employee_closing_status": "current",
        "settlement.idempotent_replay": true,
        "settlement.aggregate_mark_required": true,
        "settlement.outcome": "success",
        "settlement.last_committed_stage": "aggregate_mark",
      });
      expect(spanRecorder.events).toEqual([
        expect.objectContaining({
          name: "work_day_settlement.aggregate_employee_mark_committed",
        }),
      ]);
    } finally {
      activeSpan.mockRestore();
    }
  });

  it("records hourly employee time-tracking gate states", async () => {
    const employee = state.users.get("staff-1");

    if (!employee || employee.role !== "employee") {
      throw new Error("Missing staff-1 fixture");
    }

    state.users.set(employee.uid, {
      ...employee,
      compensationModel: "hourly",
      hourlyRate: 20,
    });

    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const timestamp = Date.now() - 60 * 60 * 1000;

    try {
      const missingResponse = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "2026-05-05" }),
      );

      expect(missingResponse.status).toBe(409);
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.employee_compensation_model": "hourly",
        "settlement.time_tracking_status": "missing",
        "settlement.outcome": "time_tracking_required",
      });

      spanRecorder.attributes.clear();
      state.employeeTimeTracking.set("staff-1__2026-05-05", {
        id: "staff-1__2026-05-05",
        ownerId: "shop-1",
        storeId: "branch-1",
        workDate: "2026-05-05",
        employeeUserId: "staff-1",
        status: "working",
        checkedInAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const workingResponse = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "2026-05-05" }),
      );

      expect(workingResponse.status).toBe(409);
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.employee_compensation_model": "hourly",
        "settlement.time_tracking_status": "working",
        "settlement.outcome": "check_out_required",
      });

      spanRecorder.attributes.clear();
      state.employeeTimeTracking.set("staff-1__2026-05-05", {
        id: "staff-1__2026-05-05",
        ownerId: "shop-1",
        storeId: "branch-1",
        workDate: "2026-05-05",
        employeeUserId: "staff-1",
        status: "completed",
        checkedInAt: timestamp,
        checkedOutAt: timestamp + 60 * 60 * 1000,
        workedMinutes: 60,
        createdAt: timestamp,
        updatedAt: timestamp + 60 * 60 * 1000,
      });

      const completedResponse = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "2026-05-05" }),
      );

      expect(completedResponse.status).toBe(200);
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.employee_compensation_model": "hourly",
        "settlement.time_tracking_status": "completed",
        "settlement.employee_closing_status": "missing",
        "settlement.outcome": "success",
      });
    } finally {
      activeSpan.mockRestore();
    }
  });

  it("records a stale employee closing before replacing its snapshot", async () => {
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const firstResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", employeeAuth)
        .send({ workDate: "2026-05-05" }),
    );
    const attendance = state.attendances.get("attendance-1");

    if (!attendance) {
      throw new Error("Missing attendance-1 fixture");
    }

    expect(firstResponse.status).toBe(200);
    state.attendances.set(attendance.id, { ...attendance, updatedAt: attendance.updatedAt + 1 });

    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "2026-05-05" }),
      );

      expect(response.status).toBe(200);
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.employee_closing_status": "stale",
        "settlement.employee_closing_snapshot_changed": true,
        "settlement.idempotent_replay": false,
        "settlement.outcome": "success",
      });
      expect(spanRecorder.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "work_day_settlement.employee_closing_committed",
            attributes: expect.objectContaining({ "settlement.persist_action": "overwrite" }),
          }),
        ]),
      );
    } finally {
      activeSpan.mockRestore();
    }
  });

  it("keeps aggregate repair failures post-write on the initial close and replay", async () => {
    const aggregateMark = vi
      .spyOn(firestoreRepository.shop.settlement, "markWorkDaySettlementEmployeeClosed")
      .mockRejectedValue(new Error("aggregate unavailable"));
    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const firstResponse = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "2026-05-05" }),
      );

      expect(firstResponse.status).toBe(500);
      expect(state.employeeWorkDayClosings.has("staff-1__2026-05-05")).toBe(true);
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.employee_closing_status": "missing",
        "settlement.outcome": "post_write_failure",
        "settlement.post_write_phase": "aggregate_mark",
        "settlement.last_committed_stage": "employee_closing",
      });

      spanRecorder.attributes.clear();
      spanRecorder.events.length = 0;

      const replayResponse = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "2026-05-05" }),
      );

      const replayAttributes = Object.fromEntries(spanRecorder.attributes);
      expect(replayResponse.status).toBe(500);
      expect(replayAttributes).toMatchObject({
        "settlement.employee_closing_status": "current",
        "settlement.idempotent_replay": true,
        "settlement.aggregate_mark_required": true,
        "settlement.outcome": "post_write_failure",
        "settlement.post_write_phase": "aggregate_mark",
      });
      expect(replayAttributes).not.toHaveProperty("settlement.last_committed_stage");
      expect(spanRecorder.events).toEqual([]);
    } finally {
      aggregateMark.mockRestore();
      activeSpan.mockRestore();
    }
  });

  it("uses the settlement root span for store close requests", async () => {
    const warningLog = vi.spyOn(logger, "warn");
    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/stores/branch-1/work-day-settlements")
          .set("Authorization", ownerSessionHeader())
          .send({ workDate: "invalid-date" }),
      );

      expect(response.status).toBe(400);
      expect(warningLog).toHaveBeenCalledTimes(1);
      expect(warningLog).toHaveBeenCalledWith(
        expect.objectContaining({
          businessEvent: "work_day.close",
          spanScope: "work_day_settlement.store.close",
          errorType: "/stores/work-day-settlements/invalid-request",
        }),
        "request completed",
      );
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "app.domain": "work_day_settlement",
        "app.operation": "store_close",
        "app.store_id": "branch-1",
        "actor.role": "owner",
        "settlement.scope": "store",
        "settlement.outcome": "invalid_payload",
      });
    } finally {
      activeSpan.mockRestore();
      warningLog.mockRestore();
    }
  });

  it("records store close readiness counts without identifier lists", async () => {
    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/stores/branch-1/work-day-settlements")
          .set("Authorization", ownerSessionHeader())
          .send({ workDate: "2026-05-05", ownerDiscountCoverageRate: 50 }),
      );

      expect(response.status).toBe(409);
      expect(response.body.type).toBe("/stores/work-day-settlements/work-day-has-open-attendance");

      const attributes = Object.fromEntries(spanRecorder.attributes);
      expect(attributes).toMatchObject({
        "settlement.existing_status": "missing",
        "settlement.aggregate_present": false,
        "settlement.attendance_count": 1,
        "settlement.eligible_attendance_count": 1,
        "settlement.responsible_employee_count": 2,
        "settlement.submitted_employee_count": 0,
        "settlement.pending_employee_count": 2,
        "settlement.outcome": "employee_closing_pending",
      });
      expect(JSON.stringify(attributes)).not.toContain("staff-1");
      expect(JSON.stringify(attributes)).not.toContain("attendance-1");
    } finally {
      activeSpan.mockRestore();
    }
  });

  it("records aggregate preparation and the successful store-closing commit", async () => {
    await closeResponsibleEmployees();

    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/stores/branch-1/work-day-settlements")
          .set("Authorization", ownerSessionHeader())
          .send({ workDate: "2026-05-05", ownerDiscountCoverageRate: 50 }),
      );

      expect(response.status).toBe(201);
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.outcome": "success",
        "settlement.last_committed_stage": "store_closing",
        "settlement.status.after": "closed",
      });
      expect(spanRecorder.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "work_day_settlement.aggregate_prepared_committed",
          }),
          expect.objectContaining({
            name: "work_day_settlement.store_closing_committed",
          }),
        ]),
      );
    } finally {
      activeSpan.mockRestore();
    }
  });

  it("creates bounded child spans for the owner store-close workflow", async () => {
    await closeResponsibleEmployees();

    const spanRecorder = createSpanNameRecorder();
    const getTracer = vi.spyOn(trace, "getTracer").mockReturnValue(spanRecorder.tracer);
    const getActiveSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/stores/branch-1/work-day-settlements")
          .set("Authorization", ownerSessionHeader())
          .send({ workDate: "2026-05-05", ownerDiscountCoverageRate: 50 }),
      );

      expect(response.status).toBe(201);
      expect(spanRecorder.spanNames).toEqual(
        expect.arrayContaining([
          "work_day_settlement.scope.resolve",
          "work_day_settlement.context.load",
          "work_day_settlement.preview.calculate",
          "work_day_settlement.audit.write",
        ]),
      );
    } finally {
      getActiveSpan.mockRestore();
      getTracer.mockRestore();
    }
  });

  it("marks an owner audit failure after the store-closing commit", async () => {
    await closeResponsibleEmployees();

    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);
    const auditWrite = vi.spyOn(state.auditLogs, "push").mockImplementationOnce(() => {
      throw new Error("audit unavailable");
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/stores/branch-1/work-day-settlements")
          .set("Authorization", ownerSessionHeader())
          .send({ workDate: "2026-05-05", ownerDiscountCoverageRate: 50 }),
      );

      expect(response.status).toBe(500);
      expect(state.workDaySettlements.get("branch-1__2026-05-05")?.status).toBe("closed");
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.outcome": "post_write_failure",
        "settlement.post_write_phase": "audit",
        "settlement.last_committed_stage": "store_closing",
      });
    } finally {
      auditWrite.mockRestore();
      activeSpan.mockRestore();
    }
  });

  it("marks a store cache failure after the store-closing commit", async () => {
    await closeResponsibleEmployees();

    const originalCreateClosedSettlement =
      firestoreRepository.shop.settlement.createClosedWorkDaySettlement;
    const closeWrite = vi
      .spyOn(firestoreRepository.shop.settlement, "createClosedWorkDaySettlement")
      .mockImplementationOnce(async (ownerId, settlement, options) => {
        await originalCreateClosedSettlement(ownerId, settlement, options);
        throw new Error("redis unavailable");
      });
    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/stores/branch-1/work-day-settlements")
          .set("Authorization", ownerSessionHeader())
          .send({ workDate: "2026-05-05", ownerDiscountCoverageRate: 50 }),
      );

      expect(response.status).toBe(500);
      expect(state.workDaySettlements.get("branch-1__2026-05-05")?.status).toBe("closed");
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.outcome": "post_write_failure",
        "settlement.post_write_phase": "cache_invalidation",
        "settlement.last_committed_stage": "store_closing",
      });
    } finally {
      closeWrite.mockRestore();
      activeSpan.mockRestore();
    }
  });

  it("records a concurrent owner close conflict after aggregate preparation", async () => {
    await closeResponsibleEmployees();

    const closeWrite = vi
      .spyOn(firestoreRepository.shop.settlement, "createClosedWorkDaySettlement")
      .mockRejectedValueOnce(new FirestoreDataExistingError("already closed"));
    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);

    try {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/stores/branch-1/work-day-settlements")
          .set("Authorization", ownerSessionHeader())
          .send({ workDate: "2026-05-05", ownerDiscountCoverageRate: 50 }),
      );

      expect(response.status).toBe(409);
      expect(response.body.type).toBe("/stores/work-day-settlements/work-day-already-closed");
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.outcome": "concurrent_close_conflict",
        "settlement.last_committed_stage": "aggregate_prepared",
      });
      expect(spanRecorder.events).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "work_day_settlement.store_closing_committed" }),
        ]),
      );
    } finally {
      closeWrite.mockRestore();
      activeSpan.mockRestore();
    }
  });

  it("distinguishes an employee outside the authenticated store scope", async () => {
    const employee = state.users.get("staff-1");

    if (!employee) {
      throw new Error("Missing staff-1 fixture");
    }

    state.users.set(employee.uid, { ...employee, storeId: "branch-2" });

    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "2026-05-05" }),
      );

      expect(response.status).toBe(403);
      expect(response.body.type).toBe("/me/work-day-closings/forbidden-role");
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "app.store_id": "branch-1",
        "settlement.existing_status": "missing",
        "settlement.attendance_count": 1,
        "settlement.outcome": "employee_out_of_scope",
      });
    } finally {
      activeSpan.mockRestore();
    }
  });

  it("marks an employee audit failure after the closing commit", async () => {
    const spanRecorder = createActiveSpanRecorder();
    const activeSpan = vi.spyOn(trace, "getActiveSpan").mockReturnValue(spanRecorder.span);
    const auditWrite = vi.spyOn(state.auditLogs, "push").mockImplementationOnce(() => {
      throw new Error("audit unavailable");
    });
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const response = await withRequestDefaults(
        request(app)
          .put("/api/v1/me/work-day-closings")
          .set("Authorization", employeeAuth)
          .send({ workDate: "2026-05-05" }),
      );

      expect(response.status).toBe(500);
      expect(state.employeeWorkDayClosings.has("staff-1__2026-05-05")).toBe(true);
      expect(Object.fromEntries(spanRecorder.attributes)).toMatchObject({
        "settlement.outcome": "post_write_failure",
        "settlement.post_write_phase": "audit",
        "settlement.last_committed_stage": "employee_closing",
      });
      expect(spanRecorder.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "work_day_settlement.employee_closing_committed" }),
        ]),
      );
    } finally {
      auditWrite.mockRestore();
      activeSpan.mockRestore();
    }
  });
});
