import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  app,
  firebaseHeader,
  firebaseSigninBody,
  withRequestDefaults,
  state,
  getUserOrThrow,
} from "./backend-api-fixture.js";

describe.skip("E2E: Owner Onboarding", () => { // PARKED customer-journey
  it("completes full owner onboarding flow from registration to first branch setup", async () => {
    const registrationResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/register-owner").send({
        email: "newowner@example.com",
        name: "New Owner",
        password: "secure123",
      }),
    );
    expect(registrationResponse.status).toBe(201);
    expect(registrationResponse.body.uid).toMatch(/^created-user-/);
    // Canonical model: an owner's ownerId is their own uid.
    expect(registrationResponse.body.ownerId).toBe(registrationResponse.body.uid);

    const ownerUid = registrationResponse.body.uid as string;
    const signinResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/signin")
        .send(firebaseSigninBody(`firebase-${ownerUid}`)),
    );
    expect(signinResponse.status).toBe(201);
    expect(signinResponse.body.user).toMatchObject({
      uid: ownerUid,
      role: "owner",
      ownerId: ownerUid,
    });

    const authHeader = firebaseHeader(`firebase-${ownerUid}`);
    const branchResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores").set("Authorization", authHeader).send({
        name: "Main Branch",
        phone: "0901234567",
        manager: "New Owner",
        address: {
          line1: "123 Main St",
          city: "Ho Chi Minh",
          state: "HCMC",
          zipCode: "700000",
          country: "Vietnam",
        },
        status: "active",
      }),
    );
    expect(branchResponse.status).toBe(201);
    expect(branchResponse.body.store).toMatchObject({
      name: "Main Branch",
    });
    expect(branchResponse.body).not.toHaveProperty("storeId");
    expect(branchResponse.body.store).not.toHaveProperty("code");
    expect(branchResponse.body.store).not.toHaveProperty("storeId");
    expect(branchResponse.body.store).not.toHaveProperty("storeCode");

    const storeId = branchResponse.body.store.id as string;
    const serviceResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/services").set("Authorization", authHeader).send({
        storeId,
        name: "Basic Manicure",
        amount: "$30",
        groupService: "Nail",
        duration: "45 minutes",
      }),
    );
    expect(serviceResponse.status).toBe(201);
    expect(serviceResponse.body.item).toMatchObject({
      name: "Basic Manicure",
    });
    expect(serviceResponse.body.meta.storeId).toBe(storeId);

    const branchListResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores").set("Authorization", authHeader),
    );
    expect(branchListResponse.status).toBe(200);
    expect(branchListResponse.body.stores).toHaveLength(1);
  });

  it("completes admin-initiated owner onboarding with shop setup", async () => {
    const adminSigninResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/admin/signin")
        .set("Authorization", firebaseHeader("firebase-admin")),
    );
    expect(adminSigninResponse.status).toBe(201);
    expect(adminSigninResponse.body.user.role).toBe("admin");

    const adminAuth = firebaseHeader("firebase-admin");
    const createOwnerResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/admin/register-owner").set("Authorization", adminAuth).send({
        email: "admin.created.owner@example.com",
        name: "Admin Created Owner",
        password: "secure456",
      }),
    );
    expect(createOwnerResponse.status).toBe(201);
    expect(createOwnerResponse.body.uid).toMatch(/^created-user-/);
    // Canonical model: an owner's ownerId is their own uid.
    expect(createOwnerResponse.body.ownerId).toBe(createOwnerResponse.body.uid);

    const ownerUid = createOwnerResponse.body.uid as string;
    const ownerId = createOwnerResponse.body.ownerId as string;

    const user = getUserOrThrow(ownerUid);
    expect(user).toMatchObject({
      uid: ownerUid,
      email: "admin.created.owner@example.com",
      role: "owner",
      ownerId,
      active: true,
    });
  });

  it("completes owner onboarding with multiple stores and services", async () => {
    const registrationResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/register-owner").send({
        email: "multibranch@example.com",
        name: "Multi Branch Owner",
        password: "secure789",
      }),
    );
    expect(registrationResponse.status).toBe(201);

    const ownerUid = registrationResponse.body.uid as string;
    state.firebaseTokens.set(`firebase-${ownerUid}`, {
      uid: ownerUid,
      authTime: Math.floor(Date.now() / 1000),
    });

    const signinResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/signin")
        .send(firebaseSigninBody(`firebase-${ownerUid}`)),
    );
    expect(signinResponse.status).toBe(201);

    const authHeader = firebaseHeader(`firebase-${ownerUid}`);
    const branch1Response = await withRequestDefaults(
      request(app).post("/api/v1/stores").set("Authorization", authHeader).send({
        name: "Downtown Branch",
        code: "DT",
        status: "active",
      }),
    );
    expect(branch1Response.status).toBe(201);

    const branch2Response = await withRequestDefaults(
      request(app).post("/api/v1/stores").set("Authorization", authHeader).send({
        name: "Uptown Branch",
        code: "UT",
        status: "active",
      }),
    );
    expect(branch2Response.status).toBe(201);

    const branch1Id = branch1Response.body.store.id as string;
    const service1Response = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/services").set("Authorization", authHeader).send({
        storeId: branch1Id,
        name: "Deluxe Manicure",
        amount: "$50",
        groupService: "Nail",
        duration: "60 minutes",
      }),
    );
    expect(service1Response.status).toBe(201);

    const service2Response = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/services").set("Authorization", authHeader).send({
        storeId: branch1Id,
        name: "Spa Pedicure",
        amount: "$70",
        groupService: "Pedicure",
        duration: "75 minutes",
      }),
    );
    expect(service2Response.status).toBe(201);

    const branchListResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores").set("Authorization", authHeader),
    );
    expect(branchListResponse.status).toBe(200);
    expect(branchListResponse.body.stores).toHaveLength(2);

    const serviceListResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/services")
        .query({ storeId: branch1Id })
        .set("Authorization", authHeader),
    );
    expect(serviceListResponse.status).toBe(200);
    expect(serviceListResponse.body.items).toHaveLength(2);
  });

  it("handles error when registering owner with existing email", async () => {
    const firstRegistrationResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/register-owner").send({
        email: "duplicate@example.com",
        name: "First Owner",
        password: "secure123",
      }),
    );
    expect(firstRegistrationResponse.status).toBe(201);

    const duplicateRegistrationResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/register-owner").send({
        email: "duplicate@example.com",
        name: "Second Owner",
        password: "secure456",
      }),
    );
    expect(duplicateRegistrationResponse.status).toBe(409);
    expect(duplicateRegistrationResponse.body.type).toBe("/auth/register-owner/email-already-in-use");
  });

  it("handles error when admin creates owner with invalid data", async () => {
    const adminSigninResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/admin/signin")
        .set("Authorization", firebaseHeader("firebase-admin")),
    );
    expect(adminSigninResponse.status).toBe(201);

    const adminAuth = firebaseHeader("firebase-admin");
    const invalidEmailResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/admin/register-owner").set("Authorization", adminAuth).send({
        email: "not-an-email",
        name: "Invalid Owner",
        password: "secure123",
      }),
    );
    expect(invalidEmailResponse.status).toBe(400);
    expect(invalidEmailResponse.body.type).toBe("/auth/register-owner/invalid-request");

    const shortPasswordResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/admin/register-owner").set("Authorization", adminAuth).send({
        email: "valid@example.com",
        name: "Valid Owner",
        password: "123",
      }),
    );
    expect(shortPasswordResponse.status).toBe(400);
    expect(shortPasswordResponse.body.type).toBe("/auth/register-owner/invalid-request");
  });
});
