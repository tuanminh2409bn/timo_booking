import type { ShopAttendanceAssigneeType } from "../../../repository/firestore/shop/shop.types.js";
import type {
  ShopEmployeeListItem,
  ShopEmployeePresentationItem,
} from "../../../repository/firestore/user/user-factory.js";
import type { NormalizedAttendanceAssigneeInput } from "./attendance-payload.js";

export const applyAttendanceAssigneeRoles = <
  T extends { employeeUserId: string; workerType?: "main" | "assistant" },
>(
  assignees: T[],
  mainAssigneeUserId: string | undefined,
  assistantAssigneeUserId: string | undefined,
): T[] =>
  assignees.map((assignee) => {
    const workerType =
      assignee.employeeUserId === mainAssigneeUserId
        ? "main"
        : assignee.employeeUserId === assistantAssigneeUserId
          ? "assistant"
          : assignee.workerType;

    return workerType === undefined ? assignee : { ...assignee, workerType };
  });

export const filterActiveEmployeesByStore = (
  employees: ShopEmployeePresentationItem[],
  storeId: string,
) => employees.filter((employee) => employee.storeId === storeId);

// Đối chiếu assignee client gửi lên với nhân viên đang làm ở store; không tìm thấy → undefined
// để caller biết mà từ chối request.
export const resolveAttendanceAssigneeInputs = (
  assignees: NormalizedAttendanceAssigneeInput[],
  employees: ShopEmployeePresentationItem[],
) => {
  const employeeMap = new Map(employees.map((employee) => [employee.uid, employee]));

  return assignees.map((assignee) => {
    const employee = employeeMap.get(assignee.employeeUserId);

    if (!employee) {
      return undefined;
    }

    return {
      ...assignee,
      employeeName: employee.name,
    };
  });
};

// Chấm công không có service nào thì không chia tiền theo service được — giữ danh sách thợ
// từ payload với shareAmount 0; chỉ có 1 thợ thì mặc định người đó ăn 100%.
export const buildAssigneesWithoutServiceShares = (
  assigneeInputs: NormalizedAttendanceAssigneeInput[],
  activeEmployeesInStoreByUid: ReadonlyMap<string, { name?: string }>,
): ShopAttendanceAssigneeType[] =>
  assigneeInputs.map((assignee) => {
    let resolvedEmployeeName = activeEmployeesInStoreByUid.get(assignee.employeeUserId)?.name;

    if (resolvedEmployeeName === undefined) {
      resolvedEmployeeName = assignee.employeeName;
    }

    let percentage = assignee.percentage;

    if (percentage === undefined && assigneeInputs.length === 1) {
      percentage = 100;
    }

    const assigneeWithoutServiceShare: ShopAttendanceAssigneeType = {
      employeeUserId: assignee.employeeUserId,
      shareAmount: 0,
      ...(assignee.workerType !== undefined && { workerType: assignee.workerType }),
    };

    if (resolvedEmployeeName !== undefined) {
      assigneeWithoutServiceShare.employeeName = resolvedEmployeeName;
    }

    if (percentage !== undefined) {
      assigneeWithoutServiceShare.percentage = percentage;
    }

    return assigneeWithoutServiceShare;
  });

// Tên hiển thị của thợ trên chấm công: ưu tiên name → displayName → email → uid (luôn có giá trị).
// Lưu ý: KHÁC `resolveEmployeeName` trong user-factory (bản đó fallback về local-part của email).
const resolveEmployeeNameForAttendance = (employee: ShopEmployeeListItem): string => {
  const trimmedName = employee.name?.trim();

  if (trimmedName) {
    return trimmedName;
  }

  const trimmedDisplayName = employee.displayName?.trim();

  if (trimmedDisplayName) {
    return trimmedDisplayName;
  }

  if (employee.email) {
    return employee.email;
  }

  return employee.uid;
};

// Nhãn chọn thợ trên form: như tên hiển thị nhưng dừng ở email (không rơi xuống uid).
const resolveEmployeeLabelForAttendance = (employee: ShopEmployeeListItem): string => {
  const trimmedName = employee.name?.trim();

  if (trimmedName) {
    return trimmedName;
  }

  const trimmedDisplayName = employee.displayName?.trim();

  if (trimmedDisplayName) {
    return trimmedDisplayName;
  }

  return employee.email;
};

// Chuyển nhân viên đọc từ DB sang dạng dùng để tính hoa hồng/chia tiền trên chấm công.
export const toEmployeePresentationItem = (
  employee: ShopEmployeeListItem,
): ShopEmployeePresentationItem => {
  const compensationModel =
    employee.compensationModel ?? (employee.hourlyRate !== undefined ? "hourly" : "commission");
  const presentationItem: ShopEmployeePresentationItem = {
    uid: employee.uid,
    email: employee.email,
    role: employee.role,
    active: employee.active,
    ownerId: employee.ownerId,
    storeId: employee.storeId,
    name: resolveEmployeeNameForAttendance(employee),
    label: resolveEmployeeLabelForAttendance(employee),
    compensationModel,
  };

  if (compensationModel === "commission") {
    presentationItem.ownerCommissionRate = employee.ownerCommissionRate ?? 50;
  }

  if (compensationModel === "fixed" && employee.fixedSalary !== undefined) {
    presentationItem.fixedSalary = employee.fixedSalary;
  }

  if (compensationModel === "hourly" && employee.hourlyRate !== undefined) {
    presentationItem.hourlyRate = employee.hourlyRate;
  }

  return presentationItem;
};

// Gắn tên thợ (lấy từ danh sách nhân viên đang làm ở store) vào từng người được gán cho 1 service.
// Tên lưu kèm để lịch sử chấm công đọc lại được kể cả khi nhân viên đã nghỉ/đổi tên.
export const attachEmployeeNamesToServiceAssignees = (
  serviceAssignees: ShopAttendanceAssigneeType[],
  activeEmployeesInStoreByUid: ReadonlyMap<string, { name?: string }>,
): ShopAttendanceAssigneeType[] =>
  serviceAssignees.map((assignee) => {
    const resolvedEmployeeName = activeEmployeesInStoreByUid.get(assignee.employeeUserId)?.name;
    const assigneeWithName: ShopAttendanceAssigneeType = {
      employeeUserId: assignee.employeeUserId,
    };

    if (assignee.workerType !== undefined) {
      assigneeWithName.workerType = assignee.workerType;
    }

    if (resolvedEmployeeName !== undefined) {
      assigneeWithName.employeeName = resolvedEmployeeName;
    }

    if (assignee.percentage !== undefined) {
      assigneeWithName.percentage = assignee.percentage;
    }

    if (assignee.shareAmount !== undefined) {
      assigneeWithName.shareAmount = assignee.shareAmount;
    }

    return assigneeWithName;
  });
