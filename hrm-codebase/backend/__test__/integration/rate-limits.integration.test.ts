import request from "supertest";
import { describe, expect, it } from "vitest";
import { app, withRequestIp } from "./backend-api-fixture.js";

describe("backend API integration: rate limits", () => {
  it("rate limits global API traffic with standard 429 metadata", async () => {
    const fixedIp = "198.51.100.10";
    let rateLimitedResponse = await withRequestIp(
      request(app).get("/api/rate-limit-probe-global"),
      fixedIp,
    );

    for (let attempt = 1; attempt < 181; attempt += 1) {
      rateLimitedResponse = await withRequestIp(
        request(app).get("/api/rate-limit-probe-global"),
        fixedIp,
      );
    }

    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.headers["retry-after"]).toBe("60");
    expect(rateLimitedResponse.headers["x-ratelimit-limit"]).toBe("180");
    expect(rateLimitedResponse.headers["x-ratelimit-remaining"]).toBe("0");
    expect(rateLimitedResponse.headers["x-ratelimit-window-ms"]).toBe("60000");
    expect(rateLimitedResponse.body).toMatchObject({
      type: "/request/rate-limit",
      message: "Too many API requests",
      retryAfterSeconds: 60,
    });
  });

  it("rate limits signin attempts by IP and by submitted email fingerprint", async () => {
    const fixedIp = "198.51.100.20";
    let ipLimitedResponse = await withRequestIp(
      request(app).post("/api/v1/auth/signin").set("Authorization", "Bearer invalid-ip-0"),
      fixedIp,
    );

    for (let attempt = 1; attempt < 9; attempt += 1) {
      ipLimitedResponse = await withRequestIp(
        request(app)
          .post("/api/v1/auth/signin")
          .set("Authorization", `Bearer invalid-ip-${attempt}`),
        fixedIp,
      );
    }

    expect(ipLimitedResponse.status).toBe(429);
    expect(ipLimitedResponse.body).toMatchObject({
      type: "/request/rate-limit",
      message: "Too many authentication attempts",
      retryAfterSeconds: 60,
    });

    let emailLimitedResponse = await withRequestIp(
      request(app)
        .post("/api/v1/auth/signin")
        .set("Authorization", "Bearer invalid-email-0")
        .send({ email: "signin-rate@example.com" }),
      "198.51.100.30",
    );

    for (let attempt = 1; attempt < 9; attempt += 1) {
      emailLimitedResponse = await withRequestIp(
        request(app)
          .post("/api/v1/auth/signin")
          .set("Authorization", `Bearer invalid-email-${attempt}`)
          .send({ email: "SIGNIN-RATE@example.com" }),
        `198.51.100.${30 + attempt}`,
      );
    }

    expect(emailLimitedResponse.status).toBe(429);
    expect(emailLimitedResponse.headers["retry-after"]).toBe("60");
    expect(emailLimitedResponse.headers["x-ratelimit-limit"]).toBe("8");
    expect(emailLimitedResponse.body.retryAfterSeconds).toBe(60);
  });

  it.skip("rate limits OTP requests by email even when the IP changes", async () => { // PARKED customer-journey
    let rateLimitedResponse = await withRequestIp(
      request(app)
        .post("/api/v1/auth/forgot-password/request-otp")
        .send({ email: "otp-rate@example.com" }),
      "198.51.100.50",
    );

    for (let attempt = 1; attempt < 4; attempt += 1) {
      rateLimitedResponse = await withRequestIp(
        request(app)
          .post("/api/v1/auth/forgot-password/request-otp")
          .send({ email: "OTP-RATE@example.com" }),
        `198.51.100.${50 + attempt}`,
      );
    }

    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.headers["retry-after"]).toBe("600");
    expect(rateLimitedResponse.headers["x-ratelimit-limit"]).toBe("3");
    expect(rateLimitedResponse.body).toMatchObject({
      type: "/request/rate-limit",
      message: "Too many OTP requests",
      retryAfterSeconds: 600,
    });
  });
});
