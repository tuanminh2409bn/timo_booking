import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  app,
  firebaseHeader,
  firebaseSigninBody,
  ownerSessionHeader,
  state,
  withRequestDefaults,
} from "./backend-api-fixture.js";

describe("backend API integration: auth and account", () => {
  it("signs in, updates account profile, persists avatar, and logs out", async () => {
    const signinResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/signin")
        .send(firebaseSigninBody("firebase-owner")),
    );

    expect(signinResponse.status).toBe(201);
    expect(signinResponse.body.user).toMatchObject({
      uid: "owner-1",
      role: "owner",
      ownerId: "owner-1",
    });
    expect(signinResponse.body.user).not.toHaveProperty("avatarUrl");
    expect(signinResponse.body).toEqual({
      user: expect.objectContaining({
        uid: "owner-1",
        role: "owner",
        ownerId: "owner-1",
      }),
    });

    // Firebase-only: client dùng thẳng Firebase ID token cho request sau (không có JWT app).
    const authHeader = firebaseHeader("firebase-owner");
    const profileResponse = await withRequestDefaults(
      request(app).get("/api/v1/account/profile").set("Authorization", authHeader),
    );
    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body.user.displayName).toBe("Owner One");

    const patchResponse = await withRequestDefaults(
      request(app).patch("/api/v1/account/profile").set("Authorization", authHeader).send({
        displayName: "Updated Owner",
        phone: "0909000000",
      }),
    );
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.user).toMatchObject({
      displayName: "Updated Owner",
      phone: "0909000000",
    });
    expect(patchResponse.body.user).not.toHaveProperty("avatarUrl");

    const invalidPatchResponse = await withRequestDefaults(
      request(app).patch("/api/v1/account/profile").set("Authorization", authHeader).send({}),
    );
    expect(invalidPatchResponse.status).toBe(400);

    const logoutResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/logout").set("Authorization", authHeader),
    );
    expect(logoutResponse.status).toBe(200);

    // Firebase-only: logout không thu hồi phiên server (idToken tự hết hạn ≤1h) → token vẫn dùng được.
    const afterLogoutProfileResponse = await withRequestDefaults(
      request(app).get("/api/v1/account/profile").set("Authorization", authHeader),
    );
    expect(afterLogoutProfileResponse.status).toBe(200);
  });

  it("enforces role, activity, branch, and recent-auth checks for auth routes", async () => {
    const adminAsUserResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/signin")
        .send(firebaseSigninBody("firebase-admin")),
    );
    expect(adminAsUserResponse.status).toBe(403);
    expect(adminAsUserResponse.body.type).toBe("/auth/signin/forbidden-role");

    const disabledSigninResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/signin")
        .send(firebaseSigninBody("firebase-disabled-owner")),
    );
    expect(disabledSigninResponse.status).toBe(403);
    expect(disabledSigninResponse.body.type).toBe("/auth/signin/user-disabled");

    const unscopedEmployeeResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/signin")
        .send(firebaseSigninBody("firebase-unscoped-staff")),
    );
    expect(unscopedEmployeeResponse.status).toBe(409);
    expect(unscopedEmployeeResponse.body.type).toBe("/auth/signin/store-not-configured");

    const adminSigninResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/admin/signin")
        .set("Authorization", firebaseHeader("firebase-admin")),
    );
    expect(adminSigninResponse.status).toBe(201);
    expect(adminSigninResponse.body.user.role).toBe("admin");

    const ownerAdminSigninResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/admin/signin")
        .set("Authorization", firebaseHeader("firebase-owner")),
    );
    expect(ownerAdminSigninResponse.status).toBe(403);
    expect(ownerAdminSigninResponse.body.type).toBe("/auth/admin-signin/forbidden-role");

    const stalePasswordChangeResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/change-password")
        .set("Authorization", firebaseHeader("firebase-owner-stale"))
        .send({ newPassword: "new-password-123" }),
    );
    expect(stalePasswordChangeResponse.status).toBe(401);
    expect(stalePasswordChangeResponse.body.type).toBe("/auth/change-password/recent-signin-required");

    const passwordChangeResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/change-password")
        .set("Authorization", firebaseHeader("firebase-owner"))
        .send({ newPassword: "new-password-123" }),
    );
    expect(passwordChangeResponse.status).toBe(200);
    expect(state.firebaseUsers.get("owner-1")?.password).toBe("new-password-123");
    expect(state.firebaseUsers.get("owner-1")?.tokensRevoked).toBe(true);
    expect(state.users.get("owner-1")?.passwordUpdatedAt).toEqual(expect.any(Number));
  });

  it("reads security state from Firebase and deactivates accounts without deleting retention data", async () => {
    const authHeader = firebaseHeader("firebase-owner");

    const securityResponse = await withRequestDefaults(
      request(app).get("/api/v1/account/security").set("Authorization", authHeader),
    );

    expect(securityResponse.status).toBe(200);
    expect(securityResponse.body).toMatchObject({
      twoFactorEnabled: false,
      deletion: { status: "active" },
      retention: {
        plan: "standard",
        detailRetentionMonths: 2,
      },
    });

    const deletionResponse = await withRequestDefaults(
      request(app).post("/api/v1/account/deletion-request").set("Authorization", authHeader),
    );

    expect(deletionResponse.status).toBe(200);
    expect(deletionResponse.body).toMatchObject({ success: true, status: "requested" });
    expect(state.users.get("owner-1")).toMatchObject({
      active: false,
      accountDeletionRequestedByUserId: "owner-1",
      accountDeletionRequestedByRole: "owner",
    });
    expect(state.firebaseUsers.get("owner-1")).toMatchObject({
      disabled: true,
      tokensRevoked: true,
    });
    expect(state.attendances.has("attendance-1")).toBe(true);

    const duplicateResponse = await withRequestDefaults(
      request(app).post("/api/v1/account/deletion-request").set("Authorization", authHeader),
    );
    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body.type).toBe("/account/security/deletion/already-requested");
  });

  it("registers owner accounts and supports forgot-password OTP reset", async () => {
    const invalidRegistration = await withRequestDefaults(
      request(app).post("/api/v1/auth/register-owner").send({
        email: "not-an-email",
        name: "O",
        password: "123",
      }),
    );
    expect(invalidRegistration.status).toBe(400);
    expect(invalidRegistration.body.type).toBe("/auth/register-owner/invalid-request");

    const registrationResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/register-owner").send({
        email: "new.owner@example.com",
        name: "New Owner",
        password: "secret123",
      }),
    );
    expect(registrationResponse.status).toBe(201);
    expect(registrationResponse.body.uid).toMatch(/^created-user-/);

    const duplicateRegistrationResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/register-owner").send({
        email: "new.owner@example.com",
        name: "New Owner",
        password: "secret123",
      }),
    );
    expect(duplicateRegistrationResponse.status).toBe(409);
    expect(duplicateRegistrationResponse.body.type).toBe("/auth/register-owner/email-already-in-use");

    const adminRegistrationResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/admin/register-owner")
        .set("Authorization", ownerSessionHeader({ uid: "admin-1", role: "admin", ownerId: "" }))
        .send({
          email: "admin.created.owner@example.com",
          name: "Admin Created",
          password: "secret123",
        }),
    );
    expect(adminRegistrationResponse.status).toBe(201);

    const forbiddenAdminRegistrationResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/admin/register-owner")
        .set("Authorization", ownerSessionHeader())
        .send({
          email: "forbidden.owner@example.com",
          name: "Forbidden Owner",
          password: "secret123",
        }),
    );
    expect(forbiddenAdminRegistrationResponse.status).toBe(403);

    const invalidOtpRequest = await withRequestDefaults(
      request(app).post("/api/v1/auth/forgot-password/request-otp").send({ email: "bad" }),
    );
    expect(invalidOtpRequest.status).toBe(400);
    expect(invalidOtpRequest.body.type).toBe("/auth/forgot-password-request-otp/invalid-request");

    const otpRequest = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/request-otp")
        .send({ email: "OWNER@example.com" }),
    );
    expect(otpRequest.status).toBe(200);
    expect(otpRequest.body).toMatchObject({
      success: true,
      email: "owner@example.com",
      delivery: "debug",
    });
    expect(otpRequest.body.debugOtpCode).toEqual(expect.stringMatching(/^\d{6}$/));

    const invalidOtpVerify = await withRequestDefaults(
      request(app).post("/api/v1/auth/forgot-password/verify-otp").send({
        email: "owner@example.com",
        otp: "000000",
      }),
    );
    expect(invalidOtpVerify.status).toBe(400);
    expect(invalidOtpVerify.body.type).toBe("/auth/verify-forgot-password-otp/otp-invalid");

    const expiredOtpVerify = await withRequestDefaults(
      request(app).post("/api/v1/auth/forgot-password/verify-otp").send({
        email: "missing-session@example.com",
        otp: "000000",
      }),
    );
    expect(expiredOtpVerify.status).toBe(410);
    expect(expiredOtpVerify.body.type).toBe("/auth/verify-forgot-password-otp/otp-expired");

    const otpVerify = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/verify-otp")
        .send({
          email: "owner@example.com",
          otp: otpRequest.body.debugOtpCode as string,
        }),
    );
    expect(otpVerify.status).toBe(200);
    expect(otpVerify.body.resetToken).toEqual(expect.any(String));

    const resetResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/reset-password")
        .send({
          resetToken: otpVerify.body.resetToken as string,
          password: "reset-secret",
        }),
    );
    expect(resetResponse.status).toBe(200);
    expect(state.firebaseUsers.get("owner-1")?.password).toBe("reset-secret");

    const unknownEmailOtpRequest = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/request-otp")
        .send({ email: "missing@example.com" }),
    );
    expect(unknownEmailOtpRequest.status).toBe(200);
    expect(unknownEmailOtpRequest.body.debugOtpCode).toBeUndefined();

    const staffOtpRequest = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/request-otp")
        .send({ email: "staff@example.com" }),
    );
    expect(staffOtpRequest.status).toBe(200);

    const resetByOtpResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/reset-password")
        .send({
          email: "staff@example.com",
          otp: staffOtpRequest.body.debugOtpCode as string,
          password: "staff-reset-secret",
        }),
    );
    expect(resetByOtpResponse.status).toBe(200);
    expect(state.firebaseUsers.get("staff-1")?.password).toBe("staff-reset-secret");
  });
});
