import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  app,
  ownerSessionHeader,
  withRequestDefaults,
  getAttendanceOrThrow,
} from "./backend-api-fixture.js";

describe("E2E: Daily Operations", () => {
  it.skip("completes full daily flow: staff creates attendance, owner reviews and closes work day", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const ownerAuth = ownerSessionHeader();

    const createAttendance1Response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", staffAuth)
        .send({
          date: "2026-05-10T09:00:00.000Z",
          endDate: "2026-05-10T10:00:00.000Z",
          customerName: "Customer A",
          employeeUserId: "staff-1",
          services: [
            {
              id: "frontend-service-1",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              category: "nail",
              price: "50",
              duration: "60",
              employees: [
                {
                  employeeId: "staff-1",
                  percentage: 100,
                },
              ],
            },
          ],
        }),
    );
    expect(createAttendance1Response.status).toBe(201);
    expect(createAttendance1Response.body.item.status).toBe("open");

    const attendance1Id = createAttendance1Response.body.item.id as string;

    const createAttendance2Response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", staffAuth)
        .send({
          date: "2026-05-10T11:00:00.000Z",
          endDate: "2026-05-10T12:00:00.000Z",
          customerName: "Customer B",
          employeeUserId: "staff-1",
          services: [
            {
              id: "frontend-service-2",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              category: "nail",
              price: "50",
              duration: "60",
              employees: [
                {
                  employeeId: "staff-1",
                  percentage: 60,
                },
                {
                  employeeId: "staff-lead-1",
                  percentage: 40,
                },
              ],
            },
          ],
        }),
    );
    expect(createAttendance2Response.status).toBe(201);

    const attendance2Id = createAttendance2Response.body.item.id as string;

    const attendanceListResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances")
        .query({ workDate: "2026-05-10", status: "open" })
        .set("Authorization", ownerAuth),
    );
    expect(attendanceListResponse.status).toBe(200);
    expect(attendanceListResponse.body.meta.openCount).toBeGreaterThanOrEqual(2);

    // staff-1 confirms the whole work day in one action; attendance records stay unchanged.
    const closeDayResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", staffAuth)
        .send({ workDate: "2026-05-10" }),
    );
    expect(closeDayResponse.status).toBe(200);
    expect(closeDayResponse.body.attendanceCount).toBeGreaterThanOrEqual(2);

    const settlementPreviewResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({
          workDate: "2026-05-10",
          ownerCommissionRate: "40",
          ownerDiscountSharePercent: "50",
          discountMethod: "equal",
        })
        .set("Authorization", ownerAuth),
    );
    expect(settlementPreviewResponse.status).toBe(200);
    expect(settlementPreviewResponse.body.items.length).toBeGreaterThanOrEqual(2);

    const closeWorkDayResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/work-day-settlements").set("Authorization", ownerAuth).send({
        workDate: "2026-05-10",
        ownerCommissionRate: 40,
        ownerDiscountCoverageRate: 50,
        discountMethod: "equal",
      }),
    );
    expect(closeWorkDayResponse.status).toBe(201);
    expect(closeWorkDayResponse.body).toMatchObject({
      storeId: "branch-1",
      workDate: "2026-05-10",
    });

    expect(getAttendanceOrThrow(attendance1Id).status).toBe("open");
    expect(getAttendanceOrThrow(attendance2Id).status).toBe("open");
  });

  it("completes daily flow with discounts and multiple staff members", async () => {
    const ownerAuth = ownerSessionHeader();

    const createAttendanceResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2026-05-11T09:00:00",
          endDate: "2026-05-11T10:00:00",
          storeId: "branch-1",
          customerName: "Discount Customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "service-1",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              category: "nail",
              price: 50,
              duration: 60,
              employees: [
                { employeeId: "staff-1", percentage: 50 },
                { employeeId: "staff-lead-1", percentage: 50 },
              ],
            },
          ],
          discount: {
            allocationMode: "attendance",
            type: "amount",
            value: 10,
            splitMode: "all_assignees",
            ownerCoverageRate: 50,
          },
        }),
    );
    expect(createAttendanceResponse.status).toBe(201);
    expect(createAttendanceResponse.body.item.discountAmount).toBe(10);
    expect(createAttendanceResponse.body.item.totalAmount).toBe(40);

    const attendanceId = createAttendanceResponse.body.item.id as string;

    expect(getAttendanceOrThrow(attendanceId)).toMatchObject({
      status: "closed",
      source: "walk_in",
      bookingStatus: "confirmed",
    });

    const settlementPreviewResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/work-days/settlement-preview")
        .query({
          workDate: "2026-05-11",
          ownerCommissionRate: "40",
          ownerDiscountSharePercent: "50",
          discountMethod: "per_order",
          attendanceDiscountOwnerShares: JSON.stringify({
            [attendanceId]: 50,
          }),
        })
        .set("Authorization", ownerAuth),
    );
    expect(settlementPreviewResponse.status).toBe(200);
    expect(settlementPreviewResponse.body.preview.totalDiscount).toBe(10);

    // Every responsible employee closes the work day once before owner settlement.
    const employeeCloseResponses = await Promise.all(
      ["staff-1", "staff-lead-1"].map((uid) =>
        withRequestDefaults(
          request(app)
            .put("/api/v1/me/work-day-closings")
            .set(
              "Authorization",
              ownerSessionHeader({ uid, role: "employee", storeId: "branch-1" }),
            )
            .send({ workDate: "2026-05-11" }),
        ),
      ),
    );
    expect(employeeCloseResponses.map((response) => response.status)).toEqual([200, 200]);
    expect(getAttendanceOrThrow(attendanceId).status).toBe("closed");

    const closeWorkDayResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/work-day-settlements")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-05-11",
          ownerCommissionRate: 40,
          ownerDiscountCoverageRate: 50,
          discountMethod: "per_order",
          attendanceDiscountOwnerShares: {
            [attendanceId]: 50,
          },
        }),
    );
    expect(closeWorkDayResponse.status).toBe(201);
    // Owner settlement leaves the completed walk-in attendance closed.
    expect(getAttendanceOrThrow(attendanceId).status).toBe("closed");
  });

  it.skip("completes daily flow with quick custom services", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const ownerAuth = ownerSessionHeader();

    const createQuickServiceResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", staffAuth)
        .send({
          date: "2026-05-12T14:00:00.000Z",
          endDate: "2026-05-12T14:30:00.000Z",
          customerName: "Quick Service Customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "quick-service-1",
              name: "Nail Repair",
              category: "other",
              price: "15",
              duration: "30",
              employees: [
                {
                  employeeId: "staff-1",
                  percentage: 100,
                },
              ],
            },
          ],
        }),
    );
    expect(createQuickServiceResponse.status).toBe(201);
    expect(createQuickServiceResponse.body.item.services[0].type).toBe("custom");

    const attendanceId = createQuickServiceResponse.body.item.id as string;

    const closeDayResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", staffAuth)
        .send({ workDate: "2026-05-12" }),
    );
    expect(closeDayResponse.status).toBe(200);
    expect(closeDayResponse.body.attendanceCount).toBe(1);
    expect(getAttendanceOrThrow(attendanceId).status).toBe("open");

    const closeWorkDayResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/work-day-settlements").set("Authorization", ownerAuth).send({
        workDate: "2026-05-12",
        ownerCommissionRate: 40,
        ownerDiscountCoverageRate: 0,
        discountMethod: "equal",
      }),
    );
    expect(closeWorkDayResponse.status).toBe(201);
  });

  it("handles error when staff tries to close work day", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const closeWorkDayResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/work-day-settlements").set("Authorization", staffAuth).send({
        workDate: "2026-05-13",
        ownerCommissionRate: 40,
        ownerDiscountCoverageRate: 0,
        discountMethod: "equal",
      }),
    );
    expect(closeWorkDayResponse.status).toBe(403);
  });

  it("handles error when trying to close work day twice", async () => {
    const ownerAuth = ownerSessionHeader();

    const createAttendanceResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2026-05-14T09:00:00",
          endDate: "2026-05-14T10:00:00",
          storeId: "branch-1",
          employeeUserId: "staff-1",
          services: [
            {
              id: "service-1",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              category: "nail",
              price: 50,
              duration: 60,
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(createAttendanceResponse.status).toBe(201);

    const attendanceId = createAttendanceResponse.body.item.id as string;

    expect(getAttendanceOrThrow(attendanceId)).toMatchObject({
      status: "closed",
      source: "walk_in",
      bookingStatus: "confirmed",
    });

    // The responsible employee closes the day before owner settlement.
    const staffAuth = ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" });
    const closeEmployeeDayResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", staffAuth)
        .send({ workDate: "2026-05-14" }),
    );
    expect(closeEmployeeDayResponse.status).toBe(200);
    expect(getAttendanceOrThrow(attendanceId).status).toBe("closed");

    const closeWorkDayResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/work-day-settlements").set("Authorization", ownerAuth).send({
        workDate: "2026-05-14",
        ownerCommissionRate: 40,
        ownerDiscountCoverageRate: 0,
        discountMethod: "equal",
      }),
    );
    expect(closeWorkDayResponse.status).toBe(201);
    expect(getAttendanceOrThrow(attendanceId).status).toBe("closed");

    const closeWorkDayAgainResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/work-day-settlements").set("Authorization", ownerAuth).send({
        workDate: "2026-05-14",
        ownerCommissionRate: 40,
        ownerDiscountCoverageRate: 0,
        discountMethod: "equal",
      }),
    );
    expect(closeWorkDayAgainResponse.status).toBe(409);
  });
});
