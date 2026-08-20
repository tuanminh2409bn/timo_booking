import { firestoreAuth, firestoreRepository } from "../../../repository/firestore/index.js";
import { synchronizeWorkDaySettlement } from "../work-days/work-day-settlement-sync.js";
import { leaveOverlapsAttendance, type EmployeeLeaveWindow } from "./leave-request-shared.js";

type ProcessLeaveConflictsInput = {
  ownerId: string;
  storeId: string;
  employeeUserId: string;
  leaveWindow: EmployeeLeaveWindow;
  actorUserId: string;
  actorRole: "owner" | "manager" | "employee" | "admin";
};

/** Keep every affected booking with its original employee and flag it for the owner. */
export const processLeaveConflicts = async (input: ProcessLeaveConflictsInput) => {
  const attendanceActorRole = input.actorRole === "admin" ? "manager" : input.actorRole;
  const conflicts = (await firestoreRepository.shop.attendance.listShopAttendanceByEmployeeDateRange(
    input.ownerId, input.storeId, input.employeeUserId, input.leaveWindow.startDate, input.leaveWindow.endDate,
  )).filter((attendance) =>
    attendance.bookingStatus !== "cancelled" &&
    attendance.bookingStatus !== "no_show" &&
    leaveOverlapsAttendance(
      input.leaveWindow,
      attendance.workDate,
      attendance.startTime,
      attendance.endTime,
    )
  );
  if (conflicts.length === 0) return { reassigned: 0, manual: 0 };

  let manual = 0;
  const affectedBookingIds = new Set<string>();
  const affectedDates = new Set<string>();

  for (const attendance of conflicts) {
    const affectedEmployeeName = attendance.assignees.find(
      (assignee) => assignee.employeeUserId === input.employeeUserId,
    )?.employeeName ?? attendance.services
      .flatMap((service) => service.employees ?? [])
      .find((assignee) => assignee.employeeUserId === input.employeeUserId)
      ?.employeeName ?? input.employeeUserId;
    // Assigned Requests must remain Requests until the owner explicitly
    // approves them. Confirmed appointments keep their employee assignment,
    // move to processing, and are rendered with the warning triangle.
    if (attendance.bookingStatus === "requested") {
      await firestoreRepository.shop.attendance.updateShopAttendance(
        input.ownerId,
        input.storeId,
        attendance.id,
        {
          conflictEmployeeUserId: input.employeeUserId,
          conflictEmployeeName: affectedEmployeeName,
          updatedBy: input.actorUserId,
          updatedByUserId: input.actorUserId,
          updatedByRole: attendanceActorRole,
        },
        attendance,
      );
      continue;
    }
    affectedDates.add(attendance.workDate);
    if (attendance.bookingId) affectedBookingIds.add(attendance.bookingId);
    await firestoreRepository.shop.attendance.updateShopAttendance(input.ownerId, input.storeId, attendance.id, {
      bookingStatus: "processing",
      conflictEmployeeUserId: input.employeeUserId,
      conflictEmployeeName: affectedEmployeeName,
      updatedBy: input.actorUserId,
      updatedByUserId: input.actorUserId,
      updatedByRole: attendanceActorRole,
    }, attendance);
    manual += 1;
  }

  for (const bookingId of affectedBookingIds) {
    const grouped = await firestoreAuth.collection("stores").doc(input.storeId).collection("attendances").where("bookingId", "==", bookingId).get();
    const bookingStatus = grouped.docs.every((document) => document.data()["bookingStatus"] === "confirmed") ? "confirmed" : "processing";
    await firestoreAuth.collection("stores").doc(input.storeId).collection("bookings").doc(bookingId).update({
      bookingStatus, updatedAt: Date.now(), updatedById: input.actorUserId, updatedByRole: input.actorRole,
    });
  }
  for (const workDate of affectedDates) await synchronizeWorkDaySettlement(input.ownerId, input.storeId, workDate);
  return { reassigned: 0, manual };
};
