import type { Request, Response } from "express";
import type { DocumentReference } from "firebase-admin/firestore";
import { z } from "zod";
import { canAccessStore } from "../../helpers/role-access.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firestoreAuth, firestoreRepository } from "../../repository/firestore/index.js";
import { synchronizeWorkDaySettlement } from "../employee/work-days/work-day-settlement-sync.js";
import {
  BookingSlotConflictError,
  getBookingSlotReservationIds,
  replaceBookingSlotReservations,
  type SlotReservationSegment,
} from "./slot-reservations.js";

const payloadSchema = z.object({ employeeUserId: z.string().trim().min(1) });

export const reassignBookingAttendance = async (request: Request, response: Response) => {
  const authContext = await verifyAuthorizationHeader(request.headers["authorization"]);
  const storeId = String(request.params["storeId"] ?? "");
  const attendanceId = String(request.params["attendanceId"] ?? "");
  const parsed = payloadSchema.safeParse(request.body);
  if (!storeId || !attendanceId || !parsed.success) {
    return response.status(400).json({
      type: "/attendance/invalid-reassignment",
      message: "Invalid attendance reassignment",
    });
  }
  if (authContext.role !== "owner" && authContext.role !== "manager") {
    return response.status(403).json({
      type: "/attendance/forbidden-reassignment",
      message: "Only owner or manager may reassign the main employee",
    });
  }
  if (!canAccessStore(authContext, storeId)) {
    return response.status(403).json({
      type: "/attendance/forbidden-store",
      message: "Forbidden: store access denied",
    });
  }

  const [attendance, employee] = await Promise.all([
    firestoreRepository.shop.attendance.getShopAttendance(authContext.ownerId, storeId, attendanceId),
    firestoreRepository.user.getUser(parsed.data.employeeUserId),
  ]);
  const settlement = await firestoreRepository.shop.settlement.getWorkDaySettlement(
    authContext.ownerId,
    storeId,
    attendance.workDate,
  );
  if (settlement?.status === "closed") {
    return response.status(409).json({
      type: "/attendance/work-day-closed",
      message: "Attendance cannot be reassigned after day close",
    });
  }
  if (
    employee.ownerId !== authContext.ownerId ||
    employee.role !== "employee" ||
    employee.storeId !== storeId ||
    !employee.active
  ) {
    return response.status(400).json({
      type: "/attendance/invalid-main-employee",
      message: "Target employee must be active and belong to this store",
    });
  }

  const [attendanceSnapshot, leaveSnapshot] = await Promise.all([
    firestoreAuth
      .collection("stores")
      .doc(storeId)
      .collection("attendances")
      .where("workDate", "==", attendance.workDate)
      .get(),
    firestoreAuth
      .collection("stores")
      .doc(storeId)
      .collection("employee_leave_requests")
      .where("startDate", "<=", attendance.workDate)
      .get(),
  ]);
  const employeeUnavailable = leaveSnapshot.docs.some((document) => {
    const leave = document.data();
    return leave["ownerId"] === authContext.ownerId &&
      leave["employeeUserId"] === employee.uid &&
      typeof leave["endDate"] === "string" &&
      leave["endDate"] >= attendance.workDate;
  }) || attendanceSnapshot.docs.some((document) => {
    const item = document.data();
    const assignedEmployeeId = item["mainAssigneeUserId"] ?? item["employeeUserId"];
    return document.id !== attendance.id &&
      item["bookingId"] !== attendance.bookingId &&
      item["bookingStatus"] !== "cancelled" &&
      item["bookingStatus"] !== "no_show" &&
      assignedEmployeeId === employee.uid &&
      Number(item["startTime"] ?? 0) < attendance.endTime &&
      Number(item["endTime"] ?? 0) > attendance.startTime;
  });
  if (employeeUnavailable) {
    return response.status(409).json({
      type: "/attendance/reassignment-conflict",
      message: "Target employee is unavailable at this time",
    });
  }

  let bookingReference: DocumentReference | undefined;
  let previousSegments: SlotReservationSegment[] = [];
  let nextReservationIds: string[] | undefined;
  if (attendance.bookingId) {
    bookingReference = firestoreAuth
      .collection("stores")
      .doc(storeId)
      .collection("bookings")
      .doc(attendance.bookingId);
    const [bookingDocument, groupedSnapshot] = await Promise.all([
      bookingReference.get(),
      firestoreAuth
        .collection("stores")
        .doc(storeId)
        .collection("attendances")
        .where("bookingId", "==", attendance.bookingId)
        .get(),
    ]);
    const previousReservationIds = getBookingSlotReservationIds(bookingDocument.data() ?? {});
    previousSegments = groupedSnapshot.docs.flatMap((document) => {
      const value = document.data();
      const employeeUserId = value["mainAssigneeUserId"] ?? value["employeeUserId"];
      return typeof employeeUserId === "string"
        ? [{
            employeeUserId,
            startTime: Number(value["startTime"] ?? 0),
            endTime: Number(value["endTime"] ?? 0),
          }]
        : [];
    });
    const replacementSegments = previousSegments.map((segment) =>
      segment.startTime === attendance.startTime &&
      segment.endTime === attendance.endTime &&
      segment.employeeUserId === (attendance.mainAssigneeUserId ?? attendance.employeeUserId)
        ? { ...segment, employeeUserId: employee.uid }
        : segment,
    );
    try {
      nextReservationIds = await replaceBookingSlotReservations({
        ownerId: authContext.ownerId,
        storeId,
        bookingId: attendance.bookingId,
        workDate: attendance.workDate,
        currentReservationIds: previousReservationIds,
        segments: replacementSegments,
      });
    } catch (error) {
      if (error instanceof BookingSlotConflictError) {
        return response.status(409).json({
          type: "/attendance/reassignment-conflict",
          message: error.message,
        });
      }
      throw error;
    }
  }
  if (
    employee.serviceIds !== undefined &&
    employee.serviceIds.length > 0 &&
    attendance.services.some(
      (service) => service.sourceServiceId && !employee.serviceIds?.includes(service.sourceServiceId),
    )
  ) {
    return response.status(400).json({
      type: "/attendance/employee-service-mismatch",
      message: "Target employee cannot perform every service in this attendance",
    });
  }

  const employeeName = employee.name?.trim() || employee.displayName?.trim() || employee.email;
  const workerType = employee.workerType ??
    (employee.compensationModel === "fixed" ? "assistant" : "main");
  const services = attendance.services.map((service) => ({
    ...service,
    employees: [{
      employeeUserId: employee.uid,
      employeeName,
      workerType,
      percentage: 100,
      shareAmount: service.price,
    }],
  }));
  try {
    await firestoreRepository.shop.attendance.updateShopAttendance(
    authContext.ownerId,
    storeId,
    attendanceId,
    {
      employeeUserId: employee.uid,
      mainAssigneeUserId: employee.uid,
      assignees: [{
        employeeUserId: employee.uid,
        employeeName,
        workerType,
        percentage: 100,
        shareAmount: attendance.subtotalAmount,
      }],
      services,
      bookingStatus: "confirmed",
      updatedBy: authContext.uid,
      updatedByUserId: authContext.uid,
      updatedByRole: authContext.role,
    },
    attendance,
    { deleteFields: ["assistantAssigneeUserId"] },
    );
    if (bookingReference && nextReservationIds) {
      await bookingReference.update({ slotReservationIds: nextReservationIds, updatedAt: Date.now() });
    }
  } catch (error) {
    if (attendance.bookingId && nextReservationIds) {
      await replaceBookingSlotReservations({
        ownerId: authContext.ownerId,
        storeId,
        bookingId: attendance.bookingId,
        workDate: attendance.workDate,
        currentReservationIds: nextReservationIds,
        segments: previousSegments,
      }).catch(() => undefined);
    }
    throw error;
  }
  await synchronizeWorkDaySettlement(authContext.ownerId, storeId, attendance.workDate);

  return response.status(200).json({
    id: attendance.id,
    employeeUserId: employee.uid,
    employeeName,
    assistantCleared: true,
  });
};
