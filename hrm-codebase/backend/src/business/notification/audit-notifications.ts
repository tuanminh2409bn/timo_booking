import { canAccessStore, type AuthorizedAppContext } from "../../helpers/role-access.js";
import { isEmployeeRole } from "../../helpers/user-roles.js";
import type {
  ShopAuditLogEventType,
  ShopAuditLogType,
} from "../../repository/firestore/shop/shop.types.js";

export type AppNotificationType =
  | "system_update"
  | "security"
  | "attendance_reminder"
  | "attendance_update"
  | "employee_update"
  | "store_update"
  | "service_update"
  | "settlement_update";

export type AppNotificationSeverity = "info" | "success" | "warning" | "critical";

export type AppNotification = {
  id: string;
  type: AppNotificationType;
  title: string;
  message: string;
  severity: AppNotificationSeverity;
  createdAt: number;
  source: "audit" | "attendance";
  entityType?: string;
  entityId?: string;
  storeId?: string;
  workDate?: string;
  route?: string;
};

const AUDIT_EVENT_LABELS: Record<
  ShopAuditLogEventType,
  {
    type: AppNotificationType;
    severity: AppNotificationSeverity;
    title: string;
  }
> = {
  owner_data_retention_plan_changed: {
    type: "system_update",
    severity: "info",
    title: "Gói lưu trữ dữ liệu đã thay đổi",
  },
  owner_registered: {
    type: "system_update",
    severity: "success",
    title: "Tài khoản chủ đã được tạo",
  },
  account_deletion_requested: {
    type: "security",
    severity: "warning",
    title: "Đã ghi nhận yêu cầu xóa tài khoản",
  },
  password_reset_completed: {
    type: "security",
    severity: "warning",
    title: "Mật khẩu đã được cập nhật",
  },
  employee_created: {
    type: "employee_update",
    severity: "info",
    title: "Nhân viên mới đã được thêm",
  },
  employee_updated: {
    type: "employee_update",
    severity: "info",
    title: "Thông tin nhân viên đã cập nhật",
  },
  employee_status_changed: {
    type: "employee_update",
    severity: "warning",
    title: "Trạng thái làm việc của nhân viên đã thay đổi",
  },
  employee_leave_created: {
    type: "employee_update",
    severity: "info",
    title: "Đơn nghỉ phép đã được tạo",
  },
  employee_leave_deleted: {
    type: "employee_update",
    severity: "warning",
    title: "Đơn nghỉ phép đã được xoá",
  },
  attendance_created: {
    type: "attendance_update",
    severity: "info",
    title: "Chấm công mới đã được tạo",
  },
  attendance_updated: {
    type: "attendance_update",
    severity: "info",
    title: "Chấm công đã được cập nhật",
  },
  attendance_deleted: {
    type: "attendance_update",
    severity: "warning",
    title: "Chấm công đã được xoá",
  },
  attendance_closed: {
    type: "attendance_update",
    severity: "success",
    title: "Chấm công đã được chốt",
  },
  employee_work_day_closed: {
    type: "attendance_update",
    severity: "success",
    title: "Nhân viên đã chốt ngày",
  },
  employee_time_tracking_started: {
    type: "attendance_update",
    severity: "info",
    title: "Nhân viên đã vào ca",
  },
  employee_time_tracking_completed: {
    type: "attendance_update",
    severity: "success",
    title: "Nhân viên đã kết thúc ca",
  },
  expense_created: {
    type: "store_update",
    severity: "info",
    title: "Chi tiêu cửa hàng đã được thêm",
  },
  expense_updated: {
    type: "store_update",
    severity: "info",
    title: "Chi tiêu cửa hàng đã được cập nhật",
  },
  expense_deleted: {
    type: "store_update",
    severity: "warning",
    title: "Chi tiêu cửa hàng đã được xoá",
  },
  expense_receipt_uploaded: {
    type: "store_update",
    severity: "info",
    title: "Ảnh hóa đơn chi tiêu đã được tải lên",
  },
  workday_closed: {
    type: "settlement_update",
    severity: "success",
    title: "Đã chốt sổ cuối ngày",
  },
  store_created: {
    type: "store_update",
    severity: "success",
    title: "Cửa hàng mới đã được tạo",
  },
  store_updated: {
    type: "store_update",
    severity: "info",
    title: "Cửa hàng đã được cập nhật",
  },
  service_group_created: {
    type: "service_update",
    severity: "success",
    title: "Nhóm dịch vụ mới đã được tạo",
  },
  service_created: {
    type: "service_update",
    severity: "success",
    title: "Dịch vụ mới đã được thêm",
  },
  service_updated: {
    type: "service_update",
    severity: "info",
    title: "Dịch vụ đã được cập nhật",
  },
  service_deleted: {
    type: "service_update",
    severity: "warning",
    title: "Dịch vụ đã được xoá",
  },
};

const getStringMetadata = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const getNumberMetadata = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const getStringListMetadata = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
};

export const canSeeAuditNotification = (
  authContext: AuthorizedAppContext,
  auditLog: ShopAuditLogType,
) => {
  if (authContext.role === "owner") {
    return true;
  }

  if (auditLog.storeId && !canAccessStore(authContext, auditLog.storeId)) {
    return false;
  }

  if (auditLog.entityType === "security") {
    return auditLog.entityId === authContext.uid || auditLog.actorUserId === authContext.uid;
  }

  if (auditLog.entityType === "employee") {
    return auditLog.entityId === authContext.uid;
  }

  if (auditLog.entityType === "attendance") {
    const assigneeEmployeeUserIds = getStringListMetadata(
      auditLog.metadata,
      "assigneeEmployeeUserIds",
    );

    return (
      auditLog.actorUserId === authContext.uid || assigneeEmployeeUserIds.includes(authContext.uid)
    );
  }

  return auditLog.storeId === undefined || auditLog.storeId === authContext.storeId;
};

const getAuditRoute = (auditLog: ShopAuditLogType, authContext: AuthorizedAppContext) => {
  if (auditLog.eventType === "owner_data_retention_plan_changed") {
    return authContext.role === "owner" ? "/account/upgrade" : undefined;
  }

  if (auditLog.eventType === "attendance_deleted") {
    return isEmployeeRole(authContext.role) ? "/employee/check-ins" : "/check-in";
  }

  if (isEmployeeRole(authContext.role)) {
    switch (auditLog.entityType) {
      case "attendance":
        return auditLog.entityId ? `/employee/check-ins/${auditLog.entityId}` : undefined;
      case "security":
        return "/employee/profile/security";
      case "employee":
        return "/employee/profile/info";
      case "work_day":
        return "/employee/reports";
      default:
        return undefined;
    }
  }

  if (auditLog.entityType === "service" || auditLog.entityType === "service_group") {
    return "/services";
  }

  if (auditLog.entityType === "work_day") {
    return "/reports";
  }

  if (!auditLog.entityId) {
    return undefined;
  }

  switch (auditLog.entityType) {
    case "attendance":
      return `/attendance/${auditLog.entityId}`;
    case "employee":
      return `/employees/${auditLog.entityId}`;
    case "store":
      return `/account/store-system/${auditLog.entityId}`;
    default:
      return undefined;
  }
};

const buildAuditMessage = (auditLog: ShopAuditLogType) => {
  const employeeName =
    getStringMetadata(auditLog.metadata, "employeeName") ??
    getStringMetadata(auditLog.metadata, "name");
  const storeName = getStringMetadata(auditLog.metadata, "storeName");
  const name =
    getStringMetadata(auditLog.metadata, "name") ??
    getStringMetadata(auditLog.metadata, "customerName") ??
    storeName;
  const totalAmount = getNumberMetadata(auditLog.metadata, "totalAmount");
  const totalEntries = getNumberMetadata(auditLog.metadata, "totalEntries");

  if (auditLog.eventType === "attendance_created" && totalAmount !== undefined) {
    return storeName
      ? `Có lượt chấm công mới trị giá ${totalAmount.toLocaleString("vi-VN")} tại ${storeName}.`
      : `Có lượt chấm công mới trị giá ${totalAmount.toLocaleString("vi-VN")} tại cửa hàng.`;
  }

  if (auditLog.eventType === "workday_closed" && totalEntries !== undefined) {
    return `Ngày ${auditLog.workDate ?? "đã chọn"} đã chốt sổ với ${totalEntries} lượt chấm công.`;
  }

  if (auditLog.entityType === "employee") {
    const storeSuffix = storeName ? ` tại ${storeName}` : "";
    const employeeSuffix = employeeName ? ` "${employeeName}"` : "";

    return `Hồ sơ nhân viên${employeeSuffix} vừa được cập nhật${storeSuffix}.`;
  }

  if (name) {
    return `Hệ thống vừa ghi nhận cập nhật liên quan đến "${name}".`;
  }

  if (storeName) {
    return `Hệ thống vừa cập nhật dữ liệu tại ${storeName}.`;
  }

  return "Hệ thống vừa ghi nhận một cập nhật mới trong cửa hàng.";
};

// Trả null cho eventType chưa có label (document ghi bởi bản deploy mới hơn) —
// bỏ qua item đó thay vì làm vỡ cả feed.
export const mapAuditLogToNotification = (
  auditLog: ShopAuditLogType,
  authContext: AuthorizedAppContext,
): AppNotification | null => {
  const eventLabel = AUDIT_EVENT_LABELS[auditLog.eventType] as
    | (typeof AUDIT_EVENT_LABELS)[ShopAuditLogEventType]
    | undefined;

  if (eventLabel === undefined) {
    return null;
  }

  const route = getAuditRoute(auditLog, authContext);

  return {
    id: `audit:${auditLog.id}`,
    type: eventLabel.type,
    title: eventLabel.title,
    message: buildAuditMessage(auditLog),
    severity: eventLabel.severity,
    createdAt: auditLog.createdAt,
    source: "audit",
    entityType: auditLog.entityType,
    ...(auditLog.entityId !== undefined && { entityId: auditLog.entityId }),
    ...(auditLog.storeId !== undefined && { storeId: auditLog.storeId }),
    ...(auditLog.workDate !== undefined && { workDate: auditLog.workDate }),
    ...(route !== undefined && { route }),
  };
};
