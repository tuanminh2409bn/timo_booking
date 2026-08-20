import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, ownerSessionHeader, state, withRequestDefaults } from "./backend-api-fixture.js";
import type { ShopEmployeeLeaveRequestType } from "../../src/repository/firestore/shop/shop.types.js";

const BASE = "/api/v1/stores/branch-1/employees/staff-1/leave-requests";
const ownerAuth = () => ownerSessionHeader();
const staffAuth = () => ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" });

// Seed thẳng vào state với createdAt cố định để test phân trang deterministic (API dùng Date.now()).
const seedLeave = (id: string, createdAt: number) => {
  const leaveRequest: ShopEmployeeLeaveRequestType = {
    id,
    ownerId: "shop-1",
    storeId: "branch-1",
    employeeUserId: "staff-1",
    employeeName: "Staff One",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    allDay: true,
    reason: `reason-${id}`,
    createdByUserId: "owner-1",
    updatedByUserId: "owner-1",
    createdAt,
    updatedAt: createdAt,
  };
  state.leaveRequests.set(id, leaveRequest);
};

// storeId do route cung cấp (mergeUrlPathStoreId) — FE không cần gửi trong body.
const createBody = {
  startDate: "2026-08-01",
  endDate: "2026-08-03",
  allDay: true,
  reason: "Nghỉ phép năm",
};

describe("integration: employee leave-requests", () => {
  beforeEach(() => {
    state.leaveRequests.clear();
  });

  it("owner tạo rồi list được đơn nghỉ", async () => {
    const createRes = await withRequestDefaults(
      request(app).post(BASE).set("Authorization", ownerAuth()).send(createBody),
    );
    expect(createRes.status).toBe(201);
    expect(createRes.body.item).toMatchObject({
      employeeUserId: "staff-1",
      storeId: "branch-1",
      startDate: "2026-08-01",
      endDate: "2026-08-03",
      allDay: true,
      reason: "Nghỉ phép năm",
    });
    const id = createRes.body.item.id;

    const listRes = await withRequestDefaults(
      request(app).get(BASE).set("Authorization", ownerAuth()),
    );
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].id).toBe(id);
    expect(listRes.body.meta).toMatchObject({
      storeId: "branch-1",
      employeeId: "staff-1",
      limit: 20,
      hasMore: false,
    });
  });

  it("preview giữ lịch ở thợ cũ, trả mã CC và đánh dấu cần xử lý", async () => {
    const attendance = state.attendances.get("attendance-1");
    expect(attendance).toBeDefined();
    state.attendances.set("attendance-1", {
      ...attendance!,
      attendanceCode: "CC-75",
      staffSelectionType: "any",
    });

    const previewRes = await withRequestDefaults(
      request(app)
        .post(`${BASE}/preview`)
        .set("Authorization", ownerAuth())
        .send({
          startDate: "2026-05-05",
          endDate: "2026-05-05",
          allDay: false,
          startTime: "09:00",
          endTime: "12:00",
          reason: "Nghỉ buổi sáng",
        }),
    );

    expect(previewRes.status).toBe(200);
    expect(previewRes.body).toMatchObject({
      conflictCount: 1,
      automaticCount: 0,
      manualCount: 1,
      conflicts: [{
        attendanceId: "attendance-1",
        attendanceCode: "CC-75",
        resolution: "manual_action",
      }],
    });
  });

  it("tạo nghỉ một phần không tự chuyển lịch sang thợ khác hoặc cột Request", async () => {
    const attendance = state.attendances.get("attendance-1");
    expect(attendance).toBeDefined();
    state.attendances.set("attendance-1", {
      ...attendance!,
      attendanceCode: "CC-76",
      bookingStatus: "confirmed",
      staffSelectionType: "any",
    });

    const createRes = await withRequestDefaults(
      request(app)
        .post(BASE)
        .set("Authorization", ownerAuth())
        .send({
          startDate: "2026-05-05",
          endDate: "2026-05-05",
          allDay: false,
          startTime: "09:00",
          endTime: "12:00",
          reason: "Nghỉ buổi sáng",
        }),
    );

    expect(createRes.status).toBe(201);
    expect(createRes.body.conflictResolution).toEqual({ reassigned: 0, manual: 1 });
    expect(state.attendances.get("attendance-1")).toMatchObject({
      attendanceCode: "CC-76",
      employeeUserId: "staff-1",
      bookingStatus: "processing",
      conflictEmployeeUserId: "staff-1",
      conflictEmployeeName: "Staff One",
    });

    const reassignRes = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/attendances/attendance-1/reassign")
        .set("Authorization", ownerAuth())
        .send({ employeeUserId: "staff-lead-1" }),
    );
    expect(reassignRes.status, JSON.stringify(reassignRes.body)).toBe(200);
    expect(reassignRes.body.pendingConfirmation).toBe(true);
    expect(state.attendances.get("attendance-1")).toMatchObject({
      employeeUserId: "staff-1",
      bookingStatus: "processing",
      proposedAssigneeUserId: "staff-lead-1",
    });

    const approveRes = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/attendances/attendance-1/status")
        .set("Authorization", ownerAuth())
        .send({ status: "confirmed" }),
    );
    expect(approveRes.status, JSON.stringify(approveRes.body)).toBe(200);
    expect(state.attendances.get("attendance-1")).toMatchObject({
      employeeUserId: "staff-lead-1",
      mainAssigneeUserId: "staff-lead-1",
      bookingStatus: "confirmed",
    });
    expect(state.attendances.get("attendance-1")).not.toHaveProperty("proposedAssigneeUserId");
  });

  it("phân trang cursor theo createdAt desc", async () => {
    seedLeave("lv-e", 1000);
    seedLeave("lv-d", 2000);
    seedLeave("lv-c", 3000);
    seedLeave("lv-b", 4000);
    seedLeave("lv-a", 5000);

    const page1 = await withRequestDefaults(
      request(app).get(BASE).query({ limit: 2 }).set("Authorization", ownerAuth()),
    );
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((item: { id: string }) => item.id)).toEqual(["lv-a", "lv-b"]);
    expect(page1.body.meta).toMatchObject({ limit: 2, hasMore: true, nextCursor: 4000 });

    const page2 = await withRequestDefaults(
      request(app)
        .get(BASE)
        .query({ limit: 2, before: page1.body.meta.nextCursor })
        .set("Authorization", ownerAuth()),
    );
    expect(page2.body.items.map((item: { id: string }) => item.id)).toEqual(["lv-c", "lv-d"]);
    expect(page2.body.meta).toMatchObject({ limit: 2, hasMore: true, nextCursor: 2000 });

    const page3 = await withRequestDefaults(
      request(app)
        .get(BASE)
        .query({ limit: 2, before: page2.body.meta.nextCursor })
        .set("Authorization", ownerAuth()),
    );
    expect(page3.body.items.map((item: { id: string }) => item.id)).toEqual(["lv-e"]);
    expect(page3.body.meta).toMatchObject({ limit: 2, hasMore: false });
    expect(page3.body.meta).not.toHaveProperty("nextCursor");
  });

  it("tạo đơn sai (startDate > endDate) → 400", async () => {
    const res = await withRequestDefaults(
      request(app)
        .post(BASE)
        .set("Authorization", ownerAuth())
        .send({ ...createBody, startDate: "2026-08-05", endDate: "2026-08-01" }),
    );
    expect(res.status).toBe(400);
  });

  it("xoá đơn nghỉ, xoá lại → 404", async () => {
    const createRes = await withRequestDefaults(
      request(app).post(BASE).set("Authorization", ownerAuth()).send(createBody),
    );
    const id = createRes.body.item.id;

    const delRes = await withRequestDefaults(
      request(app).delete(`${BASE}/${id}`).set("Authorization", ownerAuth()),
    );
    expect(delRes.status).toBe(200);
    expect(delRes.body).toMatchObject({ id, deleted: true });

    const delAgain = await withRequestDefaults(
      request(app).delete(`${BASE}/${id}`).set("Authorization", ownerAuth()),
    );
    expect(delAgain.status).toBe(404);
  });

  it("employee (không có leave:manage) → 403", async () => {
    const res = await withRequestDefaults(
      request(app).get(BASE).set("Authorization", staffAuth()),
    );
    expect(res.status).toBe(403);
  });

  it("truy cập qua store nhân viên không thuộc → 403", async () => {
    // staff-1 ở branch-1; gọi qua branch-2 → guard chặn store.
    const res = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-2/employees/staff-1/leave-requests")
        .set("Authorization", ownerAuth()),
    );
    expect(res.status).toBe(403);
  });

  it("nhân viên không tồn tại → 404", async () => {
    const res = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/employees/does-not-exist/leave-requests")
        .set("Authorization", ownerAuth()),
    );
    expect(res.status).toBe(404);
  });
});
