import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { isEmployee } from "../../../helpers/role-access.js";
import { canManageAttendance, isAttendanceMainAssignee } from "../domain/attendance-rules.js";
import { resolveStoredAttendanceSource } from "../domain/attendance-origin.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { synchronizeWorkDaySettlement } from "../work-days/work-day-settlement-sync.js";
import {
  addActiveAttendanceSpanEvent,
  setActiveAttendanceSpanAttributes,
  withAttendanceSpan,
} from "./attendance-observability.js";
import {
  ATTENDANCE_TRACE_CHILD_SPANS,
  ATTENDANCE_TRACE_EVENTS,
} from "./attendance-tracing-contract.js";

const SERVICE_ERRORS = {
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenAttendance: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/forbidden-attendance",
    message: "Forbidden: attendance access denied",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/attendances/invalid-request",
    message: "Invalid request",
  },
  workDayAlreadyClosed: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/attendances/work-day-already-closed",
    message: "The selected store work day has already been closed",
  },
};

export const deleteAttendance = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const attendanceId = req.params["attendanceId"];

  if (typeof attendanceId !== "string" || !attendanceId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "missing attendanceId",
    });
  }

  const storeIdFromUrl = getStoreIdFromUrlPath(req);

  if (!storeIdFromUrl) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "missing storeId",
    });
  }

  const attendance = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.attendanceLoad,
    { "app.store_id": storeIdFromUrl },
    () =>
      firestoreRepository.shop.attendance.getShopAttendance(
        authContext.ownerId,
        storeIdFromUrl,
        attendanceId,
      ),
  );

  // URL `:storeId` phải khớp store của attendance; quyền truy cập store do canManageAttendance lo bên dưới.
  if (storeIdFromUrl !== undefined && storeIdFromUrl !== attendance.storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      routeStoreId: storeIdFromUrl,
      attendanceStoreId: attendance.storeId,
    });
  }

  // Owner/manager: xoá mọi chấm công trong store truy cập được.
  // Employee: chỉ chấm công MÌNH TẠO (canManageAttendance lo), và chấm công đó phải đang "open".
  const employeeCanDelete =
    isEmployee(authContext.role) &&
    attendance.createdBy === authContext.uid &&
    isAttendanceMainAssignee(attendance, authContext.uid) &&
    attendance.createdByType !== "customer" &&
    resolveStoredAttendanceSource(attendance) !== "online_booking";

  const privilegedActorCanDelete =
    !isEmployee(authContext.role) && canManageAttendance(authContext, attendance);

  if (!privilegedActorCanDelete && !employeeCanDelete) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenAttendance, {
      attendanceId,
      role: authContext.role,
    });
  }

  const workDaySettlement = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.workDayCheck,
    {
      "app.store_id": attendance.storeId,
      "attendance.work_date": attendance.workDate,
    },
    () =>
      firestoreRepository.shop.settlement.getWorkDaySettlement(
        authContext.ownerId,
        attendance.storeId,
        attendance.workDate,
      ),
  );
  const workDayClosing =
    workDaySettlement?.status === "closed" ? workDaySettlement.closing : undefined;
  setActiveAttendanceSpanAttributes({
    "attendance.source": resolveStoredAttendanceSource(attendance),
    "attendance.work_date": attendance.workDate,
    "attendance.work_day_closed": workDayClosing !== undefined,
    "attendance.booking_status.before": attendance.bookingStatus,
    "attendance.record_status.before": attendance.status,
    "attendance.service_count": attendance.services.length,
    "attendance.main_assignee_present": attendance.mainAssigneeUserId !== undefined,
    "attendance.assistant_assignee_present": attendance.assistantAssigneeUserId !== undefined,
  });

  if (workDayClosing) {
    return createErrorResponse(res, SERVICE_ERRORS.workDayAlreadyClosed, {
      storeId: attendance.storeId,
      workDate: attendance.workDate,
    });
  }

  await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.persist,
    {
      "app.store_id": attendance.storeId,
      "attendance.persist_action": "delete",
    },
    () =>
      firestoreRepository.shop.attendance.deleteShopAttendance(
        authContext.ownerId,
        attendance.storeId,
        attendanceId,
        attendance,
      ),
  );
  addActiveAttendanceSpanEvent(ATTENDANCE_TRACE_EVENTS.writeCommitted, {
    "attendance.id": attendanceId,
    "attendance.persist_action": "delete",
  });

  await Promise.all([
    withAttendanceSpan(
      ATTENDANCE_TRACE_CHILD_SPANS.auditWrite,
      { "attendance.post_write_phase": "audit" },
      () =>
        writeShopAuditLog({
          ownerId: authContext.ownerId,
          eventType: "attendance_deleted",
          entityType: "attendance",
          entityId: attendanceId,
          storeId: attendance.storeId,
          workDate: attendance.workDate,
          actor: {
            uid: authContext.uid,
            role: authContext.role,
          },
          metadata: {
            customerName: attendance.customerName,
            subtotalAmount: attendance.subtotalAmount,
            totalAmount: attendance.totalAmount,
            status: attendance.status,
            createdBy: attendance.createdBy,
            assigneeEmployeeUserIds: (attendance.assignees ?? []).map(
              (assignee) => assignee.employeeUserId,
            ),
            deletedAttendanceSnapshot: {
              id: attendance.id,
              storeId: attendance.storeId,
              workDate: attendance.workDate,
              customerName: attendance.customerName,
              startTime: attendance.startTime,
              endTime: attendance.endTime,
              subtotalAmount: attendance.subtotalAmount,
              ...(attendance.discount !== undefined && { discount: attendance.discount }),
              totalAmount: attendance.totalAmount,
              status: attendance.status,
              assignees: attendance.assignees ?? [],
              services: attendance.services,
              createdAt: attendance.createdAt,
              updatedAt: attendance.updatedAt,
            },
          },
        }),
    ),
    withAttendanceSpan(
      ATTENDANCE_TRACE_CHILD_SPANS.settlementSync,
      {
        "app.store_id": attendance.storeId,
        "attendance.work_date": attendance.workDate,
        "attendance.post_write_phase": "settlement_sync",
      },
      () =>
        synchronizeWorkDaySettlement(authContext.ownerId, attendance.storeId, attendance.workDate),
    ),
  ]);

  return res.status(StatusCodes.OK).json({
    id: attendanceId,
    storeId: attendance.storeId,
    workDate: attendance.workDate,
    deleted: true,
  });
};
