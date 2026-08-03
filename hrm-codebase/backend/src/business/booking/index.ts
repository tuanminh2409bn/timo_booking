import express from "express";
import { writeRateLimit } from "../../config/employee-rate-limits.js";
import { handleErrorFunction } from "../../modules/verify-error-function.js";
import { createAuthenticatedBooking } from "./post-create-booking.js";
import { updateBookingStatus } from "./patch-booking-status.js";
import { reassignBookingAttendance } from "./patch-reassign-booking.js";

const bookingRouter = express.Router();

bookingRouter.post(
  "/api/v1/stores/:storeId/bookings",
  writeRateLimit,
  handleErrorFunction(createAuthenticatedBooking),
);

bookingRouter.patch(
  "/api/v1/stores/:storeId/attendances/:attendanceId/status",
  writeRateLimit,
  handleErrorFunction(updateBookingStatus),
);

bookingRouter.patch(
  "/api/v1/stores/:storeId/attendances/:attendanceId/reassign",
  writeRateLimit,
  handleErrorFunction(reassignBookingAttendance),
);

export default bookingRouter;
