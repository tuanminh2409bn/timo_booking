import request from "supertest";
import { describe, expect, it } from "vitest";
import { app, withRequestDefaults } from "./backend-api-fixture.js";

describe("backend API integration: HTTP guards", () => {
  it("serves health-style root responses and common HTTP guards", async () => {
    const rootResponse = await withRequestDefaults(request(app).get("/"));

    expect(rootResponse.status).toBe(200);
    expect(rootResponse.text).toContain("Nail Salon Management System");
    expect(rootResponse.headers["x-request-id"]).toEqual(expect.any(String));

    const notFoundResponse = await withRequestDefaults(request(app).get("/missing-route"));
    expect(notFoundResponse.status).toBe(404);
    expect(notFoundResponse.body).toEqual({
      type: "/request/not-found",
      message: "Route not found",
    });

    const unsupportedMediaResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/signin").set("Content-Type", "text/plain").send("not-json"),
    );
    expect(unsupportedMediaResponse.status).toBe(415);
    expect(unsupportedMediaResponse.body.type).toBe("/request/unsupported-media-type");

    const tooLargeResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/register-owner")
        .send({
          email: "large@example.com",
          name: "Large Payload",
          password: "secret123",
          padding: "x".repeat(512 * 1024),
        }),
    );
    expect(tooLargeResponse.status).toBe(413);
    expect(tooLargeResponse.body).toEqual({
      type: "/request/payload-too-large",
      message: "Request payload is too large",
    });

    const missingAuthResponse = await withRequestDefaults(
      request(app).get("/api/v1/account/profile"),
    );
    expect(missingAuthResponse.status).toBe(401);
    expect(missingAuthResponse.body).toEqual({
      type: "/auth/header-missing",
      message: "API header error",
    });

    const malformedAuthResponse = await withRequestDefaults(
      request(app).get("/api/v1/account/profile").set("Authorization", "Basic abc"),
    );
    expect(malformedAuthResponse.status).toBe(401);
    expect(malformedAuthResponse.body).toEqual({
      type: "/auth/token-missing",
      message: "Token not found in header",
    });

    const invalidSessionTokenResponse = await withRequestDefaults(
      request(app).get("/api/v1/account/profile").set("Authorization", "Bearer invalid-session"),
    );
    expect(invalidSessionTokenResponse.status).toBe(401);
    expect(invalidSessionTokenResponse.body).toEqual({
      type: "/auth/token-invalid",
      message: "Authorized token is invalid",
    });

    const missingCredentialsResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/signin").set("Authorization", "Bearer"),
    );
    expect(missingCredentialsResponse.status).toBe(400);
    expect(missingCredentialsResponse.body.type).toBe("/auth/signin/invalid-request");

    const invalidCredentialsResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/signin").send({ idToken: "invalid-firebase-token" }),
    );
    expect(invalidCredentialsResponse.status).toBe(401);
    expect(invalidCredentialsResponse.body.type).toBe("/auth/signin/invalid-credentials");
  });

  it("rejects Firebase ID tokens it cannot verify (expired/invalid) with token-invalid", async () => {
    // Firebase-only: verifyIdToken từ chối token hết hạn/sai → gộp về token-invalid (không còn
    // phân biệt token-expired riêng như JWT app cũ).
    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/account/profile")
        .set("Authorization", "Bearer expired-or-invalid-firebase-id-token"),
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      type: "/auth/token-invalid",
      message: "Authorized token is invalid",
    });
  });

  it("supports App Check monitor and required modes", async () => {
    const originalMode = process.env["APP_CHECK_MODE"];
    const originalNodeEnvironment = process.env["NODE_ENV"];

    try {
      process.env["APP_CHECK_MODE"] = "monitor";
      const monitorResponse = await withRequestDefaults(
        request(app).post("/api/v1/auth/signin").send({}),
      );
      expect(monitorResponse.status).toBe(400);
      expect(monitorResponse.body.type).toBe("/auth/signin/invalid-request");

      process.env["APP_CHECK_MODE"] = "required";
      const signinWithoutAppCheckResponse = await withRequestDefaults(
        request(app).post("/api/v1/auth/signin").send({}),
      );
      expect(signinWithoutAppCheckResponse.status).toBe(400);
      expect(signinWithoutAppCheckResponse.body.type).toBe("/auth/signin/invalid-request");

      const missingAppCheckResponse = await withRequestDefaults(
        request(app).get("/api/v1/account/profile").set("Authorization", "Bearer invalid-session"),
      );
      expect(missingAppCheckResponse.status).toBe(401);
      expect(missingAppCheckResponse.body.type).toBe("/auth/app-check-required");

      const invalidAppCheckResponse = await withRequestDefaults(
        request(app)
          .get("/api/v1/account/profile")
          .set("Authorization", "Bearer invalid-firebase")
          .set("X-Firebase-AppCheck", "invalid-app-check"),
      );
      expect(invalidAppCheckResponse.status).toBe(401);
      expect(invalidAppCheckResponse.body.type).toBe("/auth/app-check-invalid");

      const validAppCheckResponse = await withRequestDefaults(
        request(app)
          .get("/api/v1/account/profile")
          .set("Authorization", "Bearer invalid-firebase")
          .set("X-Firebase-AppCheck", "valid-app-check"),
      );
      expect(validAppCheckResponse.status).toBe(401);
      expect(validAppCheckResponse.body.type).toBe("/auth/token-invalid");

      process.env["NODE_ENV"] = "production";
      delete process.env["APP_CHECK_MODE"];

      const productionDefaultResponse = await withRequestDefaults(
        request(app).get("/api/v1/account/profile").set("Authorization", "Bearer invalid-session"),
      );
      expect(productionDefaultResponse.status).toBe(401);
      expect(productionDefaultResponse.body.type).toBe("/auth/app-check-required");
    } finally {
      if (originalMode === undefined) {
        delete process.env["APP_CHECK_MODE"];
      } else {
        process.env["APP_CHECK_MODE"] = originalMode;
      }

      if (originalNodeEnvironment === undefined) {
        delete process.env["NODE_ENV"];
      } else {
        process.env["NODE_ENV"] = originalNodeEnvironment;
      }
    }
  });
});
