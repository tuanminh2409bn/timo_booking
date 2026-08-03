import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import {
  normalizeAttendanceForResponse,
  toFrontendAttendanceItem,
} from "../domain/attendance-presentation.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import {
  canReadAttendance,
  getAttendanceAssigneeValidationError,
} from "../domain/attendance-rules.js";
import {
  setActiveAttendanceSpanAttributes,
  setAttendanceResponseCacheStatus,
} from "./attendance-observability.js";

const SERVICE_ERRORS = {
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
  inconsistentAssignees: {
    statusCode: StatusCodes.UNPROCESSABLE_ENTITY,
    type: "/stores/attendances/inconsistent-assignees",
    message: "Attendance assignees are inconsistent",
  },
};

export const getAttendanceDetail = async (req: Request, res: Response) => {
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

  let rawAttendanceFromDatabase: Awaited<
    ReturnType<typeof firestoreRepository.shop.attendance.getShopAttendance>
  >;

  try {
    rawAttendanceFromDatabase = await firestoreRepository.shop.attendance.getShopAttendance(
      authContext.ownerId,
      storeIdFromUrl,
      attendanceId,
    );
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_ERRORS.forbiddenAttendance, {
        attendanceId,
        routeStoreId: storeIdFromUrl,
      });
    }

    throw error;
  }

  // URL `:storeId` phải khớp store của attendance. Quyền truy cập store thật do canReadAttendance
  // (canAccessStore) lo bên dưới; đây chỉ là chốt nhất quán URL.
  if (storeIdFromUrl !== undefined && storeIdFromUrl !== rawAttendanceFromDatabase.storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenAttendance, {
      routeStoreId: storeIdFromUrl,
      attendanceStoreId: rawAttendanceFromDatabase.storeId,
    });
  }

  // Check quyền bằng rawAttendanceFromDatabase (đủ storeId/createdBy/assignees/services) để fail-fast.
  if (!canReadAttendance(authContext, rawAttendanceFromDatabase)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenAttendance, {
      attendanceId,
      role: authContext.role,
    });
  }

  // Validate lại data đã lưu: thợ phụ phải có thợ chính, mỗi service ≤ 2, main có mặt trong service.
  const assigneeValidationError = getAttendanceAssigneeValidationError(
    rawAttendanceFromDatabase.employeeUserId,
    rawAttendanceFromDatabase.services.map((service) =>
      (service.employees ?? []).map((employee) => employee.employeeUserId),
    ),
  );

  if (assigneeValidationError) {
    return createErrorResponse(res, SERVICE_ERRORS.inconsistentAssignees, {
      attendanceId,
      reason: assigneeValidationError,
    });
  }

  // Service chưa gán thợ thì để trống — không tự điền người tạo.
  const attendanceForResponse = normalizeAttendanceForResponse(rawAttendanceFromDatabase);
  setActiveAttendanceSpanAttributes({
    "attendance.returned_count": 1,
    "attendance.total_count": 1,
    "attendance.open_count": attendanceForResponse.status === "open" ? 1 : 0,
    "attendance.closed_count": attendanceForResponse.status === "closed" ? 1 : 0,
  });

  const response = sendCacheableJson(
    req,
    res,
    {
      item: toFrontendAttendanceItem(attendanceForResponse, {
        redactCustomerInfo: authContext.role === "employee",
      }),
      meta: {
        storeId: attendanceForResponse.storeId,
        workDate: attendanceForResponse.workDate,
      },
    },
    {
      cacheControl: "private, max-age=5, stale-while-revalidate=10",
    },
  );
  setAttendanceResponseCacheStatus(res);
  return response;
};
