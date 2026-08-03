import { canAccessStore, type AuthorizedAppContext } from "../../../helpers/role-access.js";
import type { ShopAttendanceType } from "../../../repository/firestore/shop/shop.types.js";

type AttendanceAuthContext = Pick<AuthorizedAppContext, "uid" | "role" | "storeId">;

// Thợ chỉ được ghi/sửa chấm công cho quá khứ trong vòng ngần này ngày (tính tới hôm nay theo giờ tiệm).
// Chủ/quản lý KHÔNG bị giới hạn. Cố ý hardcode — quy tắc nghiệp vụ, không phải cấu hình theo tiệm.
export const MAX_EMPLOYEE_PAST_ATTENDANCE_DAYS = 7;

export const isAttendanceCreator = (
  authContext: Pick<AuthorizedAppContext, "uid">,
  attendance: Pick<ShopAttendanceType, "createdBy">,
) => attendance.createdBy === authContext.uid;

// Đọc thẳng dữ liệu đã lưu: tính cả thợ chỉ có ở `assignees` top-level mà chưa gán vào service nào.
// ⚠️ TRÙNG Ý VỚI `isAttendanceAssignedToEmployee` (employee-portal-shared.ts) nhưng KẾT QUẢ KHÁC:
// bản kia normalize trước nên dựng lại `assignees` từ service và bỏ rơi trường hợp vừa nói.
// Chưa gộp vì đó là đổi phạm vi hiển thị của employee — xem docs/todo.md.
export const isAttendanceAssignedToUser = (
  attendance: Pick<
    ShopAttendanceType,
    "createdBy" | "employeeUserId" | "assigneeUserIds" | "assignees" | "services"
  >,
  employeeUserId: string,
) =>
  attendance.createdBy === employeeUserId ||
  attendance.employeeUserId === employeeUserId ||
  attendance.assigneeUserIds?.includes(employeeUserId) === true ||
  (attendance.assignees ?? []).some((assignee) => assignee.employeeUserId === employeeUserId) ||
  (attendance.services ?? []).some((service) =>
    service.employees?.some((employee) => employee.employeeUserId === employeeUserId),
  );

// Manager thấy/sửa mọi attendance trong store (như owner); employee chỉ thấy/sửa của chính mình.
export const canReadAttendance = (
  authContext: AttendanceAuthContext,
  attendance: Pick<
    ShopAttendanceType,
    | "storeId"
    | "createdBy"
    | "employeeUserId"
    | "assigneeUserIds"
    | "assignees"
    | "services"
  >,
) =>
  canAccessStore(authContext, attendance.storeId) &&
  (authContext.role !== "employee" || isAttendanceAssignedToUser(attendance, authContext.uid));

export const canManageAttendance = (
  authContext: AttendanceAuthContext,
  attendance: Pick<ShopAttendanceType, "storeId" | "createdBy">,
) =>
  canAccessStore(authContext, attendance.storeId) &&
  (authContext.role !== "employee" || isAttendanceCreator(authContext, attendance));

export type AttendanceAssigneeValidationError =
  | "main_assignee_required"
  | "service_exceeds_two_workers"
  | "main_assignee_missing_in_service"
  | "attendance_exceeds_one_assistant";

// Quy tắc gán thợ 1 chấm công:
// - main assignee (thợ chính) là bắt buộc nếu có bất kỳ thợ nào trong services.
// - mỗi service tối đa 2 người (main + 1 thợ làm cùng).
// - main phải có mặt trong mọi service có thợ.
export const getAttendanceAssigneeValidationError = (
  mainAssigneeUserId: string | undefined,
  serviceEmployeeUserIds: readonly (readonly string[])[],
): AttendanceAssigneeValidationError | undefined => {
  const anyServiceHasWorkers = serviceEmployeeUserIds.some((ids) => ids.length > 0);

  if (anyServiceHasWorkers && !mainAssigneeUserId) {
    return "main_assignee_required";
  }

  for (const ids of serviceEmployeeUserIds) {
    if (ids.length > 2) {
      return "service_exceeds_two_workers";
    }

    if (ids.length > 0 && mainAssigneeUserId !== undefined && !ids.includes(mainAssigneeUserId)) {
      return "main_assignee_missing_in_service";
    }
  }

  if (mainAssigneeUserId !== undefined) {
    const assistantIds = new Set(
      serviceEmployeeUserIds.flatMap((ids) =>
        ids.filter((employeeUserId) => employeeUserId !== mainAssigneeUserId),
      ),
    );

    if (assistantIds.size > 1) {
      return "attendance_exceeds_one_assistant";
    }
  }

  return undefined;
};

export const isAttendanceReadyForConfirmation = (
  attendance: Pick<ShopAttendanceType, "assignees" | "services"> & {
    employeeUserId?: string | undefined;
  },
): boolean => {
  const hasWorker =
    Boolean(attendance.employeeUserId?.trim()) ||
    attendance.assignees.some((assignee) => Boolean(assignee.employeeUserId?.trim()));

  return (
    hasWorker &&
    attendance.services.length > 0 &&
    attendance.services.every((service) => {
      const employees = service.employees ?? [];
      const totalPercentage = employees.reduce(
        (sum, employee) => sum + (employee.percentage ?? 0),
        0,
      );

      return (
        employees.length > 0 &&
        employees.every((employee) => Boolean(employee.employeeUserId?.trim())) &&
        Math.abs(totalPercentage - 100) < 0.01
      );
    })
  );
};

export const getAttendanceMainAssigneeUserId = (
  attendance: Pick<ShopAttendanceType, "employeeUserId" | "mainAssigneeUserId">,
) => attendance.mainAssigneeUserId?.trim() || attendance.employeeUserId?.trim();

export const getAttendanceAssistantAssigneeUserId = (
  attendance: Pick<ShopAttendanceType, "assistantAssigneeUserId" | "assignees" | "services">,
) => {
  const explicitAssistant = attendance.assistantAssigneeUserId?.trim();
  if (explicitAssistant) return explicitAssistant;

  const ids = new Set<string>();
  for (const assignee of attendance.assignees ?? []) {
    if (assignee.workerType === "assistant" && assignee.employeeUserId.trim()) {
      ids.add(assignee.employeeUserId.trim());
    }
  }
  for (const service of attendance.services ?? []) {
    for (const employee of service.employees ?? []) {
      if (employee.workerType === "assistant" && employee.employeeUserId.trim()) {
        ids.add(employee.employeeUserId.trim());
      }
    }
  }

  return ids.size === 1 ? Array.from(ids)[0] : undefined;
};

export const isAttendanceMainAssignee = (
  attendance: Pick<ShopAttendanceType, "employeeUserId" | "mainAssigneeUserId">,
  employeeUserId: string,
) => getAttendanceMainAssigneeUserId(attendance) === employeeUserId;

export const isAttendanceAssistantAssignee = (
  attendance: Pick<ShopAttendanceType, "assistantAssigneeUserId" | "assignees" | "services">,
  employeeUserId: string,
) => getAttendanceAssistantAssigneeUserId(attendance) === employeeUserId;

export const getDistinctAttendanceWorkerIds = (
  services: readonly (readonly { employeeUserId: string; workerType?: "main" | "assistant" }[])[],
) =>
  Array.from(
    new Set(
      services.flatMap((service) =>
        service.map((employee) => employee.employeeUserId.trim()).filter(Boolean),
      ),
    ),
  );
