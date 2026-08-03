import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  app,
  ownerSessionHeader,
  withRequestDefaults,
  state,
  getAttendanceOrThrow,
  getTestTodayWorkDate,
  getTestCurrentMinutes,
} from "./backend-api-fixture.js";

describe("backend API integration: notifications", () => {
  it("clamps notification limits to the supported boundary", async () => {
    const ownerAuth = ownerSessionHeader();
    const now = Date.now();

    for (let index = 0; index < 100; index += 1) {
      state.auditLogs.push({
        id: `audit-limit-${index}`,
        ownerId: "shop-1",
        eventType: "service_updated",
        entityType: "service",
        entityId: "service-1",
        actorUserId: "owner-1",
        actorRole: "owner",
        createdAt: now - index,
      });
    }

    const oversizedLimitResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/notifications")
        .query({ limit: 9999 })
        .set("Authorization", ownerAuth),
    );

    expect(oversizedLimitResponse.status).toBe(200);
    expect(oversizedLimitResponse.body.meta.limit).toBe(10);
    expect(oversizedLimitResponse.body.notifications.length).toBeLessThanOrEqual(10);

    const zeroLimitResponse = await withRequestDefaults(
      request(app).get("/api/v1/notifications").query({ limit: 0 }).set("Authorization", ownerAuth),
    );

    expect(zeroLimitResponse.status).toBe(200);
    expect(zeroLimitResponse.body.meta.limit).toBe(1);
    expect(zeroLimitResponse.body.notifications.length).toBeLessThanOrEqual(1);
  });

  it("lists backend notification feed from audit logs and attendance reminders", async () => {
    const ownerAuth = ownerSessionHeader();
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const todayWorkDate = getTestTodayWorkDate();
    const currentMinutes = getTestCurrentMinutes();
    const now = Date.now();

    state.auditLogs.push(
      {
        id: "audit-service-updated",
        ownerId: "shop-1",
        eventType: "service_updated",
        entityType: "service",
        entityId: "service-1",
        actorUserId: "owner-1",
        actorRole: "owner",
        metadata: {
          name: "Classic Manicure",
          price: 70,
        },
        createdAt: now - 1000,
      },
      {
        id: "audit-branch-two",
        ownerId: "shop-1",
        eventType: "store_updated",
        entityType: "store",
        entityId: "branch-2",
        storeId: "branch-2",
        actorUserId: "owner-1",
        actorRole: "owner",
        metadata: {
          name: "District 2",
        },
        createdAt: now - 2000,
      },
      {
        id: "audit-staff-created",
        ownerId: "shop-1",
        eventType: "employee_created",
        entityType: "employee",
        entityId: "staff-1",
        storeId: "branch-1",
        actorUserId: "owner-1",
        actorRole: "owner",
        metadata: {
          role: "employee",
        },
        createdAt: now - 1500,
      },
    );
    state.attendances.set("attendance-today", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "attendance-today",
      workDate: todayWorkDate,
      storeWorkDateKey: `branch-1__${todayWorkDate}`,
      startTime: currentMinutes,
      endTime: currentMinutes + 60,
      createdAt: now,
      updatedAt: now,
    });

    const ownerNotificationResponse = await withRequestDefaults(
      request(app).get("/api/v1/notifications").set("Authorization", ownerAuth),
    );

    expect(ownerNotificationResponse.status).toBe(200);
    expect(ownerNotificationResponse.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "attendance-reminder:attendance-today:start",
          type: "attendance_reminder",
          route: "/attendance/attendance-today",
        }),
        expect.objectContaining({
          id: "audit:audit-service-updated",
          type: "service_update",
          route: "/services",
        }),
      ]),
    );

    // Reminder createdAt derive từ lịch hẹn (workDate + startTime − 15') nên phải
    // ổn định giữa các lần gọi — không phải Date.now() của thời điểm fetch.
    const repeatNotificationResponse = await withRequestDefaults(
      request(app).get("/api/v1/notifications").set("Authorization", ownerAuth),
    );
    const getReminderCreatedAt = (response: {
      body: { notifications: Array<{ id: string; createdAt: number }> };
    }) =>
      response.body.notifications.find(
        (notification) => notification.id === "attendance-reminder:attendance-today:start",
      )?.createdAt;

    expect(getReminderCreatedAt(repeatNotificationResponse)).toBe(
      getReminderCreatedAt(ownerNotificationResponse),
    );

    const staffNotificationResponse = await withRequestDefaults(
      request(app).get("/api/v1/notifications").set("Authorization", staffAuth),
    );

    expect(staffNotificationResponse.status).toBe(200);
    expect(staffNotificationResponse.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "attendance-reminder:attendance-today:start",
          type: "attendance_reminder",
          route: "/employee/check-ins/attendance-today",
        }),
        expect.objectContaining({
          id: "audit:audit-staff-created",
          type: "employee_update",
          message: "Hồ sơ nhân viên vừa được cập nhật.",
        }),
      ]),
    );
    expect(
      staffNotificationResponse.body.notifications
        .map((notification: { message: string }) => notification.message)
        .join("\n"),
    ).not.toContain("branch-1");
    expect(staffNotificationResponse.body.notifications).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          id: "audit:audit-branch-two",
        }),
      ]),
    );
  });
});