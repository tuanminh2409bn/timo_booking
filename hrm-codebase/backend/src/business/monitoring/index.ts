import express from "express";
import { handleErrorFunction } from "../../modules/verify-error-function.js";
import { getHealth } from "./get-health.js";
import { getMetrics } from "./get-metrics.js";
import { getReadiness } from "./get-readiness.js";

const monitoringRouter = express.Router();

monitoringRouter.get("/health", handleErrorFunction(getHealth));
monitoringRouter.get("/ready", handleErrorFunction(getReadiness));
monitoringRouter.get("/metrics", handleErrorFunction(getMetrics));

export default monitoringRouter;
