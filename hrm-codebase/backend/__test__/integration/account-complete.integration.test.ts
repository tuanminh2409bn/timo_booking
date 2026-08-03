import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  app,
  getUserOrThrow,
  ownerSessionHeader,
  state,
  withRequestDefaults,
} from "./backend-api-fixture.js";

describe("Account API - Complete Integration Tests", () => {
  describe("data retention plan", () => {
    it("initializes a legacy owner on Standard with a two-month grace period", async () => {
      const beforeRequest = Date.now();
      const response = await withRequestDefaults(
        request(app)
          .get("/api/v1/account/data-retention-plan")
          .set("Authorization", ownerSessionHeader()),
      );
      const afterRequest = Date.now();

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        plan: "standard",
        detailRetentionMonths: 2,
      });
      expect(response.body.planChangedAt).toBeGreaterThanOrEqual(beforeRequest);
      expect(response.body.planChangedAt).toBeLessThanOrEqual(afterRequest);
      expect(response.body.standardRetentionEligibleAt).toBeGreaterThan(
        response.body.planChangedAt,
      );
      expect(getUserOrThrow("owner-1")).toMatchObject({
        dataRetentionPlan: "standard",
        dataRetentionPlanChangedAt: response.body.planChangedAt,
        dataRetentionStandardEligibleAt: response.body.standardRetentionEligibleAt,
      });
    });

    it("requires an approved billing subscription before upgrading to Premium", async () => {
      const response = await withRequestDefaults(
        request(app)
          .patch("/api/v1/account/data-retention-plan")
          .set("Authorization", ownerSessionHeader())
          .send({ plan: "premium" }),
      );

      expect(response.status).toBe(402);
      expect(response.body.type).toBe("/account/data-retention-plan/payment-required");
      expect(getUserOrThrow("owner-1").dataRetentionPlan).not.toBe("premium");
    });

    it("starts a new grace period when downgrading and does not reset it on retry", async () => {
      state.users.set("owner-1", {
        ...getUserOrThrow("owner-1"),
        dataRetentionPlan: "premium",
        dataRetentionPlanChangedAt: Date.parse("2026-01-01T00:00:00.000Z"),
      });
      const authHeader = ownerSessionHeader();
      const downgrade = await withRequestDefaults(
        request(app)
          .patch("/api/v1/account/data-retention-plan")
          .set("Authorization", authHeader)
          .send({ plan: "standard" }),
      );
      const retry = await withRequestDefaults(
        request(app)
          .patch("/api/v1/account/data-retention-plan")
          .set("Authorization", authHeader)
          .send({ plan: "standard" }),
      );

      expect(downgrade.status).toBe(200);
      expect(downgrade.body.plan).toBe("standard");
      expect(downgrade.body.standardRetentionEligibleAt).toBeGreaterThan(
        downgrade.body.planChangedAt,
      );
      expect(retry.status).toBe(200);
      expect(retry.body.planChangedAt).toBe(downgrade.body.planChangedAt);
      expect(retry.body.standardRetentionEligibleAt).toBe(
        downgrade.body.standardRetentionEligibleAt,
      );
    });

    it("forbids employees from managing the storage plan", async () => {
      const employeeAuth = ownerSessionHeader({
        uid: "staff-1",
        role: "employee",
        storeId: "branch-1",
      });
      const response = await withRequestDefaults(
        request(app).get("/api/v1/account/data-retention-plan").set("Authorization", employeeAuth),
      );

      expect(response.status).toBe(403);
      expect(response.body.type).toBe("/account/data-retention-plan/forbidden");
    });
  });

  describe("GET /api/v1/account/profile", () => {
    it("successfully retrieves account profile for owner", async () => {
      const authHeader = ownerSessionHeader();

      const response = await withRequestDefaults(
        request(app).get("/api/v1/account/profile").set("Authorization", authHeader),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        user: {
          uid: "owner-1",
          email: "owner@example.com",
          role: "owner",
          ownerId: "shop-1",
          name: "Owner One",
          displayName: "Owner One",
          active: true,
        },
      });
    });

    it("successfully retrieves account profile for staff", async () => {
      const staffAuth = ownerSessionHeader({
        uid: "staff-1",
        role: "employee",
        storeId: "branch-1",
      });

      const response = await withRequestDefaults(
        request(app).get("/api/v1/account/profile").set("Authorization", staffAuth),
      );

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        uid: "staff-1",
        email: "staff@example.com",
        role: "employee",
        storeId: "branch-1",
      });
    });

    it("successfully retrieves profile with all optional fields", async () => {
      state.users.set("owner-1", {
        ...getUserOrThrow("owner-1"),
        phone: "0909123456",
        gender: "female",
      });

      const ownerAuth = ownerSessionHeader();

      const response = await withRequestDefaults(
        request(app).get("/api/v1/account/profile").set("Authorization", ownerAuth),
      );

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        phone: "0909123456",
        gender: "female",
      });
      expect(response.body.user.address).toBeUndefined();
    });

    it("returns 401 when no auth header provided", async () => {
      const response = await withRequestDefaults(request(app).get("/api/v1/account/profile"));

      expect(response.status).toBe(401);
    });

    it("returns 401 when invalid JWT token provided", async () => {
      const response = await withRequestDefaults(
        request(app).get("/api/v1/account/profile").set("Authorization", "Bearer invalid-token"),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("PATCH /api/v1/account/profile", () => {
    it("successfully updates account profile with all fields", async () => {
      const ownerAuth = ownerSessionHeader();

      const response = await withRequestDefaults(
        request(app).patch("/api/v1/account/profile").set("Authorization", ownerAuth).send({
          displayName: "Updated Owner Name",
          phone: "0909999999",
          gender: "other",
        }),
      );

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        uid: "owner-1",
        displayName: "Updated Owner Name",
        phone: "0909999999",
        gender: "other",
      });
      expect(getUserOrThrow("owner-1")).toMatchObject({
        displayName: "Updated Owner Name",
        phone: "0909999999",
        gender: "other",
      });
      expect(response.body.user.address).toBeUndefined();
      expect(getUserOrThrow("owner-1")).not.toHaveProperty("address");
    });

    it("successfully updates only displayName", async () => {
      const ownerAuth = ownerSessionHeader();

      const response = await withRequestDefaults(
        request(app).patch("/api/v1/account/profile").set("Authorization", ownerAuth).send({
          displayName: "Just Display Name",
        }),
      );

      expect(response.status).toBe(200);
      expect(response.body.user.displayName).toBe("Just Display Name");
    });

    it("successfully updates staff profile", async () => {
      const staffAuth = ownerSessionHeader({
        uid: "staff-1",
        role: "employee",
        storeId: "branch-1",
      });

      const response = await withRequestDefaults(
        request(app).patch("/api/v1/account/profile").set("Authorization", staffAuth).send({
          displayName: "Updated Staff",
          phone: "0908888888",
        }),
      );

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        uid: "staff-1",
        displayName: "Updated Staff",
      });
      // SĐT chỉ owner mới có — staff gửi phone thì bị bỏ qua, không trả về.
      expect(response.body.user).not.toHaveProperty("phone");
    });

    it("returns 400 when no fields provided", async () => {
      const ownerAuth = ownerSessionHeader();

      const response = await withRequestDefaults(
        request(app).patch("/api/v1/account/profile").set("Authorization", ownerAuth).send({}),
      );

      expect(response.status).toBe(400);
      expect(response.body.type).toMatch(/invalid/);
    });

    it("returns 400 when profile name is blank", async () => {
      const ownerAuth = ownerSessionHeader();

      const response = await withRequestDefaults(
        request(app)
          .patch("/api/v1/account/profile")
          .set("Authorization", ownerAuth)
          .send({ name: "   " }),
      );

      expect(response.status).toBe(400);
      expect(response.body.type).toBe("/users/profile/invalid-request");
      expect(getUserOrThrow("owner-1").name).toBe("Owner One");
    });

    it("returns 401 when no auth header provided", async () => {
      const response = await withRequestDefaults(
        request(app).patch("/api/v1/account/profile").send({
          displayName: "Test",
        }),
      );

      expect(response.status).toBe(401);
    });
  });
});
