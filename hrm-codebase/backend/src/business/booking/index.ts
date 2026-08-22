import express from "express";
import { readRateLimit, writeRateLimit } from "../../config/employee-rate-limits.js";
import { handleErrorFunction } from "../../modules/verify-error-function.js";
import { createAuthenticatedBooking } from "./post-create-booking.js";
import { updateBookingStatus } from "./patch-booking-status.js";
import { reassignBookingAttendance } from "./patch-reassign-booking.js";
import {
  deleteAllBookingData,
  getBookingPurgePreview,
} from "./delete-all-booking-data.js";

const bookingRouter = express.Router();

bookingRouter.post(
  "/api/v1/stores/:storeId/bookings",
  writeRateLimit,
  handleErrorFunction(createAuthenticatedBooking),
);

bookingRouter.get(
  "/api/v1/stores/:storeId/bookings/purge-preview",
  readRateLimit,
  handleErrorFunction(getBookingPurgePreview),
);

bookingRouter.delete(
  "/api/v1/stores/:storeId/bookings",
  writeRateLimit,
  handleErrorFunction(deleteAllBookingData),
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
