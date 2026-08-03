import request from "supertest";
import { describe, expect, it } from "vitest";
import { resetMetricsForTesting } from "../../src/modules/metrics.js";
import { app, ownerSessionHeader, withRequestDefaults } from "./backend-api-fixture.js";

describe("backend API integration: monitoring", () => {
  it("serves health and readiness probes without authentication", async () => {
    const healthResponse = await withRequestDefaults(
      request(app).get("/api/v1/monitoring/health"),
    );

    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body).toMatchObject({
      status: "ok",
      service: "nail-salon-backend",
      version: "1.0.0",
    });
    expect(healthResponse.body.uptimeSec).toEqual(expect.any(Number));
    expect(Number.isNaN(Date.parse(healthResponse.body.timestamp as string))).toBe(false);

    const readinessResponse = await withRequestDefaults(
      request(app).get("/api/v1/monitoring/ready"),
    );

    expect(readinessResponse.status).toBe(200);
    expect(readinessResponse.body.status).toBe("ready");
    expect(readinessResponse.body.checks).toMatchObject({
      env: "ok",
      firestore: "ok",
    });
    expect(["ok", "degraded"]).toContain(readinessResponse.body.checks.cache);
  });

  it("returns not_ready when required environment checks fail", async () => {
    const originalProjectId = process.env["GCP_PROJECT_ID"];

    try {
      delete process.env["GCP_PROJECT_ID"];

      const readinessResponse = await withRequestDefaults(
        request(app).get("/api/v1/monitoring/ready"),
      );

      expect(readinessResponse.status).toBe(503);
      expect(readinessResponse.body).toMatchObject({
        status: "not_ready",
        checks: {
          env: "error",
          firestore: "ok",
        },
      });
      expect(readinessResponse.body.checks.cache).not.toBe("error");
    } finally {
      if (originalProjectId === undefined) {
        delete process.env["GCP_PROJECT_ID"];
      } else {
        process.env["GCP_PROJECT_ID"] = originalProjectId;
      }
    }
  });

  it("exposes Prometheus metrics without leaking request credentials", async () => {
    resetMetricsForTesting();

    await withRequestDefaults(
      request(app)
        .get("/api/v1/account/profile")
        .set("Authorization", ownerSessionHeader())
        .set("X-Request-Id", "metrics-leak-check"),
    );

    const metricsResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/monitoring/metrics")
        .set("Authorization", "Bearer super-secret-token"),
    );

    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.headers["content-type"]).toContain("text/plain");
    expect(metricsResponse.text).toContain("http_requests_total");
    expect(metricsResponse.text).toContain("http_request_duration_seconds");
    expect(metricsResponse.text).toContain("http_request_errors_total");
    expect(metricsResponse.text).toContain("http_in_flight_requests");
    expect(metricsResponse.text).toContain("nodejs_process_uptime_seconds");
    expect(metricsResponse.text).not.toContain("super-secret-token");
    expect(metricsResponse.text).not.toContain("Authorization");
    expect(metricsResponse.text).not.toContain("Bearer");
  });

  it("normalizes dynamic route labels in Prometheus metrics", async () => {
    resetMetricsForTesting();

    await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances/attendance-1")
        .set("Authorization", ownerSessionHeader()),
    );

    const metricsResponse = await withRequestDefaults(
      request(app).get("/api/v1/monitoring/metrics"),
    );

    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.text).toContain(
      'route="/api/v1/stores/:storeId/attendances/:attendanceId"',
    );
    expect(metricsResponse.text).not.toContain(
      'route="/api/v1/stores/branch-1/attendances/attendance-1"',
    );
  });

  it("keeps the attendance calendar route separate from attendance detail metrics", async () => {
    resetMetricsForTesting();

    await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/attendances/calendar")
        .query({ workDate: "2026-05-05", view: "day" })
        .set("Authorization", ownerSessionHeader()),
    );

    const metricsResponse = await withRequestDefaults(
      request(app).get("/api/v1/monitoring/metrics"),
    );

    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.text).toContain(
      'route="/api/v1/stores/:storeId/attendances/calendar"',
    );
  });
});
