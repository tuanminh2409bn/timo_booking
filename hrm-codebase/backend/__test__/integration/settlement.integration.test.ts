import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  app,
  ownerSessionHeader,
  withRequestDefaults,
  state,
  getAttendanceOrThrow,
  seedClosedWorkDaySettlement,
} from "./backend-api-fixture.js";
import {
  getResponsibleEmployeeUserIdsForAttendance,
  isSettlementAttendance,
} from "../../src/helpers/work-day-settlement.js";
import { synchronizeWorkDaySettlement } from "../../src/business/employee/work-days/work-day-settlement-sync.js";
import { firestoreRepository } from "../../src/repository/firestore/index.js";

const seedEmployeeWorkDayClosings = (workDate: string, storeId = "branch-1"): void => {
  const attendances = Array.from(state.attendances.values()).filter(
    (attendance) =>
      attendance.storeId === storeId &&
      attendance.workDate === workDate &&
      isSettlementAttendance(attendance),
  );
  const attendanceVersionsByEmployee = new Map<string, Map<string, number>>();

  attendances.forEach((attendance) => {
    getResponsibleEmployeeUserIdsForAttendance(attendance).forEach((employeeUserId) => {
      const attendanceVersions =
        attendanceVersionsByEmployee.get(employeeUserId) ?? new Map<string, number>();
      attendanceVersions.set(attendance.id, attendance.updatedAt);
      attendanceVersionsByEmployee.set(employeeUserId, attendanceVersions);
    });
  });

  const timestamp = Date.now();
  attendanceVersionsByEmployee.forEach((attendanceVersions, employeeUserId) => {
    const id = `${employeeUserId}__${workDate}`;
    state.employeeWorkDayClosings.set(id, {
      id,
      ownerId: "shop-1",
      storeId,
      workDate,
      employeeUserId,
      attendanceIds: Array.from(attendanceVersions.keys()).sort(),
      attendanceVersions: Object.fromEntries(attendanceVersions),
      closedAt: timestamp,
      closedByUserId: employeeUserId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
};

const seedSettlementData = () => {
  const now = Date.now();
  const attendance1 = getAttendanceOrThrow("attendance-1");
  const attendance2 = getAttendanceOrThrow("attendance-2");

  state.attendances.set("attendance-settlement-1", {
    ...attendance1,
    id: "attendance-settlement-1",
    workDate: "2026-05-15",
    storeWorkDateKey: "branch-1__2026-05-15",
    totalAmount: 100,
    subtotalAmount: 100,
    status: "closed",
    closedAt: now,
    closedBy: "owner-1",
  });

  state.attendances.set("attendance-settlement-2", {
    ...attendance1,
    id: "attendance-settlement-2",
    workDate: "2026-05-15",
    storeWorkDateKey: "branch-1__2026-05-15",
    totalAmount: 80,
    subtotalAmount: 90,
    discount: {
      allocationMode: "workday",
      type: "amount",
      value: 10,
      splitMode: "all_assignees",
      splitEmployeeUserIds: [],
      ownerCoverageRate: 50,
      amount: 10,
      employeeAmount: 5,
      ownerAmount: 5,
      shares: [],
      ownerShares: [],
    },
    status: "closed",
    closedAt: now,
    closedBy: "owner-1",
  });

  state.attendances.set("attendance-settlement-3", {
    ...attendance2,
    id: "attendance-settlement-3",
    workDate: "2026-05-15",
    storeWorkDateKey: "branch-2__2026-05-15",
    totalAmount: 60,
    subtotalAmount: 60,
    status: "closed",
    closedAt: now,
    closedBy: "owner-1",
  });

  seedEmployeeWorkDayClosings("2026-05-15");
};

describe("Settlement Integration: Employee Close Day", () => {
  it("closes the employee work day as one action", async () => {
    const cancelledAttendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set("attendance-cancelled-close-day", {
      ...cancelledAttendance,
      id: "attendance-cancelled-close-day",
      bookingStatus: "cancelled",
    });
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
    const secondResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", employeeAuth)
        .send({ workDate: "2026-05-05" }),
    );

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toMatchObject({
      id: "staff-1__2026-05-05",
      workDate: "2026-05-05",
      storeId: "branch-1",
      employeeUserId: "staff-1",
      attendanceCount: 1,
    });
    expect(state.employeeWorkDayClosings.get("staff-1__2026-05-05")).toMatchObject({
      employeeUserId: "staff-1",
      workDate: "2026-05-05",
      attendanceIds: ["attendance-1"],
      attendanceVersions: { "attendance-1": getAttendanceOrThrow("attendance-1").updatedAt },
    });
    expect(getAttendanceOrThrow("attendance-1").status).toBe("open");
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body).toMatchObject({
      id: "staff-1__2026-05-05",
      attendanceCount: 1,
    });

    const reportResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/me/report")
        .query({ fromWorkDate: "2026-05-05", toWorkDate: "2026-05-05" })
        .set("Authorization", employeeAuth),
    );
    expect(reportResponse.status).toBe(200);
    expect(reportResponse.body.employeeWorkDayClosings).toEqual([
      expect.objectContaining({
        id: "staff-1__2026-05-05",
        workDate: "2026-05-05",
        attendanceCount: 1,
      }),
    ]);
  });

  it("requires the employee to confirm again after an attendance changes", async () => {
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const closeResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", employeeAuth)
        .send({ workDate: "2026-05-05" }),
    );
    expect(closeResponse.status).toBe(200);

    const attendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set(attendance.id, { ...attendance, updatedAt: attendance.updatedAt + 1 });

    const previewResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({ workDate: "2026-05-05", ownerDiscountCoverageRate: "50" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.pendingEmployees).toEqual([
      { id: "staff-1", name: "Staff One" },
      { id: "staff-lead-1", name: "Lead One" },
    ]);

    const staleClosing = state.employeeWorkDayClosings.get("staff-1__2026-05-05");
    if (!staleClosing) throw new Error("Missing staff-1 work-day closing fixture");
    state.employeeWorkDayClosings.set(staleClosing.id, { ...staleClosing, closedAt: 1 });

    const reconfirmResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", employeeAuth)
        .send({ workDate: "2026-05-05" }),
    );

    expect(reconfirmResponse.status).toBe(200);
    expect(reconfirmResponse.body.closedAt).toBeGreaterThan(1);
  });

  it("keeps concurrent employee close requests idempotent", async () => {
    const originalGetClosing = firestoreRepository.shop.session.getEmployeeWorkDayClosing;
    const pendingReads: Array<() => void> = [];
    let interceptedReadCount = 0;
    const getClosing = vi
      .spyOn(firestoreRepository.shop.session, "getEmployeeWorkDayClosing")
      .mockImplementation(async (...args) => {
        const closing = await originalGetClosing(...args);
        interceptedReadCount += 1;

        if (interceptedReadCount <= 2) {
          await new Promise<void>((resolve) => {
            pendingReads.push(resolve);

            if (pendingReads.length === 2) {
              pendingReads.forEach((release) => release());
            }
          });
        }

        return closing;
      });
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    try {
      const responses = await Promise.all([
        withRequestDefaults(
          request(app)
            .put("/api/v1/me/work-day-closings")
            .set("Authorization", employeeAuth)
            .send({ workDate: "2026-05-05" }),
        ),
        withRequestDefaults(
          request(app)
            .put("/api/v1/me/work-day-closings")
            .set("Authorization", employeeAuth)
            .send({ workDate: "2026-05-05" }),
        ),
      ]);
      const closingAuditLogs = state.auditLogs.filter(
        (auditLog) => auditLog.eventType === "employee_work_day_closed",
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(state.employeeWorkDayClosings.has("staff-1__2026-05-05")).toBe(true);
      expect(closingAuditLogs).toHaveLength(1);
    } finally {
      getClosing.mockRestore();
    }
  });

  it("does not allow an owner to use the employee close-day action", async () => {
    const response = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", ownerSessionHeader())
        .send({ workDate: "2026-05-05" }),
    );

    expect(response.status).toBe(403);
    expect(response.body.type).toBe("/me/work-day-closings/forbidden-role");
  });
});

describe("Settlement Integration: Settlement Preview", () => {
  it("loads the settlement summary separately from its attendance snapshot", async () => {
    await synchronizeWorkDaySettlement("shop-1", "branch-1", "2026-05-05");

    const summaryResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({
          workDate: "2026-05-05",
          ownerDiscountCoverageRate: "50",
          includeItems: "false",
        })
        .set("Authorization", ownerSessionHeader()),
    );
    const attendanceResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-day-settlements/2026-05-05/attendance-items")
        .set("Authorization", ownerSessionHeader()),
    );

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.items).toEqual([]);
    expect(attendanceResponse.status).toBe(200);
    expect(attendanceResponse.body.items).toEqual([
      expect.objectContaining({ id: "attendance-1" }),
    ]);
    expect(attendanceResponse.body.meta).toEqual({ count: 1 });
  });

  it("reports employee names even when a historical employee is inactive and unscoped", async () => {
    const employee = state.users.get("staff-1");
    if (!employee) throw new Error("Missing staff-1 fixture");
    state.users.set(employee.uid, { ...employee, active: false, storeId: undefined });
    const attendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set(attendance.id, { ...attendance, attendanceCode: "CC-01" });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({ workDate: "2026-05-05", ownerDiscountCoverageRate: "50" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.headers["x-cache"]).toBe("BYPASS");
    expect(response.headers["cache-control"]).toBe("private, no-cache, max-age=0, must-revalidate");
    expect(response.headers["server-timing"]).toContain("firestore;dur=");
    expect(response.headers["server-timing"]).toContain("total;dur=");
    expect(response.body.items[0]).toMatchObject({
      id: "attendance-1",
      attendanceCode: "CC-01",
      startTime: 540,
      endTime: 600,
    });
    expect(response.body.pendingEmployees).toEqual([
      { id: "staff-1", name: "Staff One" },
      { id: "staff-lead-1", name: "Lead One" },
    ]);
  });

  it("does not expose employee IDs when no display name is available", async () => {
    state.users.delete("staff-1");
    state.users.delete("staff-lead-1");

    const attendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set(attendance.id, {
      ...attendance,
      assignees: attendance.assignees.map((employee) => ({
        employeeUserId: employee.employeeUserId,
        ...(employee.percentage !== undefined && { percentage: employee.percentage }),
        ...(employee.shareAmount !== undefined && { shareAmount: employee.shareAmount }),
      })),
      services: attendance.services.map((service) => ({
        ...service,
        employees: (service.employees ?? []).map((employee) => ({
          employeeUserId: employee.employeeUserId,
          ...(employee.percentage !== undefined && { percentage: employee.percentage }),
          ...(employee.shareAmount !== undefined && { shareAmount: employee.shareAmount }),
        })),
      })),
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({ workDate: "2026-05-05", ownerDiscountCoverageRate: "50" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body.pendingEmployees).toEqual([
      expect.objectContaining({ id: "staff-1", name: expect.any(String) }),
      expect.objectContaining({ id: "staff-lead-1", name: expect.any(String) }),
    ]);
    expect(response.body.preview.employeeSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ employeeUserId: "staff-1", employeeName: expect.any(String) }),
        expect.objectContaining({
          employeeUserId: "staff-lead-1",
          employeeName: expect.any(String),
        }),
      ]),
    );
  });

  it("returns an empty work day without inventing attendance or pending employees", async () => {
    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({ workDate: "2026-05-20", ownerDiscountCoverageRate: "50" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      storeId: "branch-1",
      workDate: "2026-05-20",
      items: [],
      pendingEmployees: [],
      closing: null,
      preview: {
        employeeSummaries: [],
        totalRevenue: 0,
        totalDiscount: 0,
        totalEmployeeEarning: 0,
      },
    });
  });

  it("ignores an empty attendance placeholder when building a settlement preview", async () => {
    const placeholder = getAttendanceOrThrow("attendance-1");
    state.attendances.set("attendance-empty-placeholder", {
      ...placeholder,
      id: "attendance-empty-placeholder",
      employeeUserId: "orphan-employee-id",
      workDate: "2026-05-20",
      storeWorkDateKey: "branch-1__2026-05-20",
      assignees: [
        {
          employeeUserId: "orphan-employee-id",
          percentage: 100,
          shareAmount: 0,
        },
      ],
      services: [],
      subtotalAmount: 0,
      totalAmount: 0,
    });

    const [previewResponse, listResponse] = await Promise.all([
      withRequestDefaults(
        request(app)
          .get("/api/v1/stores/branch-1/work-days/settlement-preview")
          .query({ workDate: "2026-05-20", ownerDiscountCoverageRate: "50" })
          .set("Authorization", ownerSessionHeader()),
      ),
      withRequestDefaults(
        request(app)
          .get("/api/v1/stores/branch-1/work-days/settlements")
          .query({ tab: "unsettled", limit: "10" })
          .set("Authorization", ownerSessionHeader()),
      ),
    ]);

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body).toMatchObject({
      items: [],
      pendingEmployees: [],
      preview: {
        employeeSummaries: [],
        totalRevenue: 0,
      },
    });
    expect(listResponse.status).toBe(200);
    expect(
      listResponse.body.items.some((item: { workDate: string }) => item.workDate === "2026-05-20"),
    ).toBe(false);
  });

  it("returns settlement preview with employee summaries and totals", async () => {
    seedSettlementData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({
          workDate: "2026-05-15",
          ownerCommissionRate: "40",
          ownerDiscountSharePercent: "50",
          discountMethod: "equal",
        })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      storeId: "branch-1",
      workDate: "2026-05-15",
      closing: null,
      pendingEmployees: expect.any(Array),
    });
    expect(response.body.preview).toMatchObject({
      totalNetAmount: expect.any(Number),
      totalOwnerCommission: expect.any(Number),
      totalEmployeeEarning: expect.any(Number),
      employeeSummaries: expect.any(Array),
    });
    expect(response.body.staffMembers).toBeUndefined();
    expect(response.body.pendingEmployeeUserIds).toBeUndefined();
    expect(response.body.preview.summary).toBeUndefined();
  });

  it("returns settlement preview with per-order discount allocation", async () => {
    seedSettlementData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({
          workDate: "2026-05-15",
          ownerCommissionRate: "40",
          ownerDiscountSharePercent: "50",
          discountMethod: "per_order",
          attendanceDiscountOwnerShares: JSON.stringify({
            "attendance-settlement-2": 60,
          }),
        })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.preview).toMatchObject({
      totalDiscount: expect.any(Number),
      totalOwnerDiscount: expect.any(Number),
      totalEmployeeDiscount: expect.any(Number),
    });
  });

  it.each([
    ["fixed", { fixedSalary: 1_000 }],
    ["hourly", { hourlyRate: 20 }],
  ] as const)(
    "keeps %s employees outside commission and makes the owner absorb their discount share",
    async (compensationModel, compensationValues) => {
      seedSettlementData();

      for (const uid of ["staff-1", "staff-lead-1"]) {
        const employee = state.users.get(uid);

        if (!employee) {
          throw new Error(`Missing ${uid} fixture`);
        }

        state.users.set(uid, {
          ...employee,
          compensationModel,
          ...compensationValues,
        });
      }

      const response = await withRequestDefaults(
        request(app)
          .get("/api/v1/stores/branch-1/work-days/settlement-preview")
          .query({ workDate: "2026-05-15", ownerDiscountCoverageRate: "0" })
          .set("Authorization", ownerSessionHeader()),
      );

      expect(response.status).toBe(200);
      expect(response.body.preview.totalDiscount).toBeGreaterThan(0);
      expect(response.body.preview.totalEmployeeDiscount).toBe(0);
      expect(response.body.preview.totalOwnerDiscount).toBe(response.body.preview.totalDiscount);
      expect(response.body.preview.employeeSummaries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            compensationModel,
            employeeEarning: 0,
            discountAllocated: 0,
          }),
        ]),
      );
    },
  );

  it("returns settlement preview with custom owner commission rates per employee", async () => {
    seedSettlementData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({
          workDate: "2026-05-15",
          ownerCommissionRate: "40",
          ownerDiscountSharePercent: "0",
          discountMethod: "equal",
        })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.preview.employeeSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeUserId: expect.any(String),
          totalRevenue: expect.any(Number),
          ownerCommission: expect.any(Number),
          employeeEarning: expect.any(Number),
        }),
      ]),
    );
  });

  it("returns closing snapshot when settlement preview requested for already closed work day", async () => {
    seedSettlementData();
    const ownerAuth = ownerSessionHeader();

    seedClosedWorkDaySettlement({
      id: "closing-already-settled",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-16",
      closedAt: Date.now(),
      closedByUserId: "owner-1",
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeSummaries: [],
      summary: {
        totalEntries: 0,
        subtotalAmount: 0,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 0,
        totalOwnerCommission: 0,
        totalEmployeeEarning: 0,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({
          workDate: "2026-05-16",
          ownerCommissionRate: "40",
          ownerDiscountSharePercent: "50",
          discountMethod: "equal",
        })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.closing).toBeDefined();
  });

  it("handles error when staff tries to access settlement preview", async () => {
    seedSettlementData();
    const staffAuth = ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({
          workDate: "2026-05-15",
          ownerCommissionRate: "40",
          ownerDiscountSharePercent: "50",
          discountMethod: "equal",
        })
        .set("Authorization", staffAuth),
    );

    expect(response.status).toBe(403);
  });
});

describe("Settlement Integration: Close Work Day", () => {
  it("blocks closing while a non-terminal booking still needs confirmation", async () => {
    seedSettlementData();
    const processingAttendance = getAttendanceOrThrow("attendance-settlement-1");
    state.attendances.set(processingAttendance.id, {
      ...processingAttendance,
      bookingStatus: "processing",
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerSessionHeader())
        .send({ workDate: "2026-05-15", ownerDiscountCoverageRate: 50 }),
    );

    expect(response.status).toBe(409);
    expect(response.body.type).toBe("/stores/work-day-settlements/invalid-settlement-state");
  });

  it("does not let cancelled or no-show bookings block settlement", async () => {
    seedSettlementData();
    const cancelledAttendance = getAttendanceOrThrow("attendance-settlement-1");
    state.attendances.set(cancelledAttendance.id, {
      ...cancelledAttendance,
      bookingStatus: "cancelled",
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerSessionHeader())
        .send({ workDate: "2026-05-15", ownerDiscountCoverageRate: 50 }),
    );

    expect(response.status).toBe(201);
    expect(response.body.preview.totalRevenue).toBe(50);
  });

  it("creates a work-day closing through the canonical resource endpoint", async () => {
    seedSettlementData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-05-15",
          ownerDiscountCoverageRate: 50,
        }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(
      "/api/v1/stores/branch-1/work-day-settlements/2026-05-15",
    );
    expect(response.body).toMatchObject({
      storeId: "branch-1",
      workDate: "2026-05-15",
      closing: expect.objectContaining({ ownerDiscountCoverageRate: 50 }),
    });

    const detailResponse = await withRequestDefaults(
      request(app).get(response.headers.location).set("Authorization", ownerAuth),
    );
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body).toMatchObject({
      storeId: "branch-1",
      workDate: "2026-05-15",
      ownerDiscountCoverageRate: 50,
    });
    expect(detailResponse.body.ownerId).toBeUndefined();
  });

  it("rejects owner close when an employee closing becomes stale during preparation", async () => {
    seedSettlementData();

    const originalListClosings =
      firestoreRepository.shop.session.listEmployeeWorkDayClosingsByStoreWorkDate;
    let listCallCount = 0;
    const listClosings = vi
      .spyOn(firestoreRepository.shop.session, "listEmployeeWorkDayClosingsByStoreWorkDate")
      .mockImplementation(async (...args) => {
        listCallCount += 1;

        if (listCallCount === 2) {
          state.employeeWorkDayClosings.delete("staff-1__2026-05-15");
        }

        return originalListClosings(...args);
      });

    try {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/stores/branch-1/work-day-settlements")
          .set("Authorization", ownerSessionHeader())
          .send({ workDate: "2026-05-15", ownerDiscountCoverageRate: 50 }),
      );

      expect(response.status).toBe(409);
      expect(response.body.type).toBe("/stores/work-day-settlements/work-day-has-open-attendance");
      expect(state.workDaySettlements.get("branch-1__2026-05-15")?.status).not.toBe("closed");
    } finally {
      listClosings.mockRestore();
    }
  });

  it("closes work day and creates settlement record with employee summaries", async () => {
    seedSettlementData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-05-15",
          ownerDiscountCoverageRate: 50,
        }),
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      storeId: "branch-1",
      workDate: "2026-05-15",
      closing: expect.objectContaining({
        ownerDiscountCoverageRate: 50,
        discountAllocationMethod: "revenue_share",
      }),
      preview: expect.objectContaining({
        ownerDiscountCoverageRate: 50,
        discountAllocationMethod: "revenue_share",
      }),
    });
    expect(response.body.summary).toBeUndefined();
    expect(response.body.employeeSummaries).toBeUndefined();
    expect(response.body.staffMembers).toBeUndefined();

    const settlement = state.workDaySettlements.get("branch-1__2026-05-15");
    expect(settlement).toBeDefined();
    expect(settlement?.closing?.summary.totalEntries).toBeGreaterThan(0);
  });

  it("defaults close work day to revenue-share discount allocation", async () => {
    seedSettlementData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-05-15",
        }),
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      storeId: "branch-1",
      workDate: "2026-05-15",
      closing: expect.objectContaining({
        ownerDiscountCoverageRate: 50,
        discountAllocationMethod: "revenue_share",
      }),
      preview: expect.objectContaining({
        ownerDiscountCoverageRate: 50,
        discountAllocationMethod: "revenue_share",
      }),
    });
    expect(response.body.preview.totalOwnerDiscount).toBeGreaterThan(0);

    expect(
      state.workDaySettlements.get("branch-1__2026-05-15")?.closing?.discountAllocationMethod,
    ).toBe("revenue_share");
  });

  it("closes work day from attendance snapshots after catalog price changes", async () => {
    const ownerAuth = ownerSessionHeader();
    const now = Date.now();
    const attendance = getAttendanceOrThrow("attendance-1");

    state.attendances.set("attendance-snapshot-settlement", {
      ...attendance,
      id: "attendance-snapshot-settlement",
      workDate: "2026-05-23",
      storeWorkDateKey: "branch-1__2026-05-23",
      subtotalAmount: 50,
      totalAmount: 50,
      status: "closed",
      closedAt: now,
      closedBy: "owner-1",
    });

    const updateServiceResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/services/service-1")
        .set("Authorization", ownerAuth)
        .send({ price: "999" }),
    );
    expect(updateServiceResponse.status).toBe(200);
    expect(state.services.get("service-1")?.price).toBe(999);
    expect(getAttendanceOrThrow("attendance-snapshot-settlement").services[0]?.price).toBe(50);
    seedEmployeeWorkDayClosings("2026-05-23");

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-05-23",
          ownerDiscountCoverageRate: 50,
        }),
    );

    expect(response.status).toBe(201);
    expect(response.body.preview.totalRevenue).toBe(50);

    const settlement = state.workDaySettlements.get("branch-1__2026-05-23");
    expect(settlement?.closing?.summary.subtotalAmount).toBe(50);
    expect(settlement?.serviceSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceId: "service-1",
          totalRevenue: 50,
          averagePrice: 50,
        }),
      ]),
    );
  });

  it("handles error when trying to close work day twice", async () => {
    seedSettlementData();
    const ownerAuth = ownerSessionHeader();

    const firstResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-05-15",
          ownerCommissionRate: 40,
          ownerDiscountCoverageRate: 50,
          discountMethod: "equal",
        }),
    );
    expect(firstResponse.status).toBe(201);

    const secondResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-05-15",
          ownerCommissionRate: 40,
          ownerDiscountCoverageRate: 50,
          discountMethod: "equal",
        }),
    );
    expect(secondResponse.status).toBe(409);
  });

  it("handles error when staff tries to close work day", async () => {
    seedSettlementData();
    const staffAuth = ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", staffAuth)
        .send({
          workDate: "2026-05-15",
          ownerCommissionRate: 40,
          ownerDiscountCoverageRate: 50,
          discountMethod: "equal",
        }),
    );

    expect(response.status).toBe(403);
  });
});

describe("Settlement Integration: Edge Cases", () => {
  it("rejects unsupported owner discount coverage instead of silently using 50 percent", async () => {
    seedSettlementData();

    const previewResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({ workDate: "2026-05-15", ownerDiscountCoverageRate: "25" })
        .set("Authorization", ownerSessionHeader()),
    );
    const closeResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerSessionHeader())
        .send({ workDate: "2026-05-15", ownerDiscountCoverageRate: 25 }),
    );

    expect(previewResponse.status).toBe(400);
    expect(closeResponse.status).toBe(400);
  });

  it("rejects closing when an assigned employee has incomplete compensation config", async () => {
    seedSettlementData();
    const employee = state.users.get("staff-1");

    if (!employee) {
      throw new Error("Missing staff-1 fixture");
    }

    const { ownerCommissionRate: _ownerCommissionRate, ...employeeWithoutCommissionRate } =
      employee;
    void _ownerCommissionRate;
    state.users.set(employee.uid, employeeWithoutCommissionRate);

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerSessionHeader())
        .send({ workDate: "2026-05-15", ownerDiscountCoverageRate: 50 }),
    );

    expect(response.status).toBe(409);
    expect(response.body.type).toBe("/stores/work-day-settlements/invalid-settlement-state");
    expect(state.workDaySettlements.has("branch-1__2026-05-15")).toBe(false);
  });

  it("rejects settlement with no attendances for the work day", async () => {
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-05-20",
          ownerCommissionRate: 40,
          ownerDiscountCoverageRate: 50,
          discountMethod: "equal",
        }),
    );

    expect(response.status).toBe(409);
    expect(response.body.type).toBe("/stores/work-day-settlements/invalid-settlement-state");
  });

  it("uses the employee day closing record instead of attendance status", async () => {
    const attendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set("attendance-day-record", {
      ...attendance,
      id: "attendance-day-record",
      workDate: "2026-05-26",
      storeWorkDateKey: "branch-1__2026-05-26",
      status: "open",
    });
    state.employeeWorkDayClosings.set("staff-1__2026-05-26", {
      id: "staff-1__2026-05-26",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-26",
      employeeUserId: "staff-1",
      attendanceIds: ["attendance-day-record"],
      attendanceVersions: { "attendance-day-record": attendance.updatedAt },
      closedAt: Date.now(),
      closedByUserId: "staff-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    state.employeeWorkDayClosings.set("staff-lead-1__2026-05-26", {
      id: "staff-lead-1__2026-05-26",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-26",
      employeeUserId: "staff-lead-1",
      attendanceIds: ["attendance-day-record"],
      attendanceVersions: { "attendance-day-record": attendance.updatedAt },
      closedAt: Date.now(),
      closedByUserId: "staff-lead-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerSessionHeader())
        .send({ workDate: "2026-05-26", ownerDiscountCoverageRate: 50 }),
    );

    expect(response.status).toBe(201);
  });

  it("persists legacy service-level discount in the closing summary", async () => {
    const now = Date.now();
    const attendance = getAttendanceOrThrow("attendance-1");

    state.attendances.set("attendance-service-discount", {
      ...attendance,
      id: "attendance-service-discount",
      workDate: "2026-05-24",
      storeWorkDateKey: "branch-1__2026-05-24",
      services: attendance.services.map((service) => ({ ...service, discountAmount: 10 })),
      totalAmount: 40,
      status: "closed",
      closedAt: now,
      closedBy: "owner-1",
    });
    seedEmployeeWorkDayClosings("2026-05-24");

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerSessionHeader())
        .send({ workDate: "2026-05-24", ownerDiscountCoverageRate: 50 }),
    );

    expect(response.status).toBe(201);
    expect(
      state.workDaySettlements.get("branch-1__2026-05-24")?.closing?.summary.totalDiscountAmount,
    ).toBe(10);
  });

  it("handles settlement with all attendances having zero revenue", async () => {
    const ownerAuth = ownerSessionHeader();
    const now = Date.now();

    state.attendances.set("attendance-zero-revenue", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "attendance-zero-revenue",
      workDate: "2026-05-21",
      storeWorkDateKey: "branch-1__2026-05-21",
      totalAmount: 0,
      subtotalAmount: 0,
      status: "closed",
      closedAt: now,
      closedBy: "owner-1",
    });
    seedEmployeeWorkDayClosings("2026-05-21");

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-05-21",
          ownerCommissionRate: 40,
          ownerDiscountCoverageRate: 50,
          discountMethod: "equal",
        }),
    );

    expect(response.status).toBe(201);
    expect(
      state.workDaySettlements.get("branch-1__2026-05-21")?.closing?.summary.totalNetAmount,
    ).toBe(0);
  });

  it("handles settlement with 100% owner commission rate", async () => {
    seedSettlementData();
    const ownerAuth = ownerSessionHeader();

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-05-15",
          ownerCommissionRate: 100,
          ownerDiscountCoverageRate: 100,
          discountMethod: "equal",
        }),
    );

    expect(response.status).toBe(201);
    expect(response.body.preview.totalEmployeeEarning).toBeGreaterThan(0);
  });

  it("blocks closing a mixed day while an attendance is not settled yet", async () => {
    seedSettlementData();
    const ownerAuth = ownerSessionHeader();
    const now = Date.now();

    state.attendances.set("attendance-still-open", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "attendance-still-open",
      workDate: "2026-05-22",
      storeWorkDateKey: "branch-1__2026-05-22",
      totalAmount: 50,
      subtotalAmount: 50,
      status: "open",
    });

    state.attendances.set("attendance-closed-for-settlement", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "attendance-closed-for-settlement",
      workDate: "2026-05-22",
      storeWorkDateKey: "branch-1__2026-05-22",
      totalAmount: 75,
      subtotalAmount: 75,
      status: "closed",
      closedAt: now,
      closedBy: "owner-1",
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-05-22",
          ownerCommissionRate: 40,
          ownerDiscountCoverageRate: 50,
          discountMethod: "equal",
        }),
    );

    // The owner cannot finalize on behalf of the employee while attendance remains open.
    expect(response.status).toBe(409);
    expect(response.body.type).toBe("/stores/work-day-settlements/work-day-has-open-attendance");
    // ChÃ¡ÂºÂ¥m cÃƒÂ´ng chÃ†Â°a chÃ¡Â»â€˜t vÃ¡ÂºÂ«n open, khÃƒÂ´ng bÃ¡Â»â€¹ chÃ¡Â»Â§ Ã„â€˜ÃƒÂ³ng giÃƒÂ¹m.
    expect(getAttendanceOrThrow("attendance-still-open").status).toBe("open");
  });
});

describe("Settlement Integration: Settlement List", () => {
  it("does not report a day as closed while an employee is still pending", async () => {
    const workDate = "2026-05-27";
    const attendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set("attendance-partial-employee-closing", {
      ...attendance,
      id: "attendance-partial-employee-closing",
      workDate,
      storeWorkDateKey: `branch-1__${workDate}`,
    });
    seedEmployeeWorkDayClosings(workDate);
    const ownerAuth = ownerSessionHeader();
    const closeResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({ workDate, ownerDiscountCoverageRate: 50 }),
    );
    expect(closeResponse.status).toBe(201);

    state.employeeWorkDayClosings.delete(`staff-lead-1__${workDate}`);
    await synchronizeWorkDaySettlement("shop-1", "branch-1", workDate);

    const [previewResponse, listResponse] = await Promise.all([
      withRequestDefaults(
        request(app)
          .get("/api/v1/stores/branch-1/work-days/settlement-preview")
          .query({ workDate, ownerDiscountCoverageRate: "50" })
          .set("Authorization", ownerAuth),
      ),
      withRequestDefaults(
        request(app)
          .get("/api/v1/stores/branch-1/work-days/settlements")
          .query({ tab: "unsettled", limit: "10" })
          .set("Authorization", ownerAuth),
      ),
    ]);

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.closing).toBeNull();
    expect(previewResponse.body.pendingEmployees).toEqual([
      { id: "staff-lead-1", name: "Lead One" },
    ]);

    expect(listResponse.status).toBe(200);
    expect(
      listResponse.body.items.find((item: { workDate: string }) => item.workDate === workDate),
    ).toMatchObject({
      status: "open",
      attendance: {
        employeeClosedCount: 1,
        employeeTotalCount: 2,
      },
      employees: expect.arrayContaining([
        expect.objectContaining({ employeeUserId: "staff-1", closedCount: 1 }),
        expect.objectContaining({ employeeUserId: "staff-lead-1", closedCount: 0 }),
      ]),
    });
  });

  it("rejects the removed weekly settlement list contract", async () => {
    seedSettlementData();
    const ownerAuth = ownerSessionHeader();
    const now = Date.now();

    state.attendances.set("attendance-open-settlement-list", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "attendance-open-settlement-list",
      workDate: "2026-05-14",
      storeWorkDateKey: "branch-1__2026-05-14",
      totalAmount: 75,
      subtotalAmount: 75,
      status: "open",
    });
    seedClosedWorkDaySettlement({
      id: "closing-list-closed",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-13",
      closedAt: now,
      closedByUserId: "owner-1",
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeSummaries: [],
      summary: {
        totalEntries: 1,
        subtotalAmount: 120,
        totalDiscountAmount: 20,
        totalEmployeeDiscountAmount: 10,
        totalOwnerDiscountAmount: 10,
        totalNetAmount: 100,
        totalOwnerCommission: 48,
        totalEmployeeEarning: 52,
      },
      createdAt: now,
      updatedAt: now,
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlements")
        .query({
          weekOf: "2026-05-15",
        })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(400);
    expect(response.body.type).toBe("/stores/work-days/settlements/invalid-request");
  });

  it("rejects the removed explicit settlement range contract", async () => {
    const ownerAuth = ownerSessionHeader();
    const now = Date.now();

    state.attendances.set("attendance-range-settlement-list", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "attendance-range-settlement-list",
      workDate: "2026-05-25",
      storeWorkDateKey: "branch-1__2026-05-25",
      totalAmount: 90,
      subtotalAmount: 90,
      status: "closed",
      closedAt: now,
      closedBy: "owner-1",
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlements")
        .query({
          fromWorkDate: "2026-05-13",
          toWorkDate: "2026-06-01",
        })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(400);
    expect(response.body.type).toBe("/stores/work-days/settlements/invalid-request");
  });

  it("rejects the removed pendingOnly settlement contract", async () => {
    const ownerAuth = ownerSessionHeader();
    const now = Date.now();

    state.attendances.set("attendance-ready-previous-month", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "attendance-ready-previous-month",
      workDate: "2026-05-29",
      storeWorkDateKey: "branch-1__2026-05-29",
      totalAmount: 90,
      subtotalAmount: 90,
      status: "closed",
      closedAt: now,
      closedBy: "owner-1",
    });
    state.attendances.set("attendance-open-current-month", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "attendance-open-current-month",
      workDate: "2026-06-03",
      storeWorkDateKey: "branch-1__2026-06-03",
      totalAmount: 75,
      subtotalAmount: 75,
      status: "open",
    });
    state.attendances.set("attendance-closed-previous-month", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "attendance-closed-previous-month",
      workDate: "2026-05-30",
      storeWorkDateKey: "branch-1__2026-05-30",
      totalAmount: 120,
      subtotalAmount: 120,
      status: "closed",
      closedAt: now,
      closedBy: "owner-1",
    });
    seedClosedWorkDaySettlement({
      id: "closing-closed-previous-month",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-30",
      closedAt: now,
      closedByUserId: "owner-1",
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeSummaries: [],
      summary: {
        totalEntries: 1,
        subtotalAmount: 120,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 120,
        totalOwnerCommission: 48,
        totalEmployeeEarning: 72,
      },
      createdAt: now,
      updatedAt: now,
    });
    seedEmployeeWorkDayClosings("2026-05-30");

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlements")
        .query({
          pendingOnly: "true",
          limit: "2",
          fromWorkDate: "2026-06-01",
          toWorkDate: "2026-06-30",
        })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(400);
    expect(response.body.type).toBe("/stores/work-days/settlements/invalid-request");
  });
});

describe("Settlement Integration: List tabs (settled/unsettled) + pagination", () => {
  const now = Date.now();

  const seedClosing = (workDate: string) => {
    seedClosedWorkDaySettlement({
      id: `closing-${workDate}`,
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate,
      closedAt: now,
      closedByUserId: "owner-1",
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeSummaries: [],
      summary: {
        totalEntries: 1,
        subtotalAmount: 120,
        totalDiscountAmount: 20,
        totalEmployeeDiscountAmount: 10,
        totalOwnerDiscountAmount: 10,
        totalNetAmount: 100,
        totalOwnerCommission: 48,
        totalEmployeeEarning: 52,
      },
      createdAt: now,
      updatedAt: now,
    });
  };

  const toWorkDate = (msSinceEpoch: number) => new Date(msSinceEpoch).toISOString().slice(0, 10);
  const daysAgo = (n: number) => toWorkDate(Date.now() - n * 86_400_000);

  it("tab=settled paginates closed days by cursor, newest first", async () => {
    const ownerAuth = ownerSessionHeader();
    ["2026-06-01", "2026-06-02", "2026-06-03"].forEach(seedClosing);
    await Promise.all(
      ["2026-06-01", "2026-06-02", "2026-06-03"].map((workDate) =>
        synchronizeWorkDaySettlement("shop-1", "branch-1", workDate),
      ),
    );

    const page1 = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlements")
        .query({ tab: "settled", limit: "2" })
        .set("Authorization", ownerAuth),
    );
    expect(page1.status).toBe(200);
    expect(page1.headers["x-cache"]).toBe("BYPASS");
    expect(page1.headers["server-timing"]).toContain("firestore;dur=");
    expect(page1.headers["server-timing"]).toContain("total;dur=");
    expect(page1.body.tab).toBe("settled");
    expect(page1.body.items.map((item: { workDate: string }) => item.workDate)).toEqual([
      "2026-06-03",
      "2026-06-02",
    ]);
    expect(page1.body.items.every((item: { status: string }) => item.status === "closed")).toBe(
      true,
    );
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.nextCursor).toBe("2026-06-02");

    const page2 = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlements")
        .query({ tab: "settled", limit: "2", cursor: page1.body.nextCursor })
        .set("Authorization", ownerAuth),
    );
    expect(page2.body.items.map((item: { workDate: string }) => item.workDate)).toEqual([
      "2026-06-01",
    ]);
    expect(page2.body.hasMore).toBe(false);
    expect(page2.body.nextCursor).toBeNull();
  });

  it("lists work-day closings through the canonical collection endpoint", async () => {
    const ownerAuth = ownerSessionHeader();
    ["2026-06-01", "2026-06-02", "2026-06-03"].forEach(seedClosing);
    await Promise.all(
      ["2026-06-01", "2026-06-02", "2026-06-03"].map((workDate) =>
        synchronizeWorkDaySettlement("shop-1", "branch-1", workDate),
      ),
    );

    const firstPage = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-day-settlements")
        .query({ pageSize: "2" })
        .set("Authorization", ownerAuth),
    );

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items.map((item: { workDate: string }) => item.workDate)).toEqual([
      "2026-06-03",
      "2026-06-02",
    ]);
    expect(firstPage.body.meta).toMatchObject({
      hasMore: true,
      nextCursor: expect.any(String),
    });
    expect(firstPage.body.meta).not.toHaveProperty("storeId");
    expect(firstPage.body.meta).not.toHaveProperty("pageSize");

    const secondPage = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-day-settlements")
        .query({ pageSize: "2", cursor: firstPage.body.meta.nextCursor })
        .set("Authorization", ownerAuth),
    );

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items.map((item: { workDate: string }) => item.workDate)).toEqual([
      "2026-06-01",
    ]);
    expect(secondPage.body.meta.hasMore).toBe(false);
  });

  it("rejects an invalid canonical settlement cursor", async () => {
    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-day-settlements")
        .query({ cursor: "not-a-valid-cursor" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(400);
    expect(response.body.type).toBe("/stores/work-day-settlements/invalid-request");
  });

  it("gets one work-day closing through the canonical detail endpoint", async () => {
    seedClosing("2026-06-03");
    await synchronizeWorkDaySettlement("shop-1", "branch-1", "2026-06-03");

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-day-settlements/2026-06-03")
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "closing-2026-06-03",
      storeId: "branch-1",
      workDate: "2026-06-03",
      closedByUserId: "owner-1",
    });
    expect(response.body.ownerId).toBeUndefined();
  });

  it("returns not found when the requested work-day closing does not exist", async () => {
    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-day-settlements/2026-06-30")
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(404);
    expect(response.body.type).toBe("/stores/work-day-settlements/not-found");
  });

  it("tab=unsettled lists recent days with attendance but no closing", async () => {
    const ownerAuth = ownerSessionHeader();
    const openWorkDate = daysAgo(3);
    const closedWorkDate = daysAgo(5);

    state.attendances.set("tab-open-day", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "tab-open-day",
      workDate: openWorkDate,
      storeWorkDateKey: `branch-1__${openWorkDate}`,
      status: "open",
    });
    // This day has attendance but is already settled, so it is not in the unsettled tab.
    state.attendances.set("tab-closed-day", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "tab-closed-day",
      workDate: closedWorkDate,
      storeWorkDateKey: `branch-1__${closedWorkDate}`,
      status: "closed",
      closedAt: now,
      closedBy: "staff-1",
    });
    seedEmployeeWorkDayClosings(closedWorkDate);
    seedClosing(closedWorkDate);
    await Promise.all([
      synchronizeWorkDaySettlement("shop-1", "branch-1", openWorkDate),
      synchronizeWorkDaySettlement("shop-1", "branch-1", closedWorkDate),
    ]);

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlements")
        .query({ tab: "unsettled", limit: "10" })
        .set("Authorization", ownerAuth),
    );
    expect(response.status).toBe(200);
    expect(response.body.tab).toBe("unsettled");

    const workDates = response.body.items.map((item: { workDate: string }) => item.workDate);
    expect(workDates).toContain(openWorkDate);
    expect(workDates).not.toContain(closedWorkDate);
    expect(response.body.items.every((item: { status: string }) => item.status !== "closed")).toBe(
      true,
    );
  });

  it("lists unsettled work days through the canonical candidate endpoint", async () => {
    const ownerAuth = ownerSessionHeader();
    const openWorkDate = daysAgo(3);
    const closedWorkDate = daysAgo(5);

    state.attendances.set("canonical-open-day", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "canonical-open-day",
      workDate: openWorkDate,
      storeWorkDateKey: `branch-1__${openWorkDate}`,
      status: "open",
    });
    state.attendances.set("canonical-closed-day", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "canonical-closed-day",
      workDate: closedWorkDate,
      storeWorkDateKey: `branch-1__${closedWorkDate}`,
      status: "closed",
      closedAt: now,
      closedBy: "staff-1",
    });
    seedEmployeeWorkDayClosings(closedWorkDate);
    seedClosing(closedWorkDate);
    await Promise.all([
      synchronizeWorkDaySettlement("shop-1", "branch-1", openWorkDate),
      synchronizeWorkDaySettlement("shop-1", "branch-1", closedWorkDate),
    ]);

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-day-settlement-candidates")
        .query({ pageSize: "10" })
        .set("Authorization", ownerAuth),
    );

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({
      nextCursor: null,
      hasMore: false,
    });
    const workDates = response.body.items.map((item: { workDate: string }) => item.workDate);
    expect(workDates).toContain(openWorkDate);
    expect(workDates).not.toContain(closedWorkDate);
    const openSettlement = response.body.items.find(
      (item: { workDate: string }) => item.workDate === openWorkDate,
    );
    expect(openSettlement).toMatchObject({
      workDate: openWorkDate,
      status: "open",
      attendance: {
        employeeTotalCount: expect.any(Number),
        employeeClosedCount: expect.any(Number),
      },
      employees: expect.any(Array),
    });
    expect(openSettlement).not.toHaveProperty("storeId");
    expect(openSettlement).not.toHaveProperty("totalRevenue");
    expect(openSettlement).not.toHaveProperty("totalDiscount");
    expect(openSettlement).not.toHaveProperty("totalNetAmount");
    expect(openSettlement).not.toHaveProperty("totalOwnerNetAfterDiscount");
  });

  it("keeps settlement read endpoints off the store document hot path", async () => {
    const workDate = daysAgo(2);
    state.attendances.set("scope-free-settlement-day", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "scope-free-settlement-day",
      workDate,
      storeWorkDateKey: `branch-1__${workDate}`,
      status: "open",
    });
    await synchronizeWorkDaySettlement("shop-1", "branch-1", workDate);
    state.storeReadCount = 0;
    const authorization = ownerSessionHeader();

    const candidateResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-day-settlement-candidates")
        .set("Authorization", authorization),
    );
    const previewResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({ workDate })
        .set("Authorization", authorization),
    );
    const closingListResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", authorization),
    );
    const closingDetailResponse = await withRequestDefaults(
      request(app)
        .get(`/api/v1/stores/branch-1/work-day-settlements/${workDate}`)
        .set("Authorization", authorization),
    );

    expect(candidateResponse.status).toBe(200);
    expect(previewResponse.status).toBe(200);
    expect(closingListResponse.status).toBe(200);
    expect(closingDetailResponse.status).toBe(404);
    expect(state.storeReadCount).toBe(0);
  });

  it("does not return settlement documents owned by another tenant", async () => {
    const workDate = daysAgo(2);
    state.attendances.set("tenant-owned-settlement-day", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "tenant-owned-settlement-day",
      workDate,
      storeWorkDateKey: `branch-1__${workDate}`,
      status: "open",
    });
    const ownSettlement = await synchronizeWorkDaySettlement("shop-1", "branch-1", workDate);

    expect(ownSettlement).not.toBeNull();
    if (!ownSettlement) {
      return;
    }

    state.workDaySettlements.set(`foreign-store__${workDate}`, {
      ...ownSettlement,
      id: workDate,
      ownerId: "shop-2",
      storeId: "foreign-store",
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/foreign-store/work-day-settlement-candidates")
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });
});
