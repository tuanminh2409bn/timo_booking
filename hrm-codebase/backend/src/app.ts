import type { NextFunction, Request, Response } from "express";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import userRouter from "./business/user/index.js";
import authRouter from "./business/authentication/index.js";
import employeeRouter from "./business/employee/index.js";
import monitoringRouter from "./business/monitoring/index.js";
import publicBookingRouter from "./business/public-booking/index.js";
import customerPortalRouter from "./business/customer-portal/index.js";
import notificationRouter from "./business/notification/index.js";
import shopRouter from "./business/shop/index.js";
import weeklyReportRouter from "./business/shop/weekly-reports/weekly-report-index.js";
import billingRouter from "./business/billing/index.js";
import bookingRouter from "./business/booking/index.js";
import adminRouter from "./business/admin/index.js";
import paypalWebhookRouter from "./business/billing/paypal-webhook-index.js";
import { stripeWebhook } from "./business/billing/stripe.js";
import createError from "http-errors";
import { StatusCodes } from "http-status-codes";
import APIResponseError from "./constants/api-response-error.js";
import { metricsMiddleware } from "./modules/metrics.js";
import {
  buildIpRateLimitFingerprint,
  createRequestRateLimit,
} from "./modules/request-rate-limit.js";
import { verifyFirebaseAppCheck } from "./modules/verify-app-check.js";
import { createIdempotencyMiddleware } from "./modules/idempotency.js";
import {
  logRequestError,
  requestContextMiddleware,
  structuredRequestLogger,
} from "./modules/logger.js";

const app = express();
app.disable("etag");
app.disable("x-powered-by");

const resolveTrustProxyHops = () => {
  const rawValue = process.env["TRUST_PROXY_HOPS"];

  if (!rawValue) {
    return 0;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
};

app.set("trust proxy", resolveTrustProxyHops());

const resolveCorsOrigin = (): string[] => {
  // Always include the Timmo Booking app domains
  const bookingOrigins: string[] = [
    "https://aqueous-thought-498514-m3.web.app",
    "https://aqueous-thought-498514-m3.firebaseapp.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ];

  const raw = process.env["CORS_ALLOWED_ORIGINS"];
  if (raw) {
    const configured = raw
      .split(",")
      .map((o) => o.trim())
      .filter((o): o is string => o.length > 0);
    if (configured.length > 0) {
      return configured.concat(bookingOrigins);
    }
  }

  return ["http://localhost:5173", "http://127.0.0.1:5173", "https://daeyang-sea.github.io"].concat(
    bookingOrigins,
  );
};

const globalApiRateLimit = createRequestRateLimit({
  keyPrefix: "ratelimit:global-api",
  limit: 180,
  windowMs: 60_000,
  message: "Too many API requests",
  fingerprintBuilder: buildIpRateLimitFingerprint,
});

// Core middleware
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = resolveCorsOrigin();

      if (!origin || process.env["NODE_ENV"] !== "production" || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: false,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
    optionsSuccessStatus: 204,
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "If-None-Match",
      "X-Firebase-AppCheck",
      "X-Idempotency-Key",
      "X-Request-Id",
      "traceparent",
    ],
    exposedHeaders: [
      "ETag",
      "Server-Timing",
      "X-Cache",
      "X-Idempotency-Replayed",
      "X-Request-Id",
      "X-Trace-Id",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Window-Ms",
      "Retry-After",
    ],
  }),
);
app.use(requestContextMiddleware);
app.use(structuredRequestLogger);
app.use(metricsMiddleware);
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  const contentLengthHeader = req.headers["content-length"];
  const contentLength =
    typeof contentLengthHeader === "string" ? Number.parseInt(contentLengthHeader, 10) : 0;

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    next();
    return;
  }

  if (req.is("application/json") || req.is("application/x-www-form-urlencoded")) {
    next();
    return;
  }

  res.locals["requestError"] = {
    statusCode: 415,
    errorType: "/request/unsupported-media-type",
    errorName: "UnsupportedMediaTypeError",
    errorMessage: "Content-Type must be application/json",
    errorSource: "validation",
    errorScope: "request",
  };
  res.status(415).json({
    type: "/request/unsupported-media-type",
    message: "Content-Type must be application/json",
  });
});
const defaultJsonParser = express.json({ limit: "512kb" });
const uploadJsonParser = express.json({ limit: "8mb" });

app.use("/api/v1/stores/:storeId/expense-receipts", uploadJsonParser);
app.use("/api/v1/expenses/receipt-image", uploadJsonParser);
app.post("/api/v1/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhook);
app.use(defaultJsonParser);
app.use(express.urlencoded({ extended: false, limit: "16kb" }));

app.use("/api/v1", (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use("/api/v1/monitoring", monitoringRouter);
app.use(publicBookingRouter);
app.use(customerPortalRouter);
app.use(paypalWebhookRouter);
app.use("/api/v1", verifyFirebaseAppCheck);

app.use(authRouter);
app.use("/api/v1", createIdempotencyMiddleware());
app.use(userRouter);
app.use(billingRouter);
app.use(bookingRouter);
app.use(adminRouter);
app.use(employeeRouter);
app.use(notificationRouter);
app.use(shopRouter);
app.use(weeklyReportRouter);

app.get("/", (_req: Request, res: Response) => {
  res.send("This is the backend service of Nail Salon Management System!");
});

// Domain routes already apply their own policy. Keep the global limiter as a fallback
// for unmatched API requests so valid routes do not consume two Redis counters.
app.use("/api", (request: Request, response: Response, next: NextFunction) => {
  globalApiRateLimit(request, response, next).catch(next);
});

app.use(function (_req: Request, _res: Response, next: NextFunction) {
  next(createError(404));
});

// Error handler
app.use(function (err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof APIResponseError) {
    logRequestError(res, err, err.statusCode, err.type);
    res.status(err.statusCode).json({
      type: err.type,
      message: err.message,
    });
  } else if (createError.isHttpError(err) && err.statusCode === StatusCodes.REQUEST_TOO_LONG) {
    logRequestError(res, err, StatusCodes.REQUEST_TOO_LONG, "/request/payload-too-large");
    res.status(StatusCodes.REQUEST_TOO_LONG).json({
      type: "/request/payload-too-large",
      message: "Request payload is too large",
    });
  } else if (createError.isHttpError(err) && err.statusCode === StatusCodes.NOT_FOUND) {
    logRequestError(res, err, StatusCodes.NOT_FOUND, "/request/not-found");
    res.status(StatusCodes.NOT_FOUND).json({
      type: "/request/not-found",
      message: "Route not found",
    });
  } else {
    const statusCode = createError.isHttpError(err)
      ? err.statusCode
      : StatusCodes.INTERNAL_SERVER_ERROR;
    logRequestError(res, err, statusCode, "/internal-server-error");
    res.status(statusCode).json({
      type: "/internal-server-error",
      message: "Internal Server Error",
    });
  }
});

export default app;
