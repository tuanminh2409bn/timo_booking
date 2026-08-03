import type { NextFunction, Request, Response } from "express";
import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const metricsRegister = new Registry();

metricsRegister.setDefaultLabels({
  service: process.env["OTEL_SERVICE_NAME"] ?? "nail-salon-backend",
});

const normalizeRawPath = (path: string): string => {
  const dynamicRoutes: Array<[RegExp, string]> = [
    [
      /^\/api\/v1\/stores\/[^/]+\/services\/[^/]+$/,
      "/api/v1/stores/:storeId/services/:serviceId",
    ],
    [
      /^\/api\/v1\/stores\/[^/]+\/expenses\/[^/]+$/,
      "/api/v1/stores/:storeId/expenses/:expenseId",
    ],
    [
      /^\/api\/v1\/stores\/[^/]+\/employees\/[^/]+$/,
      "/api/v1/stores/:storeId/employees/:employeeUserId",
    ],
    [
      /^\/api\/v1\/stores\/[^/]+\/attendances\/calendar$/,
      "/api/v1/stores/:storeId/attendances/calendar",
    ],
    [
      /^\/api\/v1\/stores\/[^/]+\/attendances\/form-options$/,
      "/api/v1/stores/:storeId/attendances/form-options",
    ],
    [
      /^\/api\/v1\/stores\/[^/]+\/attendances\/backfill$/,
      "/api/v1/stores/:storeId/attendances/backfill",
    ],
    [
      /^\/api\/v1\/stores\/[^/]+\/attendances\/[^/]+$/,
      "/api/v1/stores/:storeId/attendances/:attendanceId",
    ],
    [
      /^\/api\/v1\/stores\/[^/]+\/weekly-reports\/[^/]+$/,
      "/api/v1/stores/:storeId/weekly-reports/:weekStartDate",
    ],
    [/^\/api\/v1\/stores\/[^/]+$/, "/api/v1/stores/:storeId"],
  ];
  const matchedRoute = dynamicRoutes.find(([pattern]) => pattern.test(path));

  return matchedRoute?.[1] ?? path;
};

export const normalizeHttpRoute = (request: Request): string => {
  const routePath = request.route?.path;

  if (typeof routePath === "string") {
    const baseUrl = request.baseUrl && request.baseUrl !== "/" ? request.baseUrl : "";
    const resolvedPath = routePath === "/" ? baseUrl || "/" : `${baseUrl}${routePath}`;
    return normalizeRawPath(resolvedPath);
  }

  return normalizeRawPath(request.path || request.originalUrl.split("?")[0] || "unknown");
};

const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests handled by the backend.",
  labelNames: ["method", "route", "status_code"],
  registers: [metricsRegister],
});

const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegister],
});

const httpRequestErrorsTotal = new Counter({
  name: "http_request_errors_total",
  help: "Total HTTP requests completed with an error status code.",
  labelNames: ["method", "route", "status_code"],
  registers: [metricsRegister],
});

const httpInFlightRequests = new Gauge({
  name: "http_in_flight_requests",
  help: "HTTP requests currently in flight.",
  labelNames: ["method", "route"],
  registers: [metricsRegister],
});

new Gauge({
  name: "nodejs_process_uptime_seconds",
  help: "Node.js process uptime in seconds.",
  registers: [metricsRegister],
  collect() {
    this.set(process.uptime());
  },
});

export const metricsMiddleware = (request: Request, response: Response, next: NextFunction) => {
  const startTime = process.hrtime.bigint();
  const inFlightLabels = {
    method: request.method,
    route: normalizeHttpRoute(request),
  };

  httpInFlightRequests.inc(inFlightLabels);

  response.once("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1_000_000_000;
    const labels = {
      method: request.method,
      route: normalizeHttpRoute(request),
      status_code: String(response.statusCode),
    };

    httpInFlightRequests.dec(inFlightLabels);
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);

    if (response.statusCode >= 400) {
      httpRequestErrorsTotal.inc(labels);
    }
  });

  next();
};

export const getMetricsText = async () => metricsRegister.metrics();

export const resetMetricsForTesting = () => {
  metricsRegister.resetMetrics();
};
