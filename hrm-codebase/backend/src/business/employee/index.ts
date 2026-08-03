import express from "express";
import employeesRouter from "./employees/index.js";
import leaveRequestsRouter from "./leave-requests/index.js";
import attendanceRouter from "./attendance/index.js";
import workDaysRouter from "./work-days/index.js";
import salaryRouter from "./salary/index.js";
import reportsRouter from "./reports/index.js";
import portalRouter from "./portal/index.js";
import timeTrackingRouter from "./time-tracking/index.js";

const employeeRouter = express.Router();

employeeRouter.use(employeesRouter);
employeeRouter.use(leaveRequestsRouter);
employeeRouter.use(attendanceRouter);
employeeRouter.use(workDaysRouter);
employeeRouter.use(salaryRouter);
employeeRouter.use(reportsRouter);
employeeRouter.use(portalRouter);
employeeRouter.use(timeTrackingRouter);

export default employeeRouter;
