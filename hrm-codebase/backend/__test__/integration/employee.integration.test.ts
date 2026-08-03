import request from "supertest";
import { describe, expect, it } from "vitest";
import { app, ownerSessionHeader, withRequestDefaults, state } from "./backend-api-fixture.js";

describe("backend API integration: employee management", () => {
  it("manages employees with branch and role scope enforcement", async () => {
    const ownerAuth = ownerSessionHeader();
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });

    const employeeListResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/employees")
        .query({ search: "staff" })
        .set("Authorization", ownerAuth),
    );
    expect(employeeListResponse.status).toBe(200);
    expect(employeeListResponse.body.meta).toMatchObject({
      storeId: "branch-1",
      totalCount: 1,
      activeCount: 1,
      inactiveCount: 0,
    });
    expect(employeeListResponse.body.items[0]).toMatchObject({
      id: "staff-1",
      compensationModel: "commission",
    });
    expect(employeeListResponse.body).not.toHaveProperty("employees");
    expect(employeeListResponse.body.items[0]).not.toHaveProperty("email");
    expect(employeeListResponse.body.items[0]).not.toHaveProperty("storeName");
    expect(employeeListResponse.body.items[0]).not.toHaveProperty("kpi");

    const unknownEmployeeRouteResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/employees/staff/unknown").set("Authorization", ownerAuth),
    );
    expect(unknownEmployeeRouteResponse.status).toBe(404);

    const employeeForbiddenListResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/employees").set("Authorization", staffAuth),
    );
    expect(employeeForbiddenListResponse.status).toBe(403);

    const employeeDetailResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/employees/staff-1").set("Authorization", staffAuth),
    );
    expect(employeeDetailResponse.status).toBe(200);
    expect(employeeDetailResponse.body.employee.uid).toBe("staff-1");

    // Employee codes (NV-x) are no longer accepted as a lookup key — only the uid resolves.
    const employeeCodeDetailResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/employees/NV-2").set("Authorization", ownerAuth),
    );
    expect(employeeCodeDetailResponse.status).toBe(404);

    const forbiddenEmployeeDetailResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/employees/staff-2").set("Authorization", staffAuth),
    );
    expect(forbiddenEmployeeDetailResponse.status).toBe(403);

    const createdEmployeeResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/employees").set("Authorization", ownerAuth).send({
        email: "new.staff@example.com",
        password: "secret123",
        name: "New Staff",
        employeeStatus: "inactive",
        position: "Receptionist",
        compensationModel: "hourly",
        hourlyRate: 20,
        weeklyWorkingHours: {
          monday: { enabled: true, startTime: "09:00", endTime: "17:00" },
        },
      }),
    );
    expect(createdEmployeeResponse.status).toBe(201);
    expect(createdEmployeeResponse.body.item).toMatchObject({
      active: true,
      status: "active",
      compensationModel: "hourly",
      hourlyRate: 20,
      weeklyWorkingHours: {
        monday: { enabled: true, startTime: "09:00", endTime: "17:00" },
      },
    });
    expect(createdEmployeeResponse.body.item).not.toHaveProperty("email");
    expect(createdEmployeeResponse.body.item).not.toHaveProperty("label");
    expect(createdEmployeeResponse.body.item).not.toHaveProperty("value");
    const createdEmployee = state.users.get(createdEmployeeResponse.body.item.id);
    expect(createdEmployee).toMatchObject({ role: "employee", active: true });
    expect(createdEmployee?.position).toBeUndefined();
    expect(createdEmployee?.employeeStatus).toBeUndefined();
    expect(state.stores.get("branch-1")?.employeeCount).toBe(3);
    expect(state.stores.get("branch-1")?.activeEmployeeCount).toBe(3);

    const duplicateEmployeeResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/employees").set("Authorization", ownerAuth).send({
        email: "new.staff@example.com",
        password: "secret123",
        name: "Duplicate Staff",
        role: "employee",
      }),
    );
    expect(duplicateEmployeeResponse.status).toBe(409);

    const ownerCreatesUnsupportedRoleResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/employees").set("Authorization", ownerAuth).send({
        email: "blocked.role@example.com",
        password: "secret123",
        name: "Blocked Role",
        role: "owner",
      }),
    );
    expect(ownerCreatesUnsupportedRoleResponse.status).toBe(400);

    const fixedEmployeeWithWorkingHoursResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/employees").set("Authorization", ownerAuth).send({
        email: "fixed.schedule@example.com",
        password: "secret123",
        name: "Fixed Schedule",
        compensationModel: "fixed",
        fixedSalary: 12_000_000,
        weeklyWorkingHours: {
          monday: { enabled: true, startTime: "09:00", endTime: "17:00" },
        },
      }),
    );
    expect(fixedEmployeeWithWorkingHoursResponse.status).toBe(400);

    const updatedEmployeeResponse = await withRequestDefaults(
      request(app).patch("/api/v1/stores/branch-1/employees/staff-1").set("Authorization", ownerAuth).send({
        name: "Staff Updated",
      }),
    );
    expect(updatedEmployeeResponse.status).toBe(200);
    expect(updatedEmployeeResponse.body.item).toMatchObject({
      name: "Staff Updated",
    });
    expect(updatedEmployeeResponse.body.meta).toMatchObject({
      storeId: "branch-1",
    });

    const updatedPasswordResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/employees/staff-1/password")
        .set("Authorization", ownerAuth)
        .send({ password: "changed123" }),
    );
    expect(updatedPasswordResponse.status).toBe(200);
    expect(state.firebaseUsers.get("staff-1")?.password).toBe("changed123");

    const refreshedStaffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const employeeUpdatesEmployeeResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/employees/staff-1")
        .set("Authorization", refreshedStaffAuth)
        .send({ name: "Blocked Update" }),
    );
    expect(employeeUpdatesEmployeeResponse.status).toBe(403);

    const inactiveEmployeeResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/employees/staff-1/employment-status")
        .set("Authorization", ownerAuth)
        .send({ active: false }),
    );
    expect(inactiveEmployeeResponse.status).toBe(200);
    expect(inactiveEmployeeResponse.body.item).toMatchObject({
      id: "staff-1",
      active: false,
      status: "inactive",
    });
    expect(inactiveEmployeeResponse.body.item).not.toHaveProperty("email");
    expect(state.users.get("staff-1")).toMatchObject({
      active: false,
    });
    expect(state.stores.get("branch-1")?.activeEmployeeCount).toBe(2);
    expect(state.stores.get("branch-1")?.inactiveEmployeeCount).toBe(1);
    expect(state.firebaseUsers.get("staff-1")).toMatchObject({
      disabled: true,
      tokensRevoked: true,
    });
  });

  it("persists employee service assignments against the employee store", async () => {
    const ownerAuth = ownerSessionHeader();

    const createdEmployeeResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/employees")
        .set("Authorization", ownerAuth)
        .send({
          email: "service.staff@example.com",
          password: "secret123",
          name: "Service Staff",
          serviceIds: ["service-1"],
        }),
    );
    expect(createdEmployeeResponse.status).toBe(201);
    expect(createdEmployeeResponse.body.item).toMatchObject({
      name: "Service Staff",
      serviceIds: ["service-1"],
    });
    expect(state.users.get(createdEmployeeResponse.body.item.id)?.serviceIds).toEqual([
      "service-1",
    ]);

    const createdEmployeeDetailResponse = await withRequestDefaults(
      request(app)
        .get(`/api/v1/stores/branch-1/employees/${createdEmployeeResponse.body.item.id}`)
        .set("Authorization", ownerAuth),
    );
    expect(createdEmployeeDetailResponse.status).toBe(200);
    expect(createdEmployeeDetailResponse.body.employee.serviceIds).toEqual(["service-1"]);

    const updatedEmployeeResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/employees/staff-1/services")
        .set("Authorization", ownerAuth)
        .send({ serviceIds: ["service-1"] }),
    );
    expect(updatedEmployeeResponse.status).toBe(200);
    expect(updatedEmployeeResponse.body.item.serviceIds).toEqual(["service-1"]);
    expect(state.users.get("staff-1")?.serviceIds).toEqual(["service-1"]);

    const invalidServiceAssignmentResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/employees/staff-1/services")
        .set("Authorization", ownerAuth)
        .send({ serviceIds: ["service-2"] }),
    );
    expect(invalidServiceAssignmentResponse.status).toBe(400);
  });
});
