import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app, ownerSessionHeader, state, withRequestDefaults } from "./backend-api-fixture.js";
import { firestoreRepository } from "../../src/repository/firestore/index.js";

const employeeAuth = () =>
  ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" });

const makeStaffHourly = () => {
  const employee = state.users.get("staff-1");

  if (!employee) {
    throw new Error("Missing staff-1 fixture");
  }

  state.users.set("staff-1", {
    ...employee,
    compensationModel: "hourly",
    hourlyRate: 20,
  });
};

describe("employee time tracking", () => {
  it("requires checkout of an older open session before a new check-in", async () => {
    makeStaffHourly();
    const checkedInAt = Date.now() - 2 * 60 * 60 * 1000;
    state.employeeTimeTracking.set("staff-1__2026-07-26", {
      id: "staff-1__2026-07-26",
      ownerId: "shop-1",
      storeId: "branch-1",
      employeeUserId: "staff-1",
      workDate: "2026-07-26",
      status: "working",
      checkedInAt,
      createdAt: checkedInAt,
      updatedAt: checkedInAt,
    });

    const stateResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/me/time-tracking")
        .query({ workDate: "2026-07-27" })
        .set("Authorization", employeeAuth()),
    );

    expect(stateResponse.status).toBe(200);
    expect(stateResponse.body).toMatchObject({
      session: null,
      pendingCheckoutSession: { workDate: "2026-07-26", status: "working" },
    });

    const blockedCheckIn = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/time-tracking")
        .set("Authorization", employeeAuth())
        .send({ action: "check_in", workDate: "2026-07-27" }),
    );
    expect(blockedCheckIn.status).toBe(409);

    const checkedOutAt = checkedInAt + 60 * 60 * 1000;
    const checkoutResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/time-tracking")
        .set("Authorization", employeeAuth())
        .send({ action: "check_out", workDate: "2026-07-26", checkedOutAt }),
    );
    expect(checkoutResponse.status).toBe(200);
    expect(checkoutResponse.body.session).toMatchObject({
      status: "completed",
      checkedOutAt,
      workedMinutes: 60,
    });

    const checkInResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/time-tracking")
        .set("Authorization", employeeAuth())
        .send({ action: "check_in", workDate: "2026-07-27" }),
    );
    expect(checkInResponse.status).toBe(200);
    expect(checkInResponse.body.session.status).toBe("working");
  });

  it("keeps concurrent check-ins visible until atomic transition hardening", async () => {
    makeStaffHourly();
    let readCount = 0;
    let releaseReads: () => void = () => undefined;
    const readsReleased = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const getSession = vi
      .spyOn(firestoreRepository.shop.timeTracking, "getEmployeeTimeTracking")
      .mockImplementation(async () => {
        readCount += 1;
        if (readCount === 2) {
          releaseReads();
        }
        await readsReleased;
        return null;
      });
    let pendingReadCount = 0;
    let releasePendingReads: () => void = () => undefined;
    const pendingReadsReleased = new Promise<void>((resolve) => {
      releasePendingReads = resolve;
    });
    const listOpenSessions = vi
      .spyOn(firestoreRepository.shop.timeTracking, "listOpenEmployeeTimeTracking")
      .mockImplementation(async () => {
        pendingReadCount += 1;
        if (pendingReadCount === 2) {
          releasePendingReads();
        }
        await pendingReadsReleased;
        return [];
      });

    try {
      const responses = await Promise.all([
        withRequestDefaults(
          request(app)
            .put("/api/v1/me/time-tracking")
            .set("Authorization", employeeAuth())
            .send({ action: "check_in", workDate: "2026-07-27" }),
        ),
        withRequestDefaults(
          request(app)
            .put("/api/v1/me/time-tracking")
            .set("Authorization", employeeAuth())
            .send({ action: "check_in", workDate: "2026-07-27" }),
        ),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 200]);
      expect(state.employeeTimeTracking.get("staff-1__2026-07-27")?.status).toBe("working");
      expect(
        state.auditLogs.filter(
          (auditLog) => auditLog.eventType === "employee_time_tracking_started",
        ),
      ).toHaveLength(2);
    } finally {
      getSession.mockRestore();
      listOpenSessions.mockRestore();
    }
  });

  it("keeps concurrent checkouts visible until atomic transition hardening", async () => {
    makeStaffHourly();
    const checkedInAt = Date.now() - 60 * 60 * 1000;
    state.employeeTimeTracking.set("staff-1__2026-07-27", {
      id: "staff-1__2026-07-27",
      ownerId: "shop-1",
      storeId: "branch-1",
      employeeUserId: "staff-1",
      workDate: "2026-07-27",
      status: "working",
      checkedInAt,
      createdAt: checkedInAt,
      updatedAt: checkedInAt,
    });
    let readCount = 0;
    let releaseReads: () => void = () => undefined;
    const readsReleased = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const originalGetSession = firestoreRepository.shop.timeTracking.getEmployeeTimeTracking;
    const getSession = vi
      .spyOn(firestoreRepository.shop.timeTracking, "getEmployeeTimeTracking")
      .mockImplementation(async (...args) => {
        readCount += 1;
        if (readCount === 2) {
          releaseReads();
        }
        await readsReleased;
        return originalGetSession(...args);
      });

    try {
      const responses = await Promise.all([
        withRequestDefaults(
          request(app)
            .put("/api/v1/me/time-tracking")
            .set("Authorization", employeeAuth())
            .send({ action: "check_out", workDate: "2026-07-27" }),
        ),
        withRequestDefaults(
          request(app)
            .put("/api/v1/me/time-tracking")
            .set("Authorization", employeeAuth())
            .send({ action: "check_out", workDate: "2026-07-27" }),
        ),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 200]);
      expect(state.employeeTimeTracking.get("staff-1__2026-07-27")?.status).toBe("completed");
      expect(
        state.auditLogs.filter(
          (auditLog) => auditLog.eventType === "employee_time_tracking_completed",
        ),
      ).toHaveLength(2);
    } finally {
      getSession.mockRestore();
    }
  });

  it("blocks hourly employees from creating attendance before check-in", async () => {
    makeStaffHourly();
    const startTimestamp = Date.now() - 60 * 60 * 1000;
    const workDate = new Date(startTimestamp).toISOString().slice(0, 10);
    const attendancePayload = {
      date: new Date(startTimestamp).toISOString(),
      endDate: new Date(startTimestamp + 30 * 60 * 1000).toISOString(),
      employeeUserId: "staff-1",
      services: [
        {
          id: "quick-service-time-tracking",
          name: "Quick service",
          category: "other",
          price: "15",
          duration: "30",
          employees: [{ employeeId: "staff-1", percentage: 100 }],
        },
      ],
    };

    const blockedResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", employeeAuth())
        .send(attendancePayload),
    );
    expect(blockedResponse.status).toBe(409);
    expect(blockedResponse.body.type).toBe("/stores/attendances/employee-time-tracking-required");

    state.employeeTimeTracking.set(`staff-1__${workDate}`, {
      id: `staff-1__${workDate}`,
      ownerId: "shop-1",
      storeId: "branch-1",
      employeeUserId: "staff-1",
      workDate,
      status: "working",
      checkedInAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const createdResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", employeeAuth())
        .send(attendancePayload),
    );
    expect(createdResponse.status).toBe(201);
  });

  it("reports missing check-in before assignee authorization for hourly employees", async () => {
    makeStaffHourly();
    const startTimestamp = Date.now() - 60 * 60 * 1000;

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", employeeAuth())
        .send({
          date: new Date(startTimestamp).toISOString(),
          endDate: new Date(startTimestamp + 15 * 60 * 1000).toISOString(),
          customerName: "Quick attendance",
          services: [],
        }),
    );

    expect(response.status).toBe(409);
    expect(response.body.type).toBe("/stores/attendances/employee-time-tracking-required");
    expect(response.body.message).toBe("Employees must check in before creating attendance");
  });

  it("requires checkout before an hourly employee closes the work day", async () => {
    makeStaffHourly();
    const timestamp = Date.now() - 60 * 60 * 1000;
    state.employeeTimeTracking.set("staff-1__2026-05-05", {
      id: "staff-1__2026-05-05",
      ownerId: "shop-1",
      storeId: "branch-1",
      employeeUserId: "staff-1",
      workDate: "2026-05-05",
      status: "working",
      checkedInAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const blockedResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", employeeAuth())
        .send({ workDate: "2026-05-05" }),
    );
    expect(blockedResponse.status).toBe(409);
    expect(blockedResponse.body.type).toBe("/me/work-day-closings/checkout-required");

    state.employeeTimeTracking.set("staff-1__2026-05-05", {
      id: "staff-1__2026-05-05",
      ownerId: "shop-1",
      storeId: "branch-1",
      employeeUserId: "staff-1",
      workDate: "2026-05-05",
      status: "completed",
      checkedInAt: timestamp,
      checkedOutAt: Date.now(),
      workedMinutes: 60,
      createdAt: timestamp,
      updatedAt: Date.now(),
    });

    const closeResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", employeeAuth())
        .send({ workDate: "2026-05-05" }),
    );
    expect(closeResponse.status).toBe(200);
  });
});
