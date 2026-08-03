import express from "express";
import { handleErrorFunction } from "../../../modules/verify-error-function.js";
import { observeBusinessHandler } from "../../../modules/business-observability.js";
import { heavyReadRateLimit } from "../../../config/employee-rate-limits.js";
import { getMonthlySalaryOptimized } from "./get-monthly-salary-optimized.js";
import { getWeeklySalary } from "./get-weekly-salary.js";

const salaryRouter = express.Router();

salaryRouter.get(
  "/api/v1/stores/:storeId/salaries/monthly",
  heavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "salary.monthly.generated",
        route: "/api/v1/stores/:storeId/salaries/monthly",
        spanName: "salary.monthly.get",
      },
      getMonthlySalaryOptimized,
    ),
  ),
);

salaryRouter.get(
  "/api/v1/stores/:storeId/salaries/weekly",
  heavyReadRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "salary.weekly.generated",
        route: "/api/v1/stores/:storeId/salaries/weekly",
        spanName: "salary.weekly.get",
      },
      getWeeklySalary,
    ),
  ),
);

export default salaryRouter;
