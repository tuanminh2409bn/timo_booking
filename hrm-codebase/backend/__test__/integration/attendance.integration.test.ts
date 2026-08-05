import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  app,
  ownerSessionHeader,
  withRequestDefaults,
  getAttendanceOrThrow,
  seedClosedWorkDaySettlement,
  state,
} from "./backend-api-fixture.js";

const getCreatedAttendanceId = (body: { id?: string; item?: { id?: string } }) =>
  body.item?.id ?? body.id;

describe("backend API integration: attendance and settlement", () => {
  it("keeps quick attendance services local and rejects invalid catalog references", async () => {
    const ownerAuth = ownerSessionHeader();
    const initialServiceCount = state.services.size;

    const quickServiceResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-05-06T09:00:00.000Z",
          endDate: "2099-05-06T09:30:00.000Z",
          customerName: "Walk-in Customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "quick-service-1",
              name: "Quick repair",
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
    expect(quickServiceResponse.status).toBe(201);
    expect(state.services.size).toBe(initialServiceCount);
    expect(quickServiceResponse.body.item.services[0].sourceServiceId).toBeUndefined();

    const quickAttendance = getAttendanceOrThrow(
      getCreatedAttendanceId(quickServiceResponse.body)!,
    );
    expect(quickAttendance.services[0]).toMatchObject({
      id: "quick-service-1",
      type: "custom",
      name: "Quick repair",
      price: 15,
    });

    const invalidCreateResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2026-05-06T10:00:00.000Z",
          endDate: "2026-05-06T10:30:00.000Z",
          customerName: "Invalid Customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "frontend-service-2",
              sourceServiceId: "missing-service",
              name: "Unknown catalog service",
              category: "other",
              price: "20",
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
    expect(invalidCreateResponse.status).toBe(400);

    const crossBranchServiceResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-2/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2026-05-06T10:00:00.000Z",
          endDate: "2026-05-06T10:30:00.000Z",
          customerName: "Wrong Branch Customer",
          employeeUserId: "staff-2",
          services: [
            {
              id: "frontend-service-4",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              category: "nail",
              price: "20",
              duration: "30",
              employees: [
                {
                  employeeId: "staff-2",
                  percentage: 100,
                },
              ],
            },
          ],
        }),
    );
    expect(crossBranchServiceResponse.status).toBe(400);

    const invalidUpdateResponse = await withRequestDefaults(
      request(app)
        .patch(
          `/api/v1/stores/branch-1/attendances/${getCreatedAttendanceId(quickServiceResponse.body)}`,
        )
        .set("Authorization", ownerAuth)
        .send({
          date: "2026-05-06T10:00:00.000Z",
          endDate: "2026-05-06T10:30:00.000Z",
          customerName: "Invalid Update",
          storeId: "branch-1",
          employeeUserId: "staff-1",
          services: [
            {
              id: "frontend-service-3",
              sourceServiceId: "missing-service",
              name: "Unknown catalog service",
              category: "other",
              price: "20",
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
    expect(invalidUpdateResponse.status).toBe(400);
  });

  it("creates owner-assisted future attendance as open and exposes it to owner", async () => {
    const ownerAuth = ownerSessionHeader();

    const createResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-06-15T09:00:00.000Z",
          endDate: "2099-06-15T10:00:00.000Z",
          customerName: "Future assisted customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "future-assisted-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.meta).toMatchObject({
      workDate: "2099-06-15",
      createMode: "owner_assisted_open",
      recalculatedSettlementDates: [],
    });
    expect(createResponse.body.item).toMatchObject({
      status: "open",
      bookingStatus: "confirmed",
      source: "manual_booking",
      createdByType: "owner",
      createdByUserId: "owner-1",
      createdByRole: "owner",
      updatedByUserId: "owner-1",
      updatedByRole: "owner",
    });
    expect(createResponse.body.item.attendanceCode).toMatch(/^CC-\d+$/);
    const createdAttendanceId = getCreatedAttendanceId(createResponse.body)!;

    const ownerListResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances")
        .query({ workDate: "2099-06-15" })
        .set("Authorization", ownerAuth),
    );
    expect(ownerListResponse.status).toBe(200);
    expect(ownerListResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdAttendanceId,
          attendanceCode: createResponse.body.item.attendanceCode,
          createdBy: "owner-1",
        }),
      ]),
    );
  });

  it("creates manager future bookings and employee walk-ins with actor metadata", async () => {
    const managerAuth = ownerSessionHeader({
      uid: "manager-1",
      role: "manager",
      storeId: "branch-1",
    });
    const managerResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", managerAuth)
        .send({
          date: "2099-06-22T09:00:00.000Z",
          endDate: "2099-06-22T10:00:00.000Z",
          customerName: "Manager booking customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "manager-booking-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(managerResponse.status).toBe(201);
    expect(managerResponse.body.item).toMatchObject({
      source: "manual_booking",
      status: "open",
      bookingStatus: "confirmed",
      createdByType: "manager",
      createdByUserId: "manager-1",
      createdByRole: "manager",
      updatedByUserId: "manager-1",
      updatedByRole: "manager",
    });

    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const startTimestamp = Date.now() - 60 * 60 * 1000;
    const employeeResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", employeeAuth)
        .send({
          date: new Date(startTimestamp).toISOString(),
          endDate: new Date(startTimestamp + 30 * 60 * 1000).toISOString(),
          customerName: "Employee walk-in customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "employee-walk-in-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "30",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(employeeResponse.status).toBe(201);
    expect(employeeResponse.body.item).toMatchObject({
      source: "walk_in",
      status: "closed",
      bookingStatus: "confirmed",
      createdByType: "employee",
      createdByUserId: "staff-1",
      createdByRole: "employee",
      updatedByUserId: "staff-1",
      updatedByRole: "employee",
    });
  });

  it("forces manual booking status to confirmed and lets patch cancel it", async () => {
    const ownerAuth = ownerSessionHeader();

    const defaultResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-06-16T09:00:00.000Z",
          endDate: "2099-06-16T10:00:00.000Z",
          customerName: "Booking status customer",
          source: "online_booking",
          employeeUserId: "staff-1",
          services: [
            {
              id: "booking-status-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(defaultResponse.status).toBe(201);
    expect(defaultResponse.body.item.bookingStatus).toBe("confirmed");
    expect(defaultResponse.body.item.source).toBe("manual_booking");

    const requestedResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-06-17T09:00:00.000Z",
          endDate: "2099-06-17T10:00:00.000Z",
          customerName: "Requested customer",
          bookingStatus: "requested",
          employeeUserId: "staff-1",
          services: [
            {
              id: "requested-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(requestedResponse.status).toBe(201);
    expect(requestedResponse.body.item.bookingStatus).toBe("confirmed");
    const requestedId = getCreatedAttendanceId(requestedResponse.body)!;
    expect(getAttendanceOrThrow(requestedId).bookingStatus).toBe("confirmed");

    const patchResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${requestedId}`)
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-06-17T09:00:00.000Z",
          endDate: "2099-06-17T10:00:00.000Z",
          storeId: "branch-1",
          customerName: "Requested customer",
          bookingStatus: "cancelled",
          employeeUserId: "staff-1",
          services: [
            {
              id: "requested-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.item.bookingStatus).toBe("cancelled");
    expect(getAttendanceOrThrow(requestedId)).toMatchObject({
      bookingStatus: "cancelled",
      source: "manual_booking",
      createdByUserId: "owner-1",
      createdByRole: "owner",
      updatedByUserId: "owner-1",
      updatedByRole: "owner",
    });
  });

  it("requires complete assignment before confirmation and limits future quick actions to cancellation", async () => {
    const ownerAuth = ownerSessionHeader();
    const explicitIncompleteResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2026-05-07T09:00:00.000Z",
          endDate: "2026-05-07T10:00:00.000Z",
          customerName: "Explicit incomplete confirmation customer",
          bookingStatus: "confirmed",
          services: [],
        }),
    );

    expect(explicitIncompleteResponse.status).toBe(409);
    expect(explicitIncompleteResponse.body.type).toBe(
      "/stores/attendances/booking-confirmation-incomplete",
    );

    const incompleteResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2026-05-08T09:00:00.000Z",
          endDate: "2026-05-08T10:00:00.000Z",
          customerName: "Incomplete confirmation customer",
          services: [],
        }),
    );

    expect(incompleteResponse.status).toBe(409);
    expect(incompleteResponse.body.type).toBe(
      "/stores/attendances/booking-confirmation-incomplete",
    );

    const quickDraftResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: new Date(Date.now() - 15 * 60 * 1000),
          endDate: new Date(),
          customerName: "Quick draft customer",
          bookingSource: "quick_attendance",
          bookingStatus: "processing",
          services: [],
        }),
    );

    expect(quickDraftResponse.status).toBe(201);
    expect(quickDraftResponse.body.item.bookingStatus).toBe("processing");
    expect(quickDraftResponse.body.item.services).toEqual([]);

    const futureResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-06-18T09:00:00.000Z",
          endDate: "2099-06-18T10:00:00.000Z",
          customerName: "Future attendance customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "future-confirmation-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(futureResponse.status).toBe(201);
    const futureId = getCreatedAttendanceId(futureResponse.body)!;

    const futureNoShowResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${futureId}`)
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-06-18T09:00:00.000Z",
          endDate: "2099-06-18T10:00:00.000Z",
          storeId: "branch-1",
          bookingStatus: "no_show",
          services: [],
        }),
    );

    expect(futureNoShowResponse.status).toBe(409);
    expect(futureNoShowResponse.body.type).toBe(
      "/stores/attendances/future-booking-status-not-allowed",
    );

    const futureCancelResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${futureId}`)
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-06-18T09:00:00.000Z",
          endDate: "2099-06-18T10:00:00.000Z",
          storeId: "branch-1",
          bookingStatus: "cancelled",
          services: [],
        }),
    );

    expect(futureCancelResponse.status).toBe(200);
    expect(futureCancelResponse.body.item.bookingStatus).toBe("cancelled");
  });

  it("creates owner walk-in attendance on a past UNSETTLED day as completed", async () => {
    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerSessionHeader())
        .send({
          date: "2026-05-06T09:00:00.000Z",
          endDate: "2026-05-06T10:00:00.000Z",
          customerName: "Past open-day customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "past-open-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(response.status).toBe(201);
    expect(response.body.meta).toMatchObject({
      workDate: "2026-05-06",
      createMode: "owner_assisted_open",
      recalculatedSettlementDates: [],
    });
    expect(response.body.item).toMatchObject({
      status: "closed",
      bookingStatus: "confirmed",
      source: "walk_in",
    });
    expect(getAttendanceOrThrow(getCreatedAttendanceId(response.body)!)).toMatchObject({
      employeeUserId: "staff-1",
      status: "closed",
      source: "walk_in",
      createdBy: "owner-1",
      createdByRole: "owner",
    });
  });

  it("blocks an employee from logging attendance older than the 7-day window", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    // Ngày quá xa (hàng chục ngày trước hôm nay) → vượt cửa sổ 7 ngày của thợ.
    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", staffAuth)
        .send({
          date: "2026-01-02T09:00:00.000Z",
          endDate: "2026-01-02T10:00:00.000Z",
          customerName: "Too-old customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "too-old-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(response.status).toBe(403);
    expect(response.body.type).toBe("/stores/attendances/past-window-exceeded");
  });

  it("keeps the declared main assignee even when a co-worker is listed first in the service", async () => {
    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerSessionHeader())
        .send({
          date: "2026-05-06T09:00:00.000Z",
          endDate: "2026-05-06T10:00:00.000Z",
          customerName: "Co-worker listed first",
          // Thợ chính khai ở màn "Thông tin".
          employeeUserId: "staff-1",
          services: [
            {
              id: "main-assignee-order-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              // Thợ làm cùng đứng TRƯỚC thợ chính — thứ tự trong mảng không được quyết định ai là chính.
              employees: [
                { employeeId: "staff-lead-1", percentage: 40 },
                { employeeId: "staff-1", percentage: 60 },
              ],
            },
          ],
        }),
    );

    expect(response.status).toBe(201);
    expect(getAttendanceOrThrow(getCreatedAttendanceId(response.body)!)).toMatchObject({
      employeeUserId: "staff-1",
    });
  });

  it("rejects an employee creating an attendance that belongs to nobody", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", staffAuth)
        .send({
          date: "2026-05-06T09:00:00.000Z",
          endDate: "2026-05-06T10:00:00.000Z",
          customerName: "Attendance with no assignee",
          // Không khai thợ chính, service cũng không gán ai → chấm công không thuộc về ai.
          services: [
            {
              id: "no-assignee-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [],
            },
          ],
        }),
    );

    expect(response.status).toBe(403);
    expect(response.body.type).toBe("/stores/attendances/employee-assignee-required");
    expect(response.body.message).toBe(
      "Employees can only create attendance assigned to themselves",
    );
  });

  it("allows an employee to quick-create a draft assigned to themselves", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", staffAuth)
        .send({
          date: new Date(Date.now() - 15 * 60 * 1000),
          endDate: new Date(),
          employeeUserId: "staff-1",
          customerName: "Employee quick draft",
          bookingSource: "quick_attendance",
          bookingStatus: "processing",
          services: [],
        }),
    );

    expect(response.status).toBe(201);
    expect(response.body.item.bookingStatus).toBe("processing");
    expect(response.body.item.services).toEqual([]);
    expect(getAttendanceOrThrow(getCreatedAttendanceId(response.body)!)).toMatchObject({
      employeeUserId: "staff-1",
      mainAssigneeUserId: "staff-1",
      bookingStatus: "processing",
    });
  });

  it("rejects an employee creating an attendance as the assistant assignee", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", staffAuth)
        .send({
          date: "2026-07-27T09:00:00.000Z",
          endDate: "2026-07-27T10:00:00.000Z",
          customerName: "Assistant-created attendance",
          mainAssigneeUserId: "staff-lead-1",
          assistantAssigneeUserId: "staff-1",
          services: [
            {
              id: "assistant-created-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [
                { employeeId: "staff-lead-1", percentage: 60 },
                { employeeId: "staff-1", percentage: 40 },
              ],
            },
          ],
        }),
    );

    expect(response.status).toBe(403);
    expect(response.body.type).toBe("/stores/attendances/employee-assignee-required");
  });

  it("lets the assigned employee edit an owner-created attendance without granting delete access", async () => {
    const ownerAuth = ownerSessionHeader();
    const assignedStaffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const unrelatedStaffAuth = ownerSessionHeader({
      uid: "staff-lead-1",
      role: "employee",
      storeId: "branch-1",
    });

    const createResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-06-20T09:00:00.000Z",
          endDate: "2099-06-20T10:00:00.000Z",
          customerName: "Owner-created attendance",
          employeeUserId: "staff-1",
          services: [
            {
              id: "owner-created-assigned-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(createResponse.status).toBe(201);
    const attendanceId = getCreatedAttendanceId(createResponse.body)!;

    const assignedUpdateResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", assignedStaffAuth)
        .send({
          date: "2099-06-20T09:15:00.000Z",
          endDate: "2099-06-20T10:15:00.000Z",
          customerName: "Should remain private",
          note: "Updated by assigned employee",
          employeeUserId: "staff-1",
          services: [
            {
              id: "owner-created-assigned-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(assignedUpdateResponse.status).toBe(200);
    expect(getAttendanceOrThrow(attendanceId)).toMatchObject({
      customerName: "Owner-created attendance",
      note: "Updated by assigned employee",
      employeeUserId: "staff-1",
      createdBy: "owner-1",
      updatedBy: "staff-1",
    });

    const unrelatedUpdateResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", unrelatedStaffAuth)
        .send({
          date: "2099-06-20T09:30:00.000Z",
          endDate: "2099-06-20T10:30:00.000Z",
          customerName: "Unrelated employee update",
          employeeUserId: "staff-lead-1",
          services: [
            {
              id: "owner-created-assigned-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-lead-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(unrelatedUpdateResponse.status).toBe(403);
    expect(unrelatedUpdateResponse.body.type).toBe(
      "/stores/attendances/forbidden-attendance",
    );

    const assignedDeleteResponse = await withRequestDefaults(
      request(app)
        .delete(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", assignedStaffAuth),
    );

    expect(assignedDeleteResponse.status).toBe(403);
    expect(assignedDeleteResponse.body.type).toBe(
      "/stores/attendances/forbidden-attendance",
    );
  });

  it("enforces main and assistant permissions before the work day is closed", async () => {
    const ownerAuth = ownerSessionHeader();
    const mainAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const assistantAuth = ownerSessionHeader({
      uid: "staff-lead-1",
      role: "employee",
      storeId: "branch-1",
    });
    const seedAttendance = getAttendanceOrThrow("attendance-1");
    const attendanceId = "attendance-main-assistant";
    const bookingId = "booking-main-assistant";
    const serviceEmployees = [
      {
        employeeUserId: "staff-1",
        employeeName: "Staff One",
        workerType: "main" as const,
        percentage: 60,
        shareAmount: 30,
      },
      {
        employeeUserId: "staff-lead-1",
        employeeName: "Lead One",
        workerType: "assistant" as const,
        percentage: 40,
        shareAmount: 20,
      },
    ];
    state.attendances.set(attendanceId, {
      ...seedAttendance,
      id: attendanceId,
      bookingId,
      mainAssigneeUserId: "staff-1",
      assistantAssigneeUserId: "staff-lead-1",
      employeeUserId: "staff-1",
      workDate: "2026-07-27",
      storeWorkDateKey: "branch-1__2026-07-27",
      createdBy: "owner-1",
      createdByType: "owner",
      createdByUserId: "owner-1",
      createdByRole: "owner",
      source: "manual_booking",
      status: "open",
      bookingStatus: "confirmed",
      assignees: serviceEmployees,
      services: seedAttendance.services.map((service) => ({
        ...service,
        employees: serviceEmployees,
      })),
    });

    const requestBody = {
      date: "2026-07-27T09:00:00.000Z",
      endDate: "2026-07-27T10:00:00.000Z",
      mainAssigneeUserId: "staff-1",
      assistantAssigneeUserId: "staff-lead-1",
      note: "Updated attendance",
      services: [
        {
          id: "service-1",
          sourceServiceId: "service-1",
          name: "Classic Manicure",
          price: "50",
          duration: "60",
          employees: [
            { employeeId: "staff-1", percentage: 60, workerType: "main" },
            { employeeId: "staff-lead-1", percentage: 40, workerType: "assistant" },
          ],
        },
      ],
    };

    const assistantUpdateResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", assistantAuth)
        .send(requestBody),
    );
    expect(assistantUpdateResponse.status).toBe(403);

    const assistantDeleteResponse = await withRequestDefaults(
      request(app)
        .delete(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", assistantAuth),
    );
    expect(assistantDeleteResponse.status).toBe(403);

    const mainCancelResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", mainAuth)
        .send({ ...requestBody, bookingStatus: "cancelled" }),
    );
    expect(mainCancelResponse.status).toBe(403);

    const mainCompleteResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", mainAuth)
        .send({
          ...requestBody,
          bookingStatus: "confirmed",
          attendanceStatus: "completed",
        }),
    );
    expect(mainCompleteResponse.status).toBe(200);
    expect(getAttendanceOrThrow(attendanceId)).toMatchObject({
      status: "closed",
      bookingStatus: "confirmed",
      updatedByUserId: "staff-1",
      updatedByRole: "employee",
    });

    const ownerChangeMainResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", ownerAuth)
        .send({
          ...requestBody,
          mainAssigneeUserId: "staff-lead-1",
          assistantAssigneeUserId: undefined,
          services: [
            {
              id: "service-1",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-lead-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(ownerChangeMainResponse.status).toBe(200);
    expect(getAttendanceOrThrow(attendanceId)).toMatchObject({
      employeeUserId: "staff-lead-1",
      mainAssigneeUserId: "staff-lead-1",
    });
    expect(getAttendanceOrThrow(attendanceId).assistantAssigneeUserId).toBeUndefined();
  });

  it("keeps completed local but propagates no-show and cancellation across a booking", async () => {
    const ownerAuth = ownerSessionHeader();
    const seedAttendance = getAttendanceOrThrow("attendance-1");
    const bookingId = "booking-shared-status";
    const buildSibling = (id: string, mainAssigneeUserId: string) => ({
      ...seedAttendance,
      id,
      bookingId,
      workDate: "2026-07-27",
      storeWorkDateKey: "branch-1__2026-07-27",
      employeeUserId: mainAssigneeUserId,
      mainAssigneeUserId,
      assistantAssigneeUserId: undefined,
      createdBy: "owner-1",
      createdByType: "owner" as const,
      createdByUserId: "owner-1",
      createdByRole: "owner" as const,
      source: "manual_booking" as const,
      status: "open" as const,
      bookingStatus: "confirmed" as const,
      assignees: [
        {
          employeeUserId: mainAssigneeUserId,
          percentage: 100,
          workerType: "main" as const,
        },
      ],
      services: seedAttendance.services.map((service) => ({
        ...service,
        employees: [
          {
            employeeUserId: mainAssigneeUserId,
            percentage: 100,
            workerType: "main" as const,
          },
        ],
      })),
    });
    state.attendances.set("attendance-shared-main", buildSibling("attendance-shared-main", "staff-1"));
    state.attendances.set(
      "attendance-shared-sibling",
      buildSibling("attendance-shared-sibling", "staff-lead-1"),
    );

    const completionResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/attendances/attendance-shared-main")
        .set("Authorization", ownerAuth)
        .send({
          date: "2026-07-27T09:00:00.000Z",
          endDate: "2026-07-27T10:00:00.000Z",
          mainAssigneeUserId: "staff-1",
          bookingStatus: "confirmed",
          attendanceStatus: "completed",
          services: [
            {
              id: "service-1",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(completionResponse.status).toBe(200);
    expect(getAttendanceOrThrow("attendance-shared-main")).toMatchObject({
      status: "closed",
      bookingStatus: "confirmed",
    });
    expect(getAttendanceOrThrow("attendance-shared-sibling")).toMatchObject({
      status: "open",
      bookingStatus: "confirmed",
    });

    const noShowResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/attendances/attendance-shared-sibling")
        .set("Authorization", ownerAuth)
        .send({
          date: "2026-07-27T09:00:00.000Z",
          endDate: "2026-07-27T10:00:00.000Z",
          mainAssigneeUserId: "staff-lead-1",
          bookingStatus: "no_show",
          services: [
            {
              id: "service-1",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-lead-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(noShowResponse.status).toBe(200);
    expect(getAttendanceOrThrow("attendance-shared-main").bookingStatus).toBe("no_show");
    expect(getAttendanceOrThrow("attendance-shared-sibling").bookingStatus).toBe("no_show");

    const cancellationResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/attendances/attendance-shared-main")
        .set("Authorization", ownerAuth)
        .send({
          date: "2026-07-27T09:00:00.000Z",
          endDate: "2026-07-27T10:00:00.000Z",
          mainAssigneeUserId: "staff-1",
          bookingStatus: "cancelled",
          services: [
            {
              id: "service-1",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(cancellationResponse.status).toBe(200);
    expect(getAttendanceOrThrow("attendance-shared-main").bookingStatus).toBe("cancelled");
    expect(getAttendanceOrThrow("attendance-shared-sibling").bookingStatus).toBe("cancelled");
  });

  it("prevents employee updates from assigning attendance away from themselves", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const ownerAuth = ownerSessionHeader();

    const createResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-07-01T09:00:00.000Z",
          endDate: "2099-07-01T10:00:00.000Z",
          customerName: "Employee owned attendance",
          employeeUserId: "staff-1",
          services: [
            {
              id: "employee-owned-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(createResponse.status).toBe(201);
    const attendanceId = getCreatedAttendanceId(createResponse.body)!;

    const employeeUpdateResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", staffAuth)
        .send({
          date: "2099-07-01T09:00:00.000Z",
          endDate: "2099-07-01T10:00:00.000Z",
          customerName: "Reassigned by employee",
          employeeUserId: "staff-lead-1",
          services: [
            {
              id: "employee-owned-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-lead-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(employeeUpdateResponse.status).toBe(403);
    expect(employeeUpdateResponse.body.type).toBe("/stores/attendances/forbidden-attendance");
    expect(getAttendanceOrThrow(attendanceId)).toMatchObject({
      customerName: "Employee owned attendance",
      employeeUserId: "staff-1",
    });

    const ownerUpdateResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-07-01T09:00:00.000Z",
          endDate: "2099-07-01T10:00:00.000Z",
          customerName: "Reassigned by owner",
          employeeUserId: "staff-lead-1",
          services: [
            {
              id: "employee-owned-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-lead-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(ownerUpdateResponse.status).toBe(200);
    expect(getAttendanceOrThrow(attendanceId)).toMatchObject({
      customerName: "Reassigned by owner",
      employeeUserId: "staff-lead-1",
    });
  });

  it("blocks an employee from editing an attendance onto a date older than the 7-day window", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const ownerAuth = ownerSessionHeader();

    // Owner creates the booking; the assigned employee may edit it within their allowed window.
    const createResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-08-01T09:00:00.000Z",
          endDate: "2099-08-01T10:00:00.000Z",
          customerName: "Editable by staff",
          employeeUserId: "staff-1",
          services: [
            {
              id: "seven-day-edit-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(createResponse.status).toBe(201);
    const attendanceId = getCreatedAttendanceId(createResponse.body)!;

    // Thợ dời chấm công về một ngày quá xa (hàng chục ngày trước hôm nay) → vượt cửa sổ 7 ngày.
    const staffEditResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", staffAuth)
        .send({
          date: "2026-01-02T09:00:00.000Z",
          endDate: "2026-01-02T10:00:00.000Z",
          customerName: "Moved too far back",
          employeeUserId: "staff-1",
          services: [
            {
              id: "seven-day-edit-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(staffEditResponse.status).toBe(403);
    expect(staffEditResponse.body.type).toBe("/stores/attendances/past-window-exceeded");
  });

  it("keeps employee attendance collection routes scoped to their assigned store", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const closeWorkDayResponse = await withRequestDefaults(
      request(app)
        .put("/api/v1/me/work-day-closings")
        .set("Authorization", staffAuth)
        .send({ workDate: "2026-05-05" }),
    );
    expect(closeWorkDayResponse.status).toBe(200);

    const ownStoreResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances/calendar")
        .query({ workDate: "2026-05-05", view: "day" })
        .set("Authorization", staffAuth),
    );
    expect(ownStoreResponse.status).toBe(200);
    expect(ownStoreResponse.headers["x-ratelimit-limit"]).toBe("300");
    expect(ownStoreResponse.body.meta.storeId).toBe("branch-1");
    expect(ownStoreResponse.body.employeeWorkDayClosings).toEqual([
      expect.objectContaining({
        workDate: "2026-05-05",
        closedAt: expect.any(Number),
      }),
    ]);

    const otherStoreResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-2/attendances/calendar")
        .query({ workDate: "2026-05-05", view: "day" })
        .set("Authorization", staffAuth),
    );
    expect(otherStoreResponse.status).toBe(403);
    expect(otherStoreResponse.body.type).toBe("/stores/attendances/calendar/forbidden-store");
  });

  it("deletes test attendance data by store for owners and by assignment for employees", async () => {
    const workDate = "2026-05-07";
    const seedAttendance = getAttendanceOrThrow("attendance-1");
    const buildAttendance = (id: string, employeeUserId: string) => ({
      ...seedAttendance,
      id,
      workDate,
      storeWorkDateKey: `branch-1__${workDate}`,
      createdBy: "owner-1",
      employeeUserId,
      mainAssigneeUserId: employeeUserId,
      assigneeUserIds: [employeeUserId],
      assignees: seedAttendance.assignees.map((assignee) => ({
        ...assignee,
        employeeUserId,
      })),
      services: seedAttendance.services.map((service) => ({
        ...service,
        employees: (service.employees ?? []).map((employee) => ({
          ...employee,
          employeeUserId,
        })),
      })),
    });

    state.attendances.set("test-cleanup-staff-1", buildAttendance("test-cleanup-staff-1", "staff-1"));
    state.attendances.set("test-cleanup-staff-2", buildAttendance("test-cleanup-staff-2", "staff-2"));
    state.employeeWorkDayClosings.set(`staff-1__${workDate}`, {
      id: `staff-1__${workDate}`,
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate,
      employeeUserId: "staff-1",
      attendanceIds: ["test-cleanup-staff-1"],
      attendanceVersions: { "test-cleanup-staff-1": seedAttendance.updatedAt },
      closedAt: Date.now(),
      closedByUserId: "staff-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    state.employeeWorkDayClosings.set(`staff-2__${workDate}`, {
      id: `staff-2__${workDate}`,
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate,
      employeeUserId: "staff-2",
      attendanceIds: ["test-cleanup-staff-2"],
      attendanceVersions: { "test-cleanup-staff-2": seedAttendance.updatedAt },
      closedAt: Date.now(),
      closedByUserId: "staff-2",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const employeeResponse = await withRequestDefaults(
      request(app)
        .delete("/api/v1/stores/branch-1/attendances/test-data")
        .query({ workDate })
        .set(
          "Authorization",
          ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" }),
        ),
    );

    expect(employeeResponse.status).toBe(200);
    expect(employeeResponse.body).toMatchObject({
      storeId: "branch-1",
      workDate,
      deletedCount: 1,
      deletedClosingCount: 1,
      scope: "employee",
      employeeUserId: "staff-1",
    });
    expect(state.attendances.has("test-cleanup-staff-1")).toBe(false);
    expect(state.attendances.has("test-cleanup-staff-2")).toBe(true);
    expect(state.employeeWorkDayClosings.has(`staff-1__${workDate}`)).toBe(false);
    expect(state.employeeWorkDayClosings.has(`staff-2__${workDate}`)).toBe(true);

    const ownerResponse = await withRequestDefaults(
      request(app)
        .delete("/api/v1/stores/branch-1/attendances/test-data")
        .query({ workDate })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body).toMatchObject({
      storeId: "branch-1",
      workDate,
      deletedCount: 1,
      deletedClosingCount: 1,
      scope: "store",
    });
    expect(state.attendances.has("test-cleanup-staff-2")).toBe(false);
    expect(state.employeeWorkDayClosings.has(`staff-2__${workDate}`)).toBe(false);
  });

  it("lets an employee open attendance detail when the calendar assignment fields include them", async () => {
    const attendanceId = "attendance-primary-employee";
    const seedAttendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set(attendanceId, {
      ...seedAttendance,
      id: attendanceId,
      employeeUserId: "staff-1",
      assigneeUserIds: ["staff-1"],
      assignees: [],
      services: seedAttendance.services.map((service) => ({
        ...service,
        employees: [],
      })),
      createdBy: "owner-1",
      updatedBy: "owner-1",
    });
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const calendarResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances/calendar")
        .query({ workDate: "2026-05-05", view: "day" })
        .set("Authorization", staffAuth),
    );
    const detailResponse = await withRequestDefaults(
      request(app)
        .get(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", staffAuth),
    );

    expect({
      calendarAttendanceIds: calendarResponse.body.items.map((item: { id: string }) => item.id),
      detailAttendanceId: detailResponse.body.item?.id,
      detailStatus: detailResponse.status,
    }).toEqual({
      calendarAttendanceIds: expect.arrayContaining([attendanceId]),
      detailAttendanceId: attendanceId,
      detailStatus: 200,
    });
  });

  it("blocks an employee from deleting an attendance they did not create, but lets the owner", async () => {
    const ownerAuth = ownerSessionHeader();
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const createResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-06-20T09:00:00.000Z",
          endDate: "2099-06-20T10:00:00.000Z",
          customerName: "Delete attendance customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "delete-attendance-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );
    const attendanceId = getCreatedAttendanceId(createResponse.body)!;

    const employeeDeleteResponse = await withRequestDefaults(
      request(app)
        .delete(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", employeeAuth),
    );
    expect(employeeDeleteResponse.status).toBe(403);
    expect(state.attendances.has(attendanceId)).toBe(true);

    const ownerDeleteResponse = await withRequestDefaults(
      request(app)
        .delete(`/api/v1/stores/branch-1/attendances/${attendanceId}`)
        .set("Authorization", ownerAuth),
    );
    expect(ownerDeleteResponse.status).toBe(200);
    expect(ownerDeleteResponse.body).toMatchObject({
      id: attendanceId,
      storeId: "branch-1",
      workDate: "2099-06-20",
      deleted: true,
    });
    expect(state.attendances.has(attendanceId)).toBe(false);
    expect(state.auditLogs.at(-1)).toMatchObject({
      eventType: "attendance_deleted",
      entityId: attendanceId,
      metadata: {
        deletedAttendanceSnapshot: {
          id: attendanceId,
          customerName: "Delete attendance customer",
          totalAmount: 50,
        },
      },
    });
  });

  it("rejects owner attendance deletion after work-day closing", async () => {
    const now = Date.now();
    seedClosedWorkDaySettlement({
      id: "closing-delete-locked",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-05",
      closedAt: now,
      closedByUserId: "owner-1",
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeSummaries: [],
      summary: {
        totalEntries: 1,
        subtotalAmount: 50,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 50,
        totalOwnerCommission: 0,
        totalEmployeeEarning: 50,
      },
      createdAt: now,
      updatedAt: now,
    });

    const response = await withRequestDefaults(
      request(app)
        .delete("/api/v1/stores/branch-1/attendances/attendance-1")
        .set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(409);
    expect(response.body.type).toBe("/stores/attendances/work-day-already-closed");
    expect(state.attendances.has("attendance-1")).toBe(true);
  });

  it("rejects employee-created future attendance", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const createResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", staffAuth)
        .send({
          date: "2099-06-21T09:00:00.000Z",
          endDate: "2099-06-21T10:00:00.000Z",
          customerName: "Employee deletes own",
          employeeUserId: "staff-1",
          services: [
            {
              id: "employee-delete-own-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(createResponse.status).toBe(403);
    expect(createResponse.body.type).toBe(
      "/stores/attendances/employee-future-booking-forbidden",
    );
  });

  it("lets the creator and main assignee delete completed attendance before day close", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    // Chấm công staff-1 tạo, nhưng đã "closed" trên một ngày CHƯA chốt sổ (không seed closing).
    const seedAttendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set("attendance-employee-closed", {
      ...seedAttendance,
      id: "attendance-employee-closed",
      workDate: "2099-06-22",
      storeWorkDateKey: "branch-1__2099-06-22",
      createdBy: "staff-1",
      status: "closed",
    });

    const deleteResponse = await withRequestDefaults(
      request(app)
        .delete("/api/v1/stores/branch-1/attendances/attendance-employee-closed")
        .set("Authorization", staffAuth),
    );

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.deleted).toBe(true);
    expect(state.attendances.has("attendance-employee-closed")).toBe(false);
  });

  it("does not let an employee delete an attendance they created when they are not main", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const seedAttendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set("attendance-creator-assistant", {
      ...seedAttendance,
      id: "attendance-creator-assistant",
      workDate: "2026-07-27",
      storeWorkDateKey: "branch-1__2026-07-27",
      createdBy: "staff-1",
      createdByType: "employee",
      createdByUserId: "staff-1",
      createdByRole: "employee",
      employeeUserId: "staff-lead-1",
      mainAssigneeUserId: "staff-lead-1",
      assistantAssigneeUserId: "staff-1",
      source: "walk_in",
    });

    const deleteResponse = await withRequestDefaults(
      request(app)
        .delete("/api/v1/stores/branch-1/attendances/attendance-creator-assistant")
        .set("Authorization", staffAuth),
    );

    expect(deleteResponse.status).toBe(403);
    expect(deleteResponse.body.type).toBe("/stores/attendances/forbidden-attendance");
    expect(state.attendances.has("attendance-creator-assistant")).toBe(true);
  });

  it("recalculates an existing settlement when owner backfills its work date", async () => {
    const now = Date.now();
    const seedAttendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set("attendance-1", {
      ...seedAttendance,
      status: "closed",
      closedAt: now,
      closedBy: "staff-lead-1",
    });
    seedClosedWorkDaySettlement({
      id: "closing-owner-backfill",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-05",
      closedAt: now,
      closedByUserId: "owner-1",
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeSummaries: [],
      summary: {
        totalEntries: 1,
        subtotalAmount: 50,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 50,
        totalOwnerCommission: 0,
        totalEmployeeEarning: 50,
      },
      createdAt: now,
      updatedAt: now,
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances/backfill")
        .set("Authorization", ownerSessionHeader())
        .send({
          date: "2026-05-05T11:00:00.000Z",
          endDate: "2026-05-05T12:00:00.000Z",
          customerName: "Closed day backfill customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "closed-day-backfill-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(response.status).toBe(201);
    expect(response.body.meta).toMatchObject({
      createMode: "owner_backfill_closed",
      recalculatedSettlementDates: ["2026-05-05"],
    });
    expect(response.body.item).toMatchObject({ status: "closed" });
    expect(state.workDaySettlements.get("branch-1__2026-05-05")).toMatchObject({
      workDate: "2026-05-05",
      status: "closed",
      revision: 2,
      closing: {
        discountAllocationMethod: "revenue_share",
      },
    });
  });

  it("normal create endpoint rejects a closed day and points to backfill", async () => {
    const now = Date.now();
    seedClosedWorkDaySettlement({
      id: "closing-normal-vs-backfill",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-05",
      closedAt: now,
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
      createdAt: now,
      updatedAt: now,
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerSessionHeader())
        .send({
          date: "2026-05-05T11:00:00.000Z",
          endDate: "2026-05-05T12:00:00.000Z",
          customerName: "Wrong endpoint for closed day",
          employeeUserId: "staff-1",
          services: [
            {
              id: "normal-on-closed-day-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(response.status).toBe(409);
    expect(response.body.type).toBe("/stores/attendances/work-day-already-closed");
  });

  it("backfill endpoint rejects an open day and points to normal create", async () => {
    // Ngày chưa chốt sổ (không seed closing) → backfill từ chối.
    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances/backfill")
        .set("Authorization", ownerSessionHeader())
        .send({
          date: "2099-09-09T11:00:00.000Z",
          endDate: "2099-09-09T12:00:00.000Z",
          customerName: "Backfill on open day",
          employeeUserId: "staff-1",
          services: [
            {
              id: "backfill-on-open-day-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(response.status).toBe(409);
    expect(response.body.type).toBe("/stores/attendances/work-day-not-closed");
  });

  it("backfill endpoint forbids employees", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances/backfill")
        .set("Authorization", staffAuth)
        .send({
          date: "2099-09-09T11:00:00.000Z",
          endDate: "2099-09-09T12:00:00.000Z",
          customerName: "Employee backfill attempt",
          employeeUserId: "staff-1",
          services: [
            {
              id: "employee-backfill-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(response.status).toBe(403);
    expect(response.body.type).toBe("/stores/attendances/forbidden-attendance");
  });

  it("lets owner directly edit closed attendance and recalculates its settlement", async () => {
    const now = Date.now();
    const seedAttendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set("attendance-1", {
      ...seedAttendance,
      status: "closed",
      closedAt: now,
      closedBy: "staff-lead-1",
    });
    seedClosedWorkDaySettlement({
      id: "closing-owner-direct-edit",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-05",
      closedAt: now,
      closedByUserId: "owner-1",
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeSummaries: [],
      summary: {
        totalEntries: 1,
        subtotalAmount: 50,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 50,
        totalOwnerCommission: 0,
        totalEmployeeEarning: 50,
      },
      createdAt: now,
      updatedAt: now,
    });

    const response = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/attendances/attendance-1")
        .set("Authorization", ownerSessionHeader())
        .send({
          date: "2026-05-05T09:00:00",
          endDate: "2026-05-05T10:00:00",
          storeId: "branch-1",
          customerName: "Edited closed customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "service-1",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              category: "nail",
              price: 60,
              duration: 60,
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(response.status).toBe(200);
    expect(response.body.item).toMatchObject({
      id: "attendance-1",
      status: "closed",
      customerName: "Edited closed customer",
      subtotalAmount: 60,
      totalAmount: 60,
    });
    expect(response.body.meta).toMatchObject({
      status: "closed",
      recalculatedSettlementDates: ["2026-05-05"],
    });
    expect(state.workDaySettlements.get("branch-1__2026-05-05")).toMatchObject({
      workDate: "2026-05-05",
      status: "closed",
      revision: 2,
      preview: {
        totalRevenue: 60,
      },
    });
  });

  it("lets owner edit attendance on a closed work day even when the attendance is still open", async () => {
    const now = Date.now();
    const seedAttendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set("attendance-1", {
      ...seedAttendance,
      status: "open",
    });
    seedClosedWorkDaySettlement({
      id: "closing-owner-direct-edit-open-attendance",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-05",
      closedAt: now,
      closedByUserId: "owner-1",
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeSummaries: [],
      summary: {
        totalEntries: 1,
        subtotalAmount: 50,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 50,
        totalOwnerCommission: 0,
        totalEmployeeEarning: 50,
      },
      createdAt: now,
      updatedAt: now,
    });

    const response = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/attendances/attendance-1")
        .set("Authorization", ownerSessionHeader())
        .send({
          date: "2026-05-05T09:00:00",
          endDate: "2026-05-05T10:00:00",
          storeId: "branch-1",
          customerName: "Edited legacy closed-day customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "service-1",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              category: "nail",
              price: 60,
              duration: 60,
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(response.status).toBe(200);
    expect(response.body.item).toMatchObject({
      id: "attendance-1",
      status: "open",
      customerName: "Edited legacy closed-day customer",
      subtotalAmount: 60,
      totalAmount: 60,
    });
    expect(response.body.meta).toMatchObject({
      status: "open",
      recalculatedSettlementDates: ["2026-05-05"],
    });
    expect(state.workDaySettlements.get("branch-1__2026-05-05")).toMatchObject({
      workDate: "2026-05-05",
      status: "closed",
      revision: 2,
      preview: {
        totalRevenue: 60,
      },
    });
  });

  it("rejects closed-day backfill when existing attendances are still open", async () => {
    const now = Date.now();
    const initialAttendanceCount = state.attendances.size;
    seedClosedWorkDaySettlement({
      id: "closing-invalid-owner-backfill",
      ownerId: "shop-1",
      storeId: "branch-1",
      workDate: "2026-05-05",
      closedAt: now,
      closedByUserId: "owner-1",
      ownerDiscountCoverageRate: 50,
      discountAllocationMethod: "revenue_share",
      employeeSummaries: [],
      summary: {
        totalEntries: 1,
        subtotalAmount: 50,
        totalDiscountAmount: 0,
        totalEmployeeDiscountAmount: 0,
        totalOwnerDiscountAmount: 0,
        totalNetAmount: 50,
        totalOwnerCommission: 0,
        totalEmployeeEarning: 50,
      },
      createdAt: now,
      updatedAt: now,
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances/backfill")
        .set("Authorization", ownerSessionHeader())
        .send({
          date: "2026-05-05T11:00:00.000Z",
          endDate: "2026-05-05T12:00:00.000Z",
          customerName: "Invalid backfill customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "invalid-backfill-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );

    expect(response.status).toBe(409);
    expect(state.attendances.size).toBe(initialAttendanceCount);
  });
  // Chấm công chưa gán thợ chỉ CHỦ/quản lý mới tạo được — thợ tạo thì bắt buộc phải có phần mình
  // (xem test "rejects an employee creating an attendance that belongs to nobody").
  it("rejects manual attendance creation without a worker", async () => {
    const initialAttendanceCount = state.attendances.size;
    const createAttendanceResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerSessionHeader())
        .send({
          date: "2026-05-07T09:00:00.000Z",
          endDate: "2026-05-07T10:00:00.000Z",
          customerName: "Unassigned Customer",
          services: [
            {
              id: "frontend-service-unassigned",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              category: "nail",
              price: "50",
              duration: "60",
              employees: [],
            },
          ],
        }),
    );

    expect(createAttendanceResponse.status).toBe(409);
    expect(createAttendanceResponse.body.type).toBe(
      "/stores/attendances/booking-confirmation-incomplete",
    );
    expect(state.attendances.size).toBe(initialAttendanceCount);
  });

  it("auto-assigns an any-staff public booking and confirms it", async () => {
    const unrestrictedEmployee = state.users.get("staff-1");
    if (!unrestrictedEmployee) throw new Error("staff-1 fixture missing");
    state.users.set("staff-1", { ...unrestrictedEmployee, serviceIds: [] });

    const createPublicBookingResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/public/stores/branch-1/bookings")
        .send({
          storeId: "branch-1",
          customerName: "Public Booking Customer",
          customerPhone: "+49123456789",
          appointmentDate: "2026-05-08",
          startTime: "09:00",
          endTime: "10:00",
          staffSelectionType: "any",
          services: [
            {
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              category: "nail",
              durationMinutes: 60,
              price: 50,
            },
          ],
        }),
    );

    expect(
      createPublicBookingResponse.status,
      JSON.stringify(createPublicBookingResponse.body),
    ).toBe(201);
    const createdAttendance = getAttendanceOrThrow(
      getCreatedAttendanceId(createPublicBookingResponse.body)!,
    );
    expect(createdAttendance.employeeUserId).toBe("staff-1");
    expect(createdAttendance.assignees).toHaveLength(1);
    expect(createdAttendance.bookingStatus).toBe("confirmed");
    expect(createdAttendance).toMatchObject({
      source: "online_booking",
      createdByType: "customer",
      createdByRole: "customer",
      updatedByRole: "customer",
    });
    expect(createdAttendance.customerId).toBeDefined();
    expect(createdAttendance.createdByUserId).toBe(createdAttendance.customerId);
    expect(createdAttendance.updatedByUserId).toBe(createdAttendance.customerId);
  });

  it("returns the persisted worker type in the public staff catalog", async () => {
    const employee = state.users.get("staff-1");
    if (!employee) throw new Error("staff-1 fixture missing");
    state.users.set("staff-1", { ...employee, workerType: "assistant" });

    const response = await withRequestDefaults(
      request(app).get("/api/v1/public/stores/branch-1/staff"),
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toContainEqual(
      expect.objectContaining({ uid: "staff-1", workerType: "assistant" }),
    );
  });

  it("enforces the V1 public-booking staff and request rules", async () => {
    const mainService = state.services.get("service-1");
    const assistant = state.users.get("staff-1");
    const mainWorker = state.users.get("staff-lead-1");
    if (!mainService || !assistant || !mainWorker) {
      throw new Error("public booking fixtures missing");
    }

    state.users.set("staff-1", {
      ...assistant,
      workerType: "assistant",
      serviceIds: [],
    });
    state.users.set("staff-lead-1", {
      ...mainWorker,
      workerType: "main",
      serviceIds: [],
    });
    state.services.set("pedicure-service", {
      ...mainService,
      id: "pedicure-service",
      name: "Basic Pedicure",
      category: "pedicure",
      durationMin: 45,
      durationMax: 45,
    });
    state.services.set("manicure-service", {
      ...mainService,
      id: "manicure-service",
      name: "Basic Manicure",
      category: "manicure",
      durationMin: 60,
      durationMax: 60,
    });
    state.services.set("removal-addon", {
      ...mainService,
      id: "removal-addon",
      name: "Ablösung",
      category: "other",
      bookingKind: "add_on",
      durationMin: 15,
      durationMax: 15,
    });

    const createBooking = (overrides: Record<string, unknown> = {}) =>
      withRequestDefaults(
        request(app)
          .post("/api/v1/public/stores/branch-1/bookings")
          .send({
            storeId: "branch-1",
            customerName: "V1 Rules Customer",
            customerPhone: "+49123456770",
            appointmentDate: "2026-05-12",
            startTime: "09:00",
            endTime: "10:00",
            staffSelectionType: "any",
            services: [
              {
                sourceServiceId: "manicure-service",
                name: "Classic Manicure",
                category: "manicure",
                durationMinutes: 60,
                price: 50,
              },
            ],
            ...overrides,
          }),
      );

    const manicureBooking = await createBooking();
    expect(manicureBooking.status, JSON.stringify(manicureBooking.body)).toBe(201);
    expect(
      getAttendanceOrThrow(getCreatedAttendanceId(manicureBooking.body)!).mainAssigneeUserId,
    ).toBe("staff-1");

    const mainBooking = await createBooking({
      startTime: "10:00",
      endTime: "11:00",
      services: [
        {
          sourceServiceId: "service-1",
          name: "Nail Art",
          category: "nail",
          durationMinutes: 60,
          price: 50,
        },
      ],
    });
    expect(mainBooking.status, JSON.stringify(mainBooking.body)).toBe(201);
    expect(
      getAttendanceOrThrow(getCreatedAttendanceId(mainBooking.body)!).mainAssigneeUserId,
    ).toBe("staff-lead-1");

    const footBooking = await createBooking({
      startTime: "11:00",
      endTime: "11:45",
      services: [
        {
          sourceServiceId: "pedicure-service",
          name: "Basic Pedicure",
          category: "pedicure",
          durationMinutes: 45,
          price: 40,
        },
      ],
    });
    expect(footBooking.status, JSON.stringify(footBooking.body)).toBe(201);
    expect(
      getAttendanceOrThrow(getCreatedAttendanceId(footBooking.body)!).mainAssigneeUserId,
    ).toBe("staff-1");

    state.users.set("staff-1", {
      ...state.users.get("staff-1")!,
      serviceIds: ["manicure-service", "pedicure-service"],
    });

    const invalidSpecificAssistant = await createBooking({
      startTime: "12:00",
      endTime: "13:00",
      staffSelectionType: "specific",
      services: [
        {
          sourceServiceId: "service-1",
          name: "Classic Manicure",
          category: "nail",
          durationMinutes: 60,
          price: 50,
          employeeUserId: "staff-1",
        },
      ],
    });
    expect(invalidSpecificAssistant.status).toBe(400);
    expect(invalidSpecificAssistant.body.type).toBe("/public/stores/invalid-employee");

    const invalidSpecificRequest = await createBooking({
      bookingMode: "request",
      startTime: "13:00",
      endTime: "14:00",
      staffSelectionType: "specific",
      services: [
        {
          sourceServiceId: "service-1",
          name: "Classic Manicure",
          category: "nail",
          durationMinutes: 60,
          price: 50,
          employeeUserId: "staff-lead-1",
        },
      ],
    });
    expect(invalidSpecificRequest.status).toBe(400);
    expect(invalidSpecificRequest.body.type).toBe(
      "/public/stores/specific-staff-request-not-allowed",
    );

    const firstRequest = await createBooking({
      bookingMode: "request",
      startTime: "14:00",
      endTime: "15:00",
      services: [{
        sourceServiceId: "service-1",
        name: "Nail Art",
        category: "nail",
        durationMinutes: 60,
        price: 50,
      }],
    });
    const secondRequest = await createBooking({
      bookingMode: "request",
      customerPhone: "+49123456771",
      startTime: "14:00",
      endTime: "15:00",
      services: [{
        sourceServiceId: "service-1",
        name: "Nail Art",
        category: "nail",
        durationMinutes: 60,
        price: 50,
      }],
    });
    const overLimitRequest = await createBooking({
      bookingMode: "request",
      customerPhone: "+49123456772",
      startTime: "14:00",
      endTime: "15:00",
      services: [{
        sourceServiceId: "service-1",
        name: "Nail Art",
        category: "nail",
        durationMinutes: 60,
        price: 50,
      }],
    });

    expect(firstRequest.status, JSON.stringify(firstRequest.body)).toBe(201);
    expect(secondRequest.status, JSON.stringify(secondRequest.body)).toBe(201);
    expect(overLimitRequest.status).toBe(409);
    expect(overLimitRequest.body.type).toBe("/public/stores/request-limit-reached");

    const bookingWithAddon = await createBooking({
      customerPhone: "+49123456773",
      startTime: "15:00",
      endTime: "16:00",
      services: [{
        sourceServiceId: "service-1",
        name: "Nail Art",
        category: "nail",
        durationMinutes: 60,
        price: 50,
      }],
      addOns: [{ sourceServiceId: "removal-addon", name: "Ablösung", price: 50 }],
    });
    expect(bookingWithAddon.status, JSON.stringify(bookingWithAddon.body)).toBe(201);
    const addonAttendance = getAttendanceOrThrow(getCreatedAttendanceId(bookingWithAddon.body)!);
    expect(addonAttendance).toMatchObject({ startTime: 900, endTime: 960 });
    expect(addonAttendance.services).toHaveLength(1);
    expect(state.bookings.get(`branch-1__${bookingWithAddon.body.meta.bookingId}`)?.["addOns"]).toEqual([
      expect.objectContaining({ sourceServiceId: "removal-addon", name: "Ablösung", price: 50 }),
    ]);
    const calendar = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances/calendar")
        .query({ view: "day", fromWorkDate: "2026-05-12", toWorkDate: "2026-05-12" })
        .set("Authorization", ownerSessionHeader()),
    );
    expect(calendar.status, JSON.stringify(calendar.body)).toBe(200);
    expect(calendar.body.items).toContainEqual(expect.objectContaining({
      id: addonAttendance.id,
      addOns: [expect.objectContaining({ name: "Ablösung", sourceServiceId: "removal-addon" })],
    }));
  });

  it("lets an owner assign an overlapping Request and synchronizes the booking status", async () => {
    const bookingPayload = (customerName: string, bookingMode: "instant" | "request") => ({
      storeId: "branch-1",
      customerName,
      customerPhone: `+49123${customerName.length}6789`,
      appointmentDate: "2026-05-13",
      startTime: "09:00",
      endTime: "10:00",
      staffSelectionType: "any",
      bookingMode,
      services: [{
        sourceServiceId: "service-1",
        name: "Classic Manicure",
        category: "nail",
        durationMinutes: 60,
        price: 50,
      }],
    });

    const firstConfirmed = await withRequestDefaults(
      request(app)
        .post("/api/v1/public/stores/branch-1/bookings")
        .send(bookingPayload("First confirmed", "instant")),
    );
    const secondConfirmed = await withRequestDefaults(
      request(app)
        .post("/api/v1/public/stores/branch-1/bookings")
        .send(bookingPayload("Second confirmed", "instant")),
    );
    expect(firstConfirmed.status).toBe(201);
    expect(secondConfirmed.status).toBe(201);

    const pendingRequest = await withRequestDefaults(
      request(app)
        .post("/api/v1/public/stores/branch-1/bookings")
        .send(bookingPayload("Pending request", "request")),
    );
    expect(pendingRequest.status, JSON.stringify(pendingRequest.body)).toBe(201);
    const pendingAttendanceId = getCreatedAttendanceId(pendingRequest.body)!;
    expect(getAttendanceOrThrow(pendingAttendanceId).bookingStatus).toBe("requested");

    const reassignment = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/attendances/${pendingAttendanceId}/reassign`)
        .set("Authorization", ownerSessionHeader())
        .send({ employeeUserId: "staff-1" }),
    );

    expect(reassignment.status, JSON.stringify(reassignment.body)).toBe(200);
    expect(getAttendanceOrThrow(pendingAttendanceId)).toMatchObject({
      mainAssigneeUserId: "staff-1",
      bookingStatus: "confirmed",
    });
    expect(state.bookings.get(`branch-1__${pendingRequest.body.meta.bookingId}`)?.["bookingStatus"]).toBe(
      "confirmed",
    );
  });

  it("lists only active stores in the public booking directory", async () => {
    state.stores.set("disabled-branch", {
      id: "disabled-branch",
      ownerId: "shop-1",
      name: "Hidden Salon",
      status: "disabled",
    });

    const response = await withRequestDefaults(
      request(app).get("/api/v1/public/stores?limit=1&q=district"),
    );

    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ total: 2 });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      id: "branch-1",
      bookingSlug: "branch-1",
      name: "District 1",
    });
    expect(response.body.meta.nextCursor).toBe("branch-1");
    expect(response.body.items).not.toContainEqual(
      expect.objectContaining({ id: "disabled-branch" }),
    );
  });

  it("splits a public booking across main employees while sharing one booking id", async () => {
    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/public/stores/branch-1/bookings")
        .send({
          storeId: "branch-1",
          customerName: "Split Public Booking Customer",
          customerPhone: "+49123456780",
          appointmentDate: "2026-05-10",
          startTime: "09:00",
          endTime: "10:00",
          staffSelectionType: "specific",
          services: [
            {
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              category: "nail",
              durationMinutes: 30,
              price: 50,
              employeeUserId: "staff-1",
            },
            {
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              category: "nail",
              durationMinutes: 30,
              price: 50,
              employeeUserId: "staff-lead-1",
            },
          ],
        }),
    );

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.meta.bookingId).toBeDefined();
    expect(response.body.items).toHaveLength(2);
    const bookingAttendances = Array.from(state.attendances.values()).filter(
      (attendance) => attendance.bookingId === response.body.meta.bookingId,
    );
    expect(bookingAttendances).toHaveLength(2);
    expect(new Set(bookingAttendances.map((attendance) => attendance.mainAssigneeUserId))).toEqual(
      new Set(["staff-1", "staff-lead-1"]),
    );
  });

  it("keeps per-service any-staff assignment authoritative in a mixed booking", async () => {
    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/public/stores/branch-1/bookings")
        .send({
          storeId: "branch-1",
          customerName: "Mixed Staff Selection Customer",
          customerPhone: "+49123456781",
          appointmentDate: "2026-05-11",
          startTime: "09:00",
          endTime: "11:00",
          staffSelectionType: "specific",
          services: [
            {
              sourceServiceId: "service-1",
              staffSelectionType: "specific",
              name: "Classic Manicure",
              category: "nail",
              durationMinutes: 60,
              price: 50,
              employeeUserId: "staff-1",
            },
            {
              sourceServiceId: "service-1",
              staffSelectionType: "any",
              name: "Classic Manicure",
              category: "nail",
              durationMinutes: 60,
              price: 50,
              // Any-staff segments must ignore a stale or manipulated client hint.
              employeeUserId: "not-a-real-employee",
            },
          ],
        }),
    );

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const bookingAttendances = Array.from(state.attendances.values()).filter(
      (attendance) => attendance.bookingId === response.body.meta.bookingId,
    );
    expect(bookingAttendances.length).toBeGreaterThan(0);
    expect(
      bookingAttendances.every(
        (attendance) => attendance.mainAssigneeUserId !== "not-a-real-employee",
      ),
    ).toBe(true);
  });

  it("validates amount and percentage attendance discounts on create", async () => {
    const ownerAuth = ownerSessionHeader();
    const basePayload = {
      date: "2026-05-09T09:00:00.000Z",
      endDate: "2026-05-09T10:00:00.000Z",
      customerName: "Discount Customer",
      storeId: "branch-1",
      employeeUserId: "staff-1",
      services: [
        {
          id: "frontend-discount-service",
          sourceServiceId: "service-1",
          name: "Classic Manicure",
          category: "nail",
          price: "80",
          duration: "60",
          employees: [
            {
              employeeId: "staff-1",
              percentage: 100,
            },
          ],
        },
      ],
    };

    const percentageDiscountResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          ...basePayload,
          discount: {
            type: "percentage",
            value: 25,
            splitMode: "all_assignees",
          },
        }),
    );

    expect(percentageDiscountResponse.status).toBe(201);
    expect(percentageDiscountResponse.body.item).toMatchObject({
      subtotalAmount: 80,
      discountAmount: 20,
      totalAmount: 60,
    });

    const invalidPercentageResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          ...basePayload,
          discount: {
            type: "percentage",
            value: 101,
            splitMode: "all_assignees",
          },
        }),
    );

    expect(invalidPercentageResponse.status).toBe(400);

    const invalidAmountResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          ...basePayload,
          discountAmount: 81,
        }),
    );

    expect(invalidAmountResponse.status).toBe(400);
    expect(invalidAmountResponse.body.type).toBe("/stores/attendances/invalid-discount-value");
  });

  it("replays idempotent attendance writes and rejects key/body conflicts", async () => {
    const ownerAuth = ownerSessionHeader();
    const initialAttendanceCount = state.attendances.size;
    const idempotencyKey = "attendance-create-idempotency-test";
    const payload = {
      date: "2026-05-08T09:00:00.000Z",
      endDate: "2026-05-08T10:00:00.000Z",
      customerName: "Idempotent Customer",
      storeId: "branch-1",
      employeeUserId: "staff-1",
      services: [
        {
          id: "frontend-idempotent-service",
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
    };

    const firstResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .set("X-Idempotency-Key", idempotencyKey)
        .send(payload),
    );
    expect(firstResponse.status).toBe(201);

    const replayResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .set("X-Idempotency-Key", idempotencyKey)
        .send(payload),
    );
    expect(replayResponse.status).toBe(201);
    expect(replayResponse.headers["x-idempotency-replayed"]).toBe("true");
    expect(getCreatedAttendanceId(replayResponse.body)).toBe(
      getCreatedAttendanceId(firstResponse.body),
    );
    expect(state.attendances.size).toBe(initialAttendanceCount + 1);

    const conflictResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .set("X-Idempotency-Key", idempotencyKey)
        .send({
          ...payload,
          customerName: "Changed body",
        }),
    );
    expect(conflictResponse.status).toBe(409);
    expect(conflictResponse.body.type).toBe("/request/idempotency-conflict");
  });

  it("leaves service employees empty when the attendance has no assigned staff", async () => {
    const ownerAuth = ownerSessionHeader();
    const legacyAttendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set("attendance-legacy-empty-assignee", {
      ...legacyAttendance,
      id: "attendance-legacy-empty-assignee",
      employeeUserId: "staff-1",
      assignees: [],
      services: legacyAttendance.services.map((service) => ({
        ...service,
        employees: [],
      })),
      createdBy: "staff-1",
      updatedBy: "staff-1",
    });

    const detailResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances/attendance-legacy-empty-assignee")
        .set("Authorization", ownerAuth),
    );

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.item.services[0].employees).toEqual([]);
  });

  it("rejects a service co-worker without a main assignee and enforces max two workers", async () => {
    const ownerAuth = ownerSessionHeader();

    const noMainResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-08-01T09:00:00.000Z",
          endDate: "2099-08-01T10:00:00.000Z",
          customerName: "No main customer",
          services: [
            {
              id: "no-main-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "50",
              duration: "60",
              employees: [{ employeeId: "staff-1", percentage: 100 }],
            },
          ],
        }),
    );
    expect(noMainResponse.status).toBe(400);

    const tooManyResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-08-01T09:00:00.000Z",
          endDate: "2099-08-01T10:00:00.000Z",
          customerName: "Too many customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "too-many-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "60",
              duration: "60",
              employees: [
                { employeeId: "staff-1", percentage: 34 },
                { employeeId: "staff-lead-1", percentage: 33 },
                { employeeId: "staff-2", percentage: 33 },
              ],
            },
          ],
        }),
    );
    expect(tooManyResponse.status).toBe(400);

    const validResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          date: "2099-08-01T09:00:00.000Z",
          endDate: "2099-08-01T10:00:00.000Z",
          customerName: "Valid co-worker customer",
          employeeUserId: "staff-1",
          services: [
            {
              id: "valid-coworker-service",
              sourceServiceId: "service-1",
              name: "Classic Manicure",
              price: "60",
              duration: "60",
              employees: [
                { employeeId: "staff-1", percentage: 60 },
                { employeeId: "staff-lead-1", percentage: 40 },
              ],
            },
          ],
        }),
    );
    expect(validResponse.status).toBe(201);
  });

  it("returns 422 when a stored attendance has a co-worker but no main assignee", async () => {
    const seedAttendance = getAttendanceOrThrow("attendance-1");
    state.attendances.set("attendance-inconsistent-assignee", {
      ...seedAttendance,
      id: "attendance-inconsistent-assignee",
      employeeUserId: "",
      assignees: [],
      services: seedAttendance.services.map((service) => ({
        ...service,
        employees: [
          {
            employeeUserId: "staff-1",
            employeeName: "Staff One",
            percentage: 100,
            shareAmount: 50,
          },
        ],
      })),
    });

    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances/attendance-inconsistent-assignee")
        .set("Authorization", ownerSessionHeader()),
    );
    expect(response.status).toBe(422);
    expect(response.body.type).toBe("/stores/attendances/inconsistent-assignees");
  });

  it("filters the attendance list by bookingStatus and returns bookingStatus counts", async () => {
    const ownerAuth = ownerSessionHeader();
    const seed = getAttendanceOrThrow("attendance-1");
    const workDate = "2026-06-20";
    const storeWorkDateKey = "branch-1__2026-06-20";
    state.attendances.set("att-bs-confirmed", {
      ...seed,
      id: "att-bs-confirmed",
      workDate,
      storeWorkDateKey,
      bookingStatus: "confirmed",
    });
    state.attendances.set("att-bs-cancelled", {
      ...seed,
      id: "att-bs-cancelled",
      workDate,
      storeWorkDateKey,
      bookingStatus: "cancelled",
    });

    const allResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances")
        .query({ workDate })
        .set("Authorization", ownerAuth),
    );
    expect(allResponse.status).toBe(200);
    expect(allResponse.body.meta.totalCount).toBe(2);
    expect(allResponse.body.meta.bookingStatusCounts).toMatchObject({ confirmed: 1, cancelled: 1 });

    const cancelledResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances")
        .query({ workDate, bookingStatus: "cancelled" })
        .set("Authorization", ownerAuth),
    );
    expect(cancelledResponse.status).toBe(200);
    expect(cancelledResponse.body.meta.returnedCount).toBe(1);
    expect(cancelledResponse.body.meta.bookingStatus).toBe("cancelled");
    expect(cancelledResponse.body.items).toHaveLength(1);
    expect(cancelledResponse.body.items[0].id).toBe("att-bs-cancelled");

    const invalidResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances")
        .query({ workDate, bookingStatus: "not-a-status" })
        .set("Authorization", ownerAuth),
    );
    expect(invalidResponse.status).toBe(400);
  });

  it("restricts attendance list filters for employees to date and booking status", async () => {
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const byEmployeeUserId = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances")
        .query({ workDate: "2026-05-05", employeeUserId: "staff-lead-1" })
        .set("Authorization", staffAuth),
    );
    expect(byEmployeeUserId.status).toBe(403);
    expect(byEmployeeUserId.body.type).toBe("/stores/attendances/forbidden-filter");

    const bySettlementStatus = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances")
        .query({ workDate: "2026-05-05", status: "open" })
        .set("Authorization", staffAuth),
    );
    expect(bySettlementStatus.status).toBe(403);

    const byDisallowedBookingStatus = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances")
        .query({ workDate: "2026-05-05", bookingStatus: "requested" })
        .set("Authorization", staffAuth),
    );
    expect(byDisallowedBookingStatus.status).toBe(403);

    const byAllowedBookingStatus = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances")
        .query({ workDate: "2026-05-05", bookingStatus: "cancelled" })
        .set("Authorization", staffAuth),
    );
    expect(byAllowedBookingStatus.status).toBe(200);
  });
});
