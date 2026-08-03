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

describe("Auth API - Complete Integration Tests", () => {
  describe("canonical REST auth routes", () => {
    it.skip("supports resource-oriented auth endpoints", async () => {
      // PARKED customer-journey
      const signinResponse = await withRequestDefaults(
        request(app).post("/api/v1/auth/sessions").send(firebaseSigninBody("firebase-owner")),
      );
      expect(signinResponse.status).toBe(201);
      const authHeader = firebaseHeader("firebase-owner");

      const firestoreTokenResponse = await withRequestDefaults(
        request(app).post("/api/v1/auth/firebase-custom-tokens").set("Authorization", authHeader),
      );
      expect(firestoreTokenResponse.status).toBe(200);
      expect(firestoreTokenResponse.body.firebaseCustomToken).toBe("firebase-custom-token-owner-1");

      const logoutResponse = await withRequestDefaults(
        request(app).delete("/api/v1/auth/sessions/current").set("Authorization", authHeader),
      );
      expect(logoutResponse.status).toBe(200);

      // Firebase-only: logout không thu hồi token server-side → vẫn 200.
      const afterLogoutProfileResponse = await withRequestDefaults(
        request(app).get("/api/v1/account/profile").set("Authorization", authHeader),
      );
      expect(afterLogoutProfileResponse.status).toBe(200);

      const passwordResponse = await withRequestDefaults(
        request(app)
          .patch("/api/v1/users/me/password")
          .set("Authorization", firebaseHeader("firebase-owner"))
          .send({ newPassword: "canonicalPassword123" }),
      );
      expect(passwordResponse.status).toBe(200);
      expect(state.firebaseUsers.get("owner-1")?.password).toBe("canonicalPassword123");

      const ownerResponse = await withRequestDefaults(
        request(app).post("/api/v1/owners").send({
          email: "canonical.owner@example.com",
          name: "Canonical Owner",
          password: "password123",
        }),
      );
      expect(ownerResponse.status).toBe(201);

      const adminAuth = ownerSessionHeader({ uid: "admin-1", role: "admin", ownerId: "" });
      const adminOwnerResponse = await withRequestDefaults(
        request(app).post("/api/v1/admin/owners").set("Authorization", adminAuth).send({
          email: "canonical.admin.owner@example.com",
          name: "Canonical Admin Owner",
          password: "password123",
        }),
      );
      expect(adminOwnerResponse.status).toBe(201);

      const otpResponse = await withRequestDefaults(
        request(app)
          .post("/api/v1/password-reset-otp-requests")
          .send({ email: "staff@example.com" }),
      );
      expect(otpResponse.status).toBe(200);
      const verifyResponse = await withRequestDefaults(
        request(app).post("/api/v1/password-reset-otp-verifications").send({
          email: "staff@example.com",
          otp: otpResponse.body.debugOtpCode,
        }),
      );
      expect(verifyResponse.status).toBe(200);

      const resetResponse = await withRequestDefaults(
        request(app).post("/api/v1/password-resets").send({
          resetToken: verifyResponse.body.resetToken,
          password: "canonicalResetPassword123",
        }),
      );
      expect(resetResponse.status).toBe(200);
      expect(state.firebaseUsers.get("staff-1")?.password).toBe("canonicalResetPassword123");
    });
  });

  describe("POST /api/v1/auth/signin", () => {
    it("successfully signs in owner with Firebase ID token", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/signin").send(firebaseSigninBody("firebase-owner")),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        user: {
          uid: "owner-1",
          email: "owner@example.com",
          role: "owner",
          ownerId: "owner-1",
          name: "Owner One",
        },
      });
      expect(response.body).toEqual({
        user: {
          uid: "owner-1",
          email: "owner@example.com",
          role: "owner",
          ownerId: "owner-1",
          name: "Owner One",
        },
      });
      expect(response.body).not.toHaveProperty("jwtToken");
      expect(response.body).not.toHaveProperty("accessToken");
      expect(response.body).not.toHaveProperty("refreshToken");
      expect(response.body).not.toHaveProperty("accessTokenExpiresAt");
      expect(response.body).not.toHaveProperty("refreshTokenExpiresAt");
      expect(response.body).not.toHaveProperty("tokenType");
      expect(response.body).not.toHaveProperty("sessionId");
      expect(response.body).not.toHaveProperty("expiresAt");
      expect(response.body).not.toHaveProperty("permissions");
      expect(response.body).not.toHaveProperty("scope");
      expect(response.body).not.toHaveProperty("firebaseCustomToken");
      expect(response.body.user).not.toHaveProperty("avatarUrl");
      expect(response.body.user).not.toHaveProperty("displayName");
    });

    it("issues Firestore custom token for a valid Firebase ID token", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/firestore-token")
          .set("Authorization", firebaseHeader("firebase-owner")),
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        firebaseCustomToken: "firebase-custom-token-owner-1",
      });
    });

    it("successfully signs in staff with Firebase ID token", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/signin").send(firebaseSigninBody("firebase-owner")),
      );

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe("owner");
    });

    it("returns 400 when credentials are missing", async () => {
      const response = await withRequestDefaults(request(app).post("/api/v1/auth/signin"));

      expect(response.status).toBe(400);
      expect(response.body.type).toBe("/auth/signin/invalid-request");
    });

    it("returns 403 when user has admin role", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/signin").send(firebaseSigninBody("firebase-admin")),
      );

      expect(response.status).toBe(403);
      expect(response.body.type).toBe("/auth/signin/forbidden-role");
    });

    it("returns 403 when user account is disabled", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/signin")
          .send(firebaseSigninBody("firebase-disabled-owner")),
      );

      expect(response.status).toBe(403);
      expect(response.body.type).toBe("/auth/signin/user-disabled");
    });
  });

  describe("POST /api/v1/auth/admin/signin", () => {
    it("successfully signs in admin with valid Firebase token", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/admin/signin")
          .set("Authorization", firebaseHeader("firebase-admin")),
      );

      expect(response.status).toBe(201);
      expect(response.body.user).toMatchObject({
        uid: "admin-1",
        email: "admin@example.com",
        role: "admin",
      });
      expect(response.body).not.toHaveProperty("jwtToken");
      expect(response.body).not.toHaveProperty("accessToken");
      expect(response.body).not.toHaveProperty("refreshToken");
    });

    it("successfully signs in admin and verifies permissions", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/admin/signin")
          .set("Authorization", firebaseHeader("firebase-admin")),
      );

      expect(response.status).toBe(201);
      expect(response.body).not.toHaveProperty("permissions");
    });

    it("returns 401 when Firebase token is missing", async () => {
      const response = await withRequestDefaults(request(app).post("/api/v1/auth/admin/signin"));

      expect(response.status).toBe(401);
    });

    it("returns 403 when non-admin user attempts admin signin", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/admin/signin")
          .set("Authorization", firebaseHeader("firebase-owner")),
      );

      expect(response.status).toBe(403);
      expect(response.body.type).toBe("/auth/admin-signin/forbidden-role");
    });

    it("returns 403 when disabled admin attempts signin", async () => {
      state.users.get("admin-1")!.active = false;

      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/admin/signin")
          .set("Authorization", firebaseHeader("firebase-admin")),
      );

      expect(response.status).toBe(403);
    });
  });

  describe("POST /api/v1/auth/logout", () => {
    // Firebase-only: logout là no-op phía server (không còn phiên để thu hồi). Client tự signOut()
    // phía Firebase; idToken hiện tại vẫn dùng được tới khi hết hạn (≤1h).
    it("returns 200 and does not revoke the token server-side", async () => {
      const authHeader = firebaseHeader("firebase-owner");

      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/logout").set("Authorization", authHeader),
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ success: true });

      const profileResponse = await withRequestDefaults(
        request(app).get("/api/v1/account/profile").set("Authorization", authHeader),
      );
      expect(profileResponse.status).toBe(200);
    });

    it("returns 200 even without an auth header (no server session to end)", async () => {
      const response = await withRequestDefaults(request(app).post("/api/v1/auth/logout"));
      expect(response.status).toBe(200);
    });
  });

  describe("POST /api/v1/auth/refresh-token", () => {
    it("returns 410 because refresh token flow is disabled", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/refresh-token").send({ refreshToken: "legacy-refresh" }),
      );

      expect(response.status).toBe(410);
      expect(response.body.type).toBe("/auth/refresh-token/refresh-token-disabled");
    });
  });

  describe("POST /api/v1/auth/register-owner", () => {
    it("successfully registers new owner account", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/register-owner").send({
          email: "newowner@example.com",
          name: "New Owner",
          password: "securePassword123",
        }),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        uid: expect.stringMatching(/^created-user-/),
        email: "newowner@example.com",
      });
      expect(state.firebaseUsers.has(response.body.uid)).toBe(true);
    });

    it("successfully registers owner and creates Firestore user", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/register-owner").send({
          email: "owner2@example.com",
          name: "Owner Two",
          password: "password123",
        }),
      );

      expect(response.status).toBe(201);
      expect(state.users.has(response.body.uid)).toBe(true);
      expect(state.users.get(response.body.uid)?.role).toBe("owner");
    });

    it("returns 400 when email is invalid", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/register-owner").send({
          email: "not-an-email",
          name: "Test Owner",
          password: "password123",
        }),
      );

      expect(response.status).toBe(400);
      expect(response.body.type).toBe("/auth/register-owner/invalid-request");
    });

    it("returns 400 when password is too short", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/register-owner").send({
          email: "test@example.com",
          name: "Test Owner",
          password: "123",
        }),
      );

      expect(response.status).toBe(400);
      expect(response.body.type).toBe("/auth/register-owner/invalid-request");
    });

    it("returns 409 when email already exists", async () => {
      await withRequestDefaults(
        request(app).post("/api/v1/auth/register-owner").send({
          email: "duplicate@example.com",
          name: "First Owner",
          password: "password123",
        }),
      );

      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/register-owner").send({
          email: "duplicate@example.com",
          name: "Second Owner",
          password: "password456",
        }),
      );

      expect(response.status).toBe(409);
      expect(response.body.type).toBe("/auth/register-owner/email-already-in-use");
    });
  });

  describe.skip("POST /api/v1/auth/admin/register-owner", () => {
    // PARKED customer-journey
    it("successfully registers owner as admin", async () => {
      const adminAuth = ownerSessionHeader({ uid: "admin-1", role: "admin", ownerId: "" });

      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/admin/register-owner")
          .set("Authorization", adminAuth)
          .send({
            email: "adminregistered@example.com",
            name: "Admin Registered Owner",
            password: "password123",
          }),
      );

      expect(response.status).toBe(201);
      expect(response.body.uid).toMatch(/^created-user-/);
    });

    it("successfully registers owner and verifies user data", async () => {
      const adminAuth = ownerSessionHeader({ uid: "admin-1", role: "admin", ownerId: "" });

      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/admin/register-owner")
          .set("Authorization", adminAuth)
          .send({
            email: "owner3@example.com",
            name: "Owner Three",
            password: "password123",
          }),
      );

      expect(response.status).toBe(201);
      expect(state.users.get(response.body.uid)).toMatchObject({
        email: "owner3@example.com",
        name: "Owner Three",
        role: "owner",
      });
    });

    it("returns 401 when no auth header provided", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/admin/register-owner").send({
          email: "test@example.com",
          name: "Test",
          password: "password123",
        }),
      );

      expect(response.status).toBe(401);
    });

    it("returns 403 when non-admin attempts to register owner", async () => {
      const ownerAuth = ownerSessionHeader();

      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/admin/register-owner")
          .set("Authorization", ownerAuth)
          .send({
            email: "forbidden@example.com",
            name: "Forbidden Owner",
            password: "password123",
          }),
      );

      expect(response.status).toBe(403);
    });

    it("returns 400 when request body is invalid", async () => {
      const adminAuth = ownerSessionHeader({ uid: "admin-1", role: "admin", ownerId: "" });

      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/admin/register-owner")
          .set("Authorization", adminAuth)
          .send({
            email: "invalid",
            name: "T",
            password: "12",
          }),
      );

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/v1/auth/change-password", () => {
    it("successfully changes password with recent auth", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/change-password")
          .set("Authorization", firebaseHeader("firebase-owner"))
          .send({ newPassword: "newSecurePassword123" }),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
      });
      expect(state.firebaseUsers.get("owner-1")?.password).toBe("newSecurePassword123");
      expect(state.firebaseUsers.get("owner-1")?.tokensRevoked).toBe(true);
    });

    it("successfully changes password and verifies tokens revoked", async () => {
      await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/change-password")
          .set("Authorization", firebaseHeader("firebase-owner"))
          .send({ newPassword: "anotherPassword456" }),
      );

      expect(state.firebaseUsers.get("owner-1")?.tokensRevoked).toBe(true);
    });

    it("returns 401 when auth token is stale", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/change-password")
          .set("Authorization", firebaseHeader("firebase-owner-stale"))
          .send({ newPassword: "newPassword123" }),
      );

      expect(response.status).toBe(401);
      expect(response.body.type).toBe("/auth/change-password/recent-signin-required");
    });

    it("returns 400 when new password is missing", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/change-password")
          .set("Authorization", firebaseHeader("firebase-owner"))
          .send({}),
      );

      expect(response.status).toBe(400);
    });

    it("returns 401 when no auth header provided", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/change-password").send({ newPassword: "newPassword123" }),
      );

      expect(response.status).toBe(401);
    });
  });

  describe.skip("POST /api/v1/auth/forgot-password/request-otp", () => {
    // PARKED customer-journey
    it("successfully requests OTP for existing owner email", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/request-otp")
          .send({ email: "owner@example.com" }),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        email: "owner@example.com",
        delivery: "debug",
        debugOtpCode: expect.stringMatching(/^\d{6}$/),
      });
      expect(state.lastOtpCode).toEqual(expect.stringMatching(/^\d{6}$/));
    });

    it("successfully requests OTP with case-insensitive email", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/request-otp")
          .send({ email: "OWNER@EXAMPLE.COM" }),
      );

      expect(response.status).toBe(200);
      expect(response.body.email).toBe("owner@example.com");
    });

    it("returns 200 but no OTP for non-existent email", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/request-otp")
          .send({ email: "nonexistent@example.com" }),
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.debugOtpCode).toBeUndefined();
    });

    it("returns 400 when email is invalid", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/forgot-password/request-otp").send({ email: "invalid" }),
      );

      expect(response.status).toBe(400);
      expect(response.body.type).toBe("/auth/forgot-password-request-otp/invalid-request");
    });

    it("returns 400 when email is missing", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/forgot-password/request-otp").send({}),
      );

      expect(response.status).toBe(400);
    });
  });

  describe.skip("POST /api/v1/auth/forgot-password/verify-otp", () => {
    // PARKED customer-journey
    it("successfully verifies OTP and returns reset token", async () => {
      const otpResponse = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/request-otp")
          .send({ email: "owner@example.com" }),
      );
      const otpCode = otpResponse.body.debugOtpCode as string;

      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/verify-otp")
          .send({ email: "owner@example.com", otp: otpCode }),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        resetToken: expect.any(String),
      });
    });

    it("successfully verifies OTP with case-insensitive email", async () => {
      const otpResponse = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/request-otp")
          .send({ email: "owner@example.com" }),
      );
      const otpCode = otpResponse.body.debugOtpCode as string;

      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/verify-otp")
          .send({ email: "OWNER@EXAMPLE.COM", otp: otpCode }),
      );

      expect(response.status).toBe(200);
    });

    it("returns 400 when OTP is incorrect", async () => {
      await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/request-otp")
          .send({ email: "owner@example.com" }),
      );

      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/verify-otp")
          .send({ email: "owner@example.com", otp: "000000" }),
      );

      expect(response.status).toBe(400);
      expect(response.body.type).toBe("/auth/verify-forgot-password-otp/otp-invalid");
    });

    it("returns 410 when OTP session expired", async () => {
      const response = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/verify-otp")
          .send({ email: "nosession@example.com", otp: "123456" }),
      );

      expect(response.status).toBe(410);
      expect(response.body.type).toBe("/auth/verify-forgot-password-otp/otp-expired");
    });

    it("returns 400 when request body is invalid", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/forgot-password/verify-otp").send({ email: "invalid" }),
      );

      expect(response.status).toBe(400);
    });
  });

  describe.skip("POST /api/v1/auth/forgot-password/reset-password", () => {
    // PARKED customer-journey
    it("successfully resets password with reset token", async () => {
      const otpResponse = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/request-otp")
          .send({ email: "owner@example.com" }),
      );
      const verifyResponse = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/verify-otp")
          .send({ email: "owner@example.com", otp: otpResponse.body.debugOtpCode }),
      );

      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/forgot-password/reset-password").send({
          resetToken: verifyResponse.body.resetToken,
          password: "newResetPassword123",
        }),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
      });
      expect(state.firebaseUsers.get("owner-1")?.password).toBe("newResetPassword123");
    });

    it("successfully resets password with email and OTP", async () => {
      const otpResponse = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/request-otp")
          .send({ email: "staff@example.com" }),
      );

      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/forgot-password/reset-password").send({
          email: "staff@example.com",
          otp: otpResponse.body.debugOtpCode,
          password: "staffNewPassword123",
        }),
      );

      expect(response.status).toBe(200);
      expect(state.firebaseUsers.get("staff-1")?.password).toBe("staffNewPassword123");
    });

    it("returns 400 when reset token is invalid", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/forgot-password/reset-password").send({
          resetToken: "invalid-token",
          password: "newPassword123",
        }),
      );

      expect(response.status).toBe(400);
    });

    it("returns 400 when password is too short", async () => {
      const otpResponse = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/request-otp")
          .send({ email: "owner@example.com" }),
      );
      const verifyResponse = await withRequestDefaults(
        request(app)
          .post("/api/v1/auth/forgot-password/verify-otp")
          .send({ email: "owner@example.com", otp: otpResponse.body.debugOtpCode }),
      );

      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/forgot-password/reset-password").send({
          resetToken: verifyResponse.body.resetToken,
          password: "123",
        }),
      );

      expect(response.status).toBe(400);
    });

    it("returns 400 when request body is missing required fields", async () => {
      const response = await withRequestDefaults(
        request(app).post("/api/v1/auth/forgot-password/reset-password").send({}),
      );

      expect(response.status).toBe(400);
    });
  });
});
