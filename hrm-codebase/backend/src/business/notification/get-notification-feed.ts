import { performance } from "node:perf_hooks";
import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { createErrorResponse } from "../../modules/create-error-response.js";
import { sendCacheableJson } from "../../modules/send-cacheable-json.js";
import { ServerTiming } from "../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import { isEmployeeRole } from "../../helpers/user-roles.js";
import { logger } from "../../modules/logger.js";
import { buildAttendanceReminderNotifications } from "./attendance-reminders.js";
import {
  canSeeAuditNotification,
  mapAuditLogToNotification,
  type AppNotification,
} from "./audit-notifications.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;
// Employee chỉ thấy một phần audit log (lọc theo quyền sau khi đọc),
// nên đọc dư để feed không bị hụt item sau khi lọc.
const EMPLOYEE_AUDIT_OVERSCAN_FACTOR = 3;
const EMPLOYEE_AUDIT_MAX_LIMIT = 200;

const NOTIFICATION_FEED_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/notifications/invalid-request",
    message: "Invalid notification feed request",
  },
};

// limit ngoài khoảng [1, MAX_LIMIT] được kẹp về biên (contract đã có với FE);
// giá trị không phải số nguyên bị từ chối thay vì âm thầm dùng mặc định.
const notificationFeedQuerySchema = z.object({
  limit: z.coerce.number().int().optional(),
});

export const getNotificationFeed = async (req: Request, res: Response) => {
  const timing = new ServerTiming();
  const requestStartedAt = performance.now();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(req.headers["authorization"]),
  );
  const queryParseResult = notificationFeedQuerySchema.safeParse(req.query);

  if (!queryParseResult.success) {
    return createErrorResponse(res, NOTIFICATION_FEED_ERRORS.invalidRequest, {
      validation: queryParseResult.error.flatten().fieldErrors,
    });
  }

  const limit = Math.min(Math.max(queryParseResult.data.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const auditLimit = isEmployeeRole(authContext.role)
    ? Math.min(limit * EMPLOYEE_AUDIT_OVERSCAN_FACTOR, EMPLOYEE_AUDIT_MAX_LIMIT)
    : limit;

  // Degrade gracefully: một nguồn lỗi (vd Firestore index đang build)
  // không được 500 cả feed — trả phần nguồn còn lại đọc được.
  const [auditResult, reminderResult] = await timing.measure("firestore", () =>
    Promise.allSettled([
      firestoreRepository.shop.audit.listShopAuditLogs(authContext.ownerId, auditLimit),
      buildAttendanceReminderNotifications(authContext),
    ]),
  );

  if (auditResult.status === "rejected") {
    logger.warn(
      {
        event: "notification.audit_source_failed",
        errorSource: "firestore",
        ownerId: authContext.ownerId,
        errorName: auditResult.reason instanceof Error ? auditResult.reason.name : "UnknownError",
        errorMessage:
          auditResult.reason instanceof Error
            ? auditResult.reason.message
            : String(auditResult.reason),
      },
      "notification audit source failed",
    );
  }

  if (reminderResult.status === "rejected") {
    logger.warn(
      {
        event: "notification.reminder_source_failed",
        errorSource: "firestore",
        ownerId: authContext.ownerId,
        errorName:
          reminderResult.reason instanceof Error ? reminderResult.reason.name : "UnknownError",
        errorMessage:
          reminderResult.reason instanceof Error
            ? reminderResult.reason.message
            : String(reminderResult.reason),
      },
      "notification attendance-reminder source failed",
    );
  }

  const auditLogs = auditResult.status === "fulfilled" ? auditResult.value : [];
  const attendanceReminders = reminderResult.status === "fulfilled" ? reminderResult.value : [];
  const auditNotifications = auditLogs
    .filter((auditLog) => canSeeAuditNotification(authContext, auditLog))
    .map((auditLog) => mapAuditLogToNotification(auditLog, authContext))
    .filter((notification): notification is AppNotification => notification !== null);
  const notifications = [...attendanceReminders, ...auditNotifications]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit);

  // Theo dõi hiệu quả overscan cho employee: nếu tỉ lệ bị lọc thường xuyên
  // vượt 2/3 (hệ số overscan), feed sẽ hụt item — cần nâng hệ số hoặc đổi cách query.
  res.locals["notificationFeedStats"] = {
    auditReadCount: auditLogs.length,
    auditVisibleCount: auditNotifications.length,
  };

  timing.add("total", performance.now() - requestStartedAt);
  res.setHeader("Server-Timing", timing.header());
  res.locals["serverTiming"] = timing.toObject();

  return sendCacheableJson(
    req,
    res,
    {
      notifications,
      meta: {
        limit,
        returnedCount: notifications.length,
        latestCreatedAt: notifications[0]?.createdAt ?? 0,
      },
    },
    {
      cacheControl: "private, max-age=15, stale-while-revalidate=30",
    },
  );
};
