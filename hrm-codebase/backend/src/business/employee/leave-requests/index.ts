import express from "express";
import { handleErrorFunction } from "../../../modules/verify-error-function.js";
import { observeBusinessHandler } from "../../../modules/business-observability.js";
import { readRateLimit, writeRateLimit } from "../../../config/employee-rate-limits.js";
import { getEmployeeLeaveRequests } from "./get-employee-leave-requests.js";
import { createEmployeeLeaveRequest } from "./post-create-employee-leave-request.js";
import { deleteEmployeeLeaveRequest } from "./delete-employee-leave-request.js";

const leaveRequestsRouter = express.Router();

leaveRequestsRouter.get(
  "/api/v1/stores/:storeId/employees/:employeeUserId/leave-requests",
  readRateLimit,
  handleErrorFunction(getEmployeeLeaveRequests),
);
leaveRequestsRouter.post(
  "/api/v1/stores/:storeId/employees/:employeeUserId/leave-requests",
  writeRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "employee.leave.create",
        route: "/api/v1/stores/:storeId/employees/:employeeUserId/leave-requests",
      },
      createEmployeeLeaveRequest,
    ),
  ),
);
leaveRequestsRouter.delete(
  "/api/v1/stores/:storeId/employees/:employeeUserId/leave-requests/:leaveRequestId",
  writeRateLimit,
  handleErrorFunction(
    observeBusinessHandler(
      {
        eventName: "employee.leave.delete",
        route: "/api/v1/stores/:storeId/employees/:employeeUserId/leave-requests/:leaveRequestId",
      },
      deleteEmployeeLeaveRequest,
    ),
  ),
);

export default leaveRequestsRouter;
