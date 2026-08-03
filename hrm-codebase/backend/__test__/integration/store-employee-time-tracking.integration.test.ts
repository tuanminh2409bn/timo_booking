import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app, ownerSessionHeader, state, withRequestDefaults } from "./backend-api-fixture.js";
import { firestoreRepository } from "../../src/repository/firestore/index.js";

const managerAuth = () =>
  ownerSessionHeader({
    uid: "manager-1",
    role: "manager",
    ownerId: "shop-1",
    storeId: "branch-1",
  });

const createTwoCallBarrier = () => {
  let callCount = 0;
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    callCount += 1;
    if (callCount === 2) {
      release();
    }
    await released;
  };
};

const makeStaffHourly = () => {
  const employee = state.users.get("staff-1");
  if (!employee) throw new Error("Missing staff-1 fixture");

  state.users.set("staff-1", {
    ...employee,
    compensationModel: "hourly",
    hourlyRate: 20,
  });
};

describe("store employee time tracking", () => {
  beforeEach(() => {
    makeStaffHourly();
  });

  it("lists active hourly employees with their real tracking state", async () => {
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

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/employee-time-tracking")
        .query({ workDate: "2026-07-27" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeUserId: "staff-1",
          compensationModel: "hourly",
          status: "working",
          checkedInAt,
        }),
      ]),
    );
  });

  it("marks an older open session as needing checkout", async () => {
    const checkedInAt = Date.now() - 24 * 60 * 60 * 1000;
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

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/employee-time-tracking")
        .query({ workDate: "2026-07-27" })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeUserId: "staff-1",
          status: "needs_checkout",
          pendingCheckoutWorkDate: "2026-07-26",
        }),
      ]),
    );
  });

  it("allows the owner to check an hourly employee in and out", async () => {
    const checkInResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
        .set("Authorization", ownerSessionHeader())
        .send({ action: "check_in", workDate: "2026-07-27" }),
    );

    expect(checkInResponse.status).toBe(200);
    expect(checkInResponse.body.session).toMatchObject({
      employeeUserId: "staff-1",
      status: "working",
      workDate: "2026-07-27",
    });

    const checkOutResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
        .set("Authorization", ownerSessionHeader())
        .send({ action: "check_out", workDate: "2026-07-27" }),
    );

    expect(checkOutResponse.status).toBe(200);
    expect(checkOutResponse.body.session.status).toBe("completed");
    expect(checkOutResponse.body.session.workedMinutes).toBeGreaterThanOrEqual(0);
  });

  it("allows a manager to update an hourly employee in the same store", async () => {
    const response = await withRequestDefaults(
      request(app)
        .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
        .set("Authorization", managerAuth())
        .send({ action: "check_in", workDate: "2026-07-27" }),
    );

    expect(response.status).toBe(200);
    expect(response.body.session).toMatchObject({
      employeeUserId: "staff-1",
      status: "working",
    });
  });

  it("rejects a manager targeting another store", async () => {
    const response = await withRequestDefaults(
      request(app)
        .put("/api/v1/stores/branch-2/employee-time-tracking/staff-2")
        .set("Authorization", managerAuth())
        .send({ action: "check_in", workDate: "2026-07-27" }),
    );

    expect(response.status).toBe(403);
    expect(response.body.type).toBe("/stores/employee-time-tracking/forbidden");
  });

  it("rejects a non-hourly target", async () => {
    const employee = state.users.get("staff-1");
    if (!employee) throw new Error("Missing staff-1 fixture");
    state.users.set("staff-1", { ...employee, compensationModel: "commission" });

    const response = await withRequestDefaults(
      request(app)
        .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
        .set("Authorization", ownerSessionHeader())
        .send({ action: "check_in", workDate: "2026-07-27" }),
    );

    expect(response.status).toBe(403);
  });

  it("rejects an inactive target", async () => {
    const employee = state.users.get("staff-1");
    if (!employee) throw new Error("Missing staff-1 fixture");
    state.users.set("staff-1", { ...employee, active: false });

    const response = await withRequestDefaults(
      request(app)
        .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
        .set("Authorization", ownerSessionHeader())
        .send({ action: "check_in", workDate: "2026-07-27" }),
    );

    expect(response.status).toBe(403);
  });

  it("requires checkout of an older session before owner check-in", async () => {
    const checkedInAt = Date.now() - 24 * 60 * 60 * 1000;
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

    const response = await withRequestDefaults(
      request(app)
        .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
        .set("Authorization", ownerSessionHeader())
        .send({ action: "check_in", workDate: "2026-07-27" }),
    );

    expect(response.status).toBe(409);
    expect(response.body.type).toBe("/stores/employee-time-tracking/conflict");
  });

  it("allows owner manual checkout with a safe duration", async () => {
    const now = Date.now();
    const checkedInAt = now - 90 * 60 * 1000;
    const checkedOutAt = now - 30 * 60 * 1000;
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

    const response = await withRequestDefaults(
      request(app)
        .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
        .set("Authorization", ownerSessionHeader())
        .send({ action: "check_out", workDate: "2026-07-27", checkedOutAt }),
    );

    expect(response.status).toBe(200);
    expect(response.body.session).toMatchObject({
      status: "completed",
      checkedOutAt,
      workedMinutes: 60,
    });
  });

  it("keeps concurrent owner check-ins visible until atomic transition hardening", async () => {
    const waitForSessionReads = createTwoCallBarrier();
    const getSession = vi
      .spyOn(firestoreRepository.shop.timeTracking, "getEmployeeTimeTracking")
      .mockImplementation(async () => {
        await waitForSessionReads();
        return null;
      });
    const waitForPendingReads = createTwoCallBarrier();
    const listOpenSessions = vi
      .spyOn(firestoreRepository.shop.timeTracking, "listOpenEmployeeTimeTracking")
      .mockImplementation(async () => {
        await waitForPendingReads();
        return [];
      });

    try {
      const responses = await Promise.all([
        withRequestDefaults(
          request(app)
            .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
            .set("Authorization", ownerSessionHeader())
            .send({ action: "check_in", workDate: "2026-07-27" }),
        ),
        withRequestDefaults(
          request(app)
            .put("/api/v1/stores/branch-1/employee-time-tracking/staff-1")
            .set("Authorization", ownerSessionHeader())
            .send({ action: "check_in", workDate: "2026-07-27" }),
        ),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 200]);
    } finally {
      getSession.mockRestore();
      listOpenSessions.mockRestore();
    }
  });
});
