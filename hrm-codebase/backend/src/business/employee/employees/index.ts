import express from "express";
import { handleErrorFunction } from "../../../modules/verify-error-function.js";
import { observeBusinessHandler } from "../../../modules/business-observability.js";
import { readRateLimit, writeRateLimit } from "../../../config/employee-rate-limits.js";
import { getEmployeeList } from "./get-employee-list.js";
import { getEmployeeAttendanceDays } from "./get-employee-attendance-days.js";
import { getEmployeeDetail } from "./get-employee-detail.js";
import { createEmployee } from "./post-create-employee.js";
import { updateEmployeeBasicInformation } from "./patch-update-employee-basic-information.js";
import { updateEmployeeEmploymentStatus } from "./patch-update-employee-employment-status.js";
import { updateEmployeeWorkingHours } from "./patch-update-employee-working-hours.js";
import { updateEmployeeServices } from "./patch-update-employee-services.js";
import { updateEmployeePassword } from "./patch-update-employee-password.js";

const employeesRouter = express.Router();

employeesRouter.get(
  "/api/v1/stores/:storeId/employees",
  readRateLimit,
  handleErrorFunction(getEmployeeList),
);
employeesRouter.get(
  "/api/v1/stores/:storeId/employees/:employeeUserId/attendance-days",
  readRateLimit,
  handleErrorFunction(getEmployeeAttendanceDays),
);
employeesRouter.get(
  "/api/v1/stores/:storeId/employees/:employeeUserId",
  readRateLimit,
  handleErrorFunction(getEmployeeDetail),
);
employeesRouter.post(
  "/api/v1/stores/:storeId/employees",
  writeRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "employee.create",
        route: "/api/v1/stores/:storeId/employees",
      },
      createEmployee,
    ),
  ),
);
employeesRouter.patch(
  "/api/v1/stores/:storeId/employees/:employeeUserId",
  writeRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "employee.update",
        route: "/api/v1/stores/:storeId/employees/:employeeUserId",
      },
      updateEmployeeBasicInformation,
    ),
  ),
);
employeesRouter.patch(
  "/api/v1/stores/:storeId/employees/:employeeUserId/employment-status",
  writeRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "employee.employment_status.update",
        route: "/api/v1/stores/:storeId/employees/:employeeUserId/employment-status",
      },
      updateEmployeeEmploymentStatus,
    ),
  ),
);
employeesRouter.patch(
  "/api/v1/stores/:storeId/employees/:employeeUserId/working-hours",
  writeRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "employee.working_hours.update",
        route: "/api/v1/stores/:storeId/employees/:employeeUserId/working-hours",
      },
      updateEmployeeWorkingHours,
    ),
  ),
);
employeesRouter.patch(
  "/api/v1/stores/:storeId/employees/:employeeUserId/services",
  writeRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "employee.services.update",
        route: "/api/v1/stores/:storeId/employees/:employeeUserId/services",
      },
      updateEmployeeServices,
    ),
  ),
);
employeesRouter.patch(
  "/api/v1/stores/:storeId/employees/:employeeUserId/password",
  writeRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "employee.password.update",
        route: "/api/v1/stores/:storeId/employees/:employeeUserId/password",
      },
      updateEmployeePassword,
    ),
  ),
);

export default employeesRouter;
