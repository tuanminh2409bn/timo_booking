import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, ownerSessionHeader, state, withRequestDefaults } from "./backend-api-fixture.js";
import type { ShopAttendanceType } from "../../src/repository/firestore/shop/shop.types.js";

const DAY_MS = 86_400_000;
const todayDay = () => Math.floor(Date.now() / DAY_MS);
// workDate cách "hôm nay" `daysAgo` ngày (UTC) — dựng dữ liệu tương đối để test không phụ thuộc ngày chạy.
const workDateAt = (daysAgo: number) =>
  new Date((todayDay() - daysAgo) * DAY_MS).toISOString().slice(0, 10);

// staff-1 (ownerId shop-1, store branch-1) là assignee với `shareAmount` → doanh thu quy cho họ = shareAmount.
const makeAttendance = (id: string, daysAgo: number, shareAmount: number): ShopAttendanceType => {
  const workDate = workDateAt(daysAgo);
  return {
    id,
    ownerId: "shop-1",
    employeeUserId: "staff-1",
    storeId: "branch-1",
    storeName: "District 1",
    storeWorkDateKey: `branch-1__${workDate}`,
    workDate,
    startTime: 540,
    endTime: 600,
    assignees: [
      { employeeUserId: "staff-1", employeeName: "Staff One", percentage: 100, shareAmount },
    ],
    assigneeUserIds: ["staff-1"],
    services: [],
    subtotalAmount: shareAmount,
    totalAmount: shareAmount,
    status: "closed",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: "staff-1",
    updatedBy: "staff-1",
  };
};

const PATH = "/api/v1/stores/branch-1/employees/staff-1/attendance-days";

describe("integration: employee attendance-days (paginated by 10 days)", () => {
  beforeEach(() => {
    // Fixture beforeEach đã reset+reseed; dọn attendance để chỉ còn dữ liệu của test này.
    state.attendances.clear();
    // Cho staff-1 "vào làm" 15 ngày trước → page 0 còn trang (hasMore), page 1 chạm mốc (hết).
    const staff = state.users.get("staff-1");
    if (staff) {
      staff.createdAt = (todayDay() - 15) * DAY_MS;
    }
  });

  it("page 0: điền đủ 10 ngày (mới→cũ), gộp theo ngày, đánh dấu ngày không đi làm", async () => {
    state.attendances.set("a-2", makeAttendance("a-2", 2, 40));
    state.attendances.set("a-5", makeAttendance("a-5", 5, 12));
    state.attendances.set("a-6a", makeAttendance("a-6a", 6, 12));
    state.attendances.set("a-6b", makeAttendance("a-6b", 6, 8));

    const res = await withRequestDefaults(
      request(app).get(PATH).set("Authorization", ownerSessionHeader()),
    );

    expect(res.status).toBe(200);
    // Không còn bundle employee/store.
    expect(res.body).not.toHaveProperty("employee");
    expect(res.body).not.toHaveProperty("store");

    // 10 ngày, mới nhất trước (index i = offset i ngày trước).
    expect(res.body.items).toHaveLength(10);
    expect(res.body.items[0]).toMatchObject({ workDate: workDateAt(0), worked: false, attendanceCount: 0, totalRevenue: 0 });
    expect(res.body.items[2]).toMatchObject({ workDate: workDateAt(2), worked: true, attendanceCount: 1, totalRevenue: 40 });
    expect(res.body.items[5]).toMatchObject({ workDate: workDateAt(5), worked: true, attendanceCount: 1, totalRevenue: 12 });
    expect(res.body.items[6]).toMatchObject({ workDate: workDateAt(6), worked: true, attendanceCount: 2, totalRevenue: 20 });
    expect(res.body.items[9]).toMatchObject({ workDate: workDateAt(9), worked: false });

    expect(res.body.meta).toMatchObject({
      storeId: "branch-1",
      employeeUserId: "staff-1",
      pageSize: 10,
      fromWorkDate: workDateAt(9),
      toWorkDate: workDateAt(0),
      hasMore: true,
      nextCursor: workDateAt(9),
      totalAttendanceCount: 4,
      workedDayCount: 3,
      totalRevenue: 72,
    });
    // Các field đã bỏ.
    expect(res.body.meta).not.toHaveProperty("totalCount");
    expect(res.body.meta).not.toHaveProperty("latestUpdatedAt");
    expect(res.body.meta).not.toHaveProperty("page");
  });

  it("trang cũ hơn qua cursor `before`, hasMore=false khi chạm ngày vào làm", async () => {
    state.attendances.set("a-12", makeAttendance("a-12", 12, 100));

    // before = nextCursor của trang mới nhất (workDateAt(9)) → lấy 10 ngày ngay trước đó.
    const res = await withRequestDefaults(
      request(app)
        .get(PATH)
        .query({ before: workDateAt(9) })
        .set("Authorization", ownerSessionHeader()),
    );

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({
      fromWorkDate: workDateAt(19),
      toWorkDate: workDateAt(10),
      hasMore: false,
      totalAttendanceCount: 1,
      totalRevenue: 100,
    });
    expect(res.body.meta).not.toHaveProperty("nextCursor");
    // offset 12 nằm ở index (12-10)=2 của cửa sổ này.
    expect(res.body.items[2]).toMatchObject({ workDate: workDateAt(12), worked: true, attendanceCount: 1, totalRevenue: 100 });
  });

  it("cursor `before` sai định dạng → 400", async () => {
    const res = await withRequestDefaults(
      request(app).get(PATH).query({ before: "not-a-date" }).set("Authorization", ownerSessionHeader()),
    );
    expect(res.status).toBe(400);
  });

  it("nhân viên không tồn tại → 404", async () => {
    const res = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/employees/does-not-exist/attendance-days")
        .set("Authorization", ownerSessionHeader()),
    );
    expect(res.status).toBe(404);
  });
});
