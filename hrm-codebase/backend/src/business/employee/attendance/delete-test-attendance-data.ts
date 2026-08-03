import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { canAccessStore, isEmployee } from "../../../helpers/role-access.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { isAttendanceAssignedToUser } from "../domain/attendance-rules.js";
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
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/attendances/test-data/invalid-request",
    message: "Invalid test cleanup request",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/test-data/forbidden-store",
    message: "Forbidden: store access denied",
  },
};

export const deleteTestAttendanceData = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const storeId = getStoreIdFromUrlPath(req)?.trim();
  const workDate = typeof req.query["workDate"] === "string" ? req.query["workDate"] : undefined;

  if (!storeId || !workDate || !isValidWorkDate(workDate)) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      storeId,
      workDate,
    });
  }

  if (!canAccessStore(authContext, storeId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      storeId,
      role: authContext.role,
    });
  }

  const cleanupScope = isEmployee(authContext.role) ? "employee" : "store";
  const storedAttendances = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.bulkLoad,
    {
      "app.store_id": storeId,
      "attendance.work_date": workDate,
      "attendance.cleanup_scope": cleanupScope,
    },
    () =>
      firestoreRepository.shop.attendance.listShopAttendanceByStoreWorkDateKey(
        authContext.ownerId,
        storeId,
        workDate,
        { skipCache: true },
      ),
  );
  const scopedAttendances = isEmployee(authContext.role)
    ? storedAttendances.filter((attendance) =>
        isAttendanceAssignedToUser(attendance, authContext.uid),
      )
    : storedAttendances;

  const employeeWorkDayClosings = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.bulkLoad,
    {
      "app.store_id": storeId,
      "attendance.work_date": workDate,
      "attendance.cleanup_scope": cleanupScope,
    },
    () =>
      firestoreRepository.shop.session.listEmployeeWorkDayClosingsByStoreWorkDate(
        authContext.ownerId,
        storeId,
        workDate,
        { skipCache: true },
      ),
  );

  setActiveAttendanceSpanAttributes({
    "attendance.work_date": workDate,
    "attendance.cleanup_scope": cleanupScope,
    "attendance.matched_count": scopedAttendances.length,
  });

  await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.bulkDelete,
    {
      "app.store_id": storeId,
      "attendance.work_date": workDate,
      "attendance.cleanup_scope": cleanupScope,
      "attendance.matched_count": scopedAttendances.length,
      "attendance.persist_action": "bulk_delete",
      "attendance.post_write_phase": "delete_and_audit",
    },
    () =>
      Promise.all(
        scopedAttendances.map(async (attendance) => {
          await firestoreRepository.shop.attendance.deleteShopAttendance(
            authContext.ownerId,
            storeId,
            attendance.id,
            attendance,
          );
          await writeShopAuditLog({
            ownerId: authContext.ownerId,
            eventType: "attendance_deleted",
            entityType: "attendance",
            entityId: attendance.id,
            storeId,
            workDate,
            actor: {
              uid: authContext.uid,
              role: authContext.role,
            },
            metadata: {
              testCleanup: true,
              originalCreatedBy: attendance.createdBy,
            },
          });
        }),
      ),
  );
  if (scopedAttendances.length > 0) {
    addActiveAttendanceSpanEvent(ATTENDANCE_TRACE_EVENTS.writeCommitted, {
      "attendance.persist_action": "bulk_delete",
      "attendance.deleted_count": scopedAttendances.length,
    });
  }

  const closingsToDelete = isEmployee(authContext.role)
    ? employeeWorkDayClosings.filter((closing) => closing.employeeUserId === authContext.uid)
    : employeeWorkDayClosings;

  await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.bulkDelete,
    {
      "app.store_id": storeId,
      "attendance.work_date": workDate,
      "attendance.cleanup_scope": cleanupScope,
      "attendance.deleted_closing_count": closingsToDelete.length,
      "attendance.persist_action": "bulk_delete_closings",
    },
    () =>
      Promise.all(
        closingsToDelete.map((closing) =>
          firestoreRepository.shop.session.deleteEmployeeWorkDayClosing(
            authContext.ownerId,
            storeId,
            workDate,
            closing.employeeUserId,
          ),
        ),
      ),
  );
  if (closingsToDelete.length > 0) {
    addActiveAttendanceSpanEvent(ATTENDANCE_TRACE_EVENTS.writeCommitted, {
      "attendance.persist_action": "bulk_delete_closings",
      "attendance.deleted_closing_count": closingsToDelete.length,
    });
  }

  await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.settlementSync,
    {
      "app.store_id": storeId,
      "attendance.work_date": workDate,
      "attendance.post_write_phase": "settlement_sync",
    },
    () => synchronizeWorkDaySettlement(authContext.ownerId, storeId, workDate),
  );

  setActiveAttendanceSpanAttributes({
    "attendance.deleted_count": scopedAttendances.length,
    "attendance.deleted_closing_count": closingsToDelete.length,
  });

  return res.status(StatusCodes.OK).json({
    storeId,
    workDate,
    deletedCount: scopedAttendances.length,
    deletedClosingCount: closingsToDelete.length,
    scope: cleanupScope,
    ...(isEmployee(authContext.role) && { employeeUserId: authContext.uid }),
  });
};
