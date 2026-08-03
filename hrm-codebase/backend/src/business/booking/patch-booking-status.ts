import type { Request, Response } from "express";
import { z } from "zod";
import { canAccessStore } from "../../helpers/role-access.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firestoreAuth, firestoreRepository } from "../../repository/firestore/index.js";
import type { ShopAttendanceBookingStatus, ShopAttendanceType } from "../../repository/firestore/shop/shop.types.js";
import { synchronizeWorkDaySettlement } from "../employee/work-days/work-day-settlement-sync.js";
import {
  getBookingSlotReservationIds,
  releaseBookingSlotReservations,
} from "./slot-reservations.js";

const frontendStatusSchema = z.enum([
  "pending_approval",
  "requested",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
  "needs_owner_action",
  "processing",
]);
const payloadSchema = z.object({
  status: frontendStatusSchema,
  reason: z.string().trim().min(1).max(500).optional(),
});

const toBookingStatus = (status: z.infer<typeof frontendStatusSchema>): ShopAttendanceBookingStatus => {
  if (status === "pending_approval") return "requested";
  if (status === "needs_owner_action") return "processing";
  if (status === "completed") return "confirmed";
  return status;
};

export const updateBookingStatus = async (request: Request, response: Response) => {
  const authContext = await verifyAuthorizationHeader(request.headers["authorization"]);
  const storeId = String(request.params["storeId"] ?? "");
  const attendanceId = String(request.params["attendanceId"] ?? "");
  const parsed = payloadSchema.safeParse(request.body);
  if (!storeId || !attendanceId || !parsed.success) {
    return response.status(400).json({
      type: "/attendance/invalid-status-request",
      message: "Invalid attendance status request",
    });
  }
  if (!canAccessStore(authContext, storeId)) {
    return response.status(403).json({
      type: "/attendance/forbidden-store",
      message: "Forbidden: store access denied",
    });
  }

  const attendance = await firestoreRepository.shop.attendance.getShopAttendance(
    authContext.ownerId,
    storeId,
    attendanceId,
  );
  const settlement = await firestoreRepository.shop.settlement.getWorkDaySettlement(
    authContext.ownerId,
    storeId,
    attendance.workDate,
  );
  if (settlement?.status === "closed") {
    return response.status(409).json({
      type: "/attendance/work-day-closed",
      message: "Attendance cannot be changed after day close",
    });
  }

  const requestedStatus = parsed.data.status;
  const employeeIsMain =
    authContext.role === "employee" &&
    (attendance.mainAssigneeUserId ?? attendance.employeeUserId) === authContext.uid;
  if (
    authContext.role === "employee" &&
    (!employeeIsMain || !["completed", "no_show"].includes(requestedStatus))
  ) {
    return response.status(403).json({
      type: "/attendance/forbidden-status-transition",
      message: "Employee may only complete or mark no-show for their own attendance",
    });
  }
  if (
    authContext.role !== "employee" &&
    authContext.role !== "owner" &&
    authContext.role !== "manager"
  ) {
    return response.status(403).json({
      type: "/attendance/forbidden-status-transition",
      message: "Forbidden: insufficient permissions",
    });
  }
  if (requestedStatus === "cancelled" && authContext.role === "employee") {
    return response.status(403).json({
      type: "/attendance/forbidden-status-transition",
      message: "Employees cannot cancel bookings",
    });
  }

  const bookingStatus = toBookingStatus(requestedStatus);
  const groupedAttendances: ShopAttendanceType[] = [];
  if (attendance.bookingId && ["cancelled", "no_show"].includes(requestedStatus)) {
    const snapshot = await firestoreAuth
      .collection("stores")
      .doc(storeId)
      .collection("attendances")
      .where("bookingId", "==", attendance.bookingId)
      .get();
    for (const document of snapshot.docs) {
      const value = document.data() as ShopAttendanceType;
      if (value.ownerId === authContext.ownerId) {
        groupedAttendances.push({ ...value, id: document.id });
      }
    }
  }
  if (groupedAttendances.length === 0) groupedAttendances.push(attendance);

  for (const item of groupedAttendances) {
    await firestoreRepository.shop.attendance.updateShopAttendance(
      authContext.ownerId,
      storeId,
      item.id,
      {
        bookingStatus,
        ...(requestedStatus === "completed" && { status: "closed" }),
        updatedBy: authContext.uid,
        updatedByUserId: authContext.uid,
        updatedByRole: authContext.role === "employee" ? "employee" : authContext.role,
      },
      item,
    );
  }

  if (attendance.bookingId) {
    const bookingReference = firestoreAuth
      .collection("stores")
      .doc(storeId)
      .collection("bookings")
      .doc(attendance.bookingId);
    const bookingDocument = await bookingReference.get();
    if (bookingDocument.exists) {
      await bookingReference.update({
        ...(requestedStatus !== "completed" && { bookingStatus }),
        ...(parsed.data.reason !== undefined && { statusReason: parsed.data.reason }),
        updatedByType: "user",
        updatedById: authContext.uid,
        updatedByRole: authContext.role,
        updatedAt: Date.now(),
      });
      if (["cancelled", "no_show"].includes(requestedStatus)) {
        await releaseBookingSlotReservations(
          storeId,
          getBookingSlotReservationIds(bookingDocument.data() ?? {}),
        );
      }
    }
  }
  await synchronizeWorkDaySettlement(authContext.ownerId, storeId, attendance.workDate);

  return response.status(200).json({
    id: attendanceId,
    bookingId: attendance.bookingId,
    status: requestedStatus,
    affectedAttendanceIds: groupedAttendances.map((item) => item.id),
  });
};
