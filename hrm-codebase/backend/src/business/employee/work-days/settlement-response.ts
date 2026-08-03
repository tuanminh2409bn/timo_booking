import type { UserType } from "../../../repository/firestore/user/user.types.js";
import {
  getResponsibleEmployeeUserId,
  getResponsibleEmployeeUserIds,
  isSettlementAttendance,
  isWorkDayClosingEffective,
  type buildWorkDaySettlementPreview,
} from "../../../helpers/work-day-settlement.js";
import type {
  ShopAttendanceAssigneeType,
  ShopAttendanceType,
  ShopDiscountOwnerCoverageRateType,
  ShopWorkDaySettlementClosingType,
  ShopWorkDaySettlementType,
} from "../../../repository/firestore/shop/shop.types.js";

type SettlementAttendance = ShopAttendanceType & {
  customerName?: string;
};

type SettlementPreview = ReturnType<typeof buildWorkDaySettlementPreview>;

const DEFAULT_EMPLOYEE_DISPLAY_NAME = "Nhân viên";

const getNamedEmployee = (
  employee: Pick<UserType, "uid" | "name" | "displayName">,
): string | undefined => {
  const employeeName = employee.name?.trim();
  if (employeeName && employeeName !== employee.uid) {
    return employeeName;
  }

  const employeeDisplayName = employee.displayName?.trim();
  if (employeeDisplayName && employeeDisplayName !== employee.uid) {
    return employeeDisplayName;
  }

  return undefined;
};

const getAttendanceEmployeeName = (
  employee: Pick<ShopAttendanceAssigneeType, "employeeUserId" | "employeeName">,
): string | undefined => {
  const employeeName = employee.employeeName?.trim();
  return employeeName && employeeName !== employee.employeeUserId ? employeeName : undefined;
};

export const toSettlementAttendanceItem = (attendance: SettlementAttendance) => {
  const responsibleEmployeeUserId = getResponsibleEmployeeUserId(attendance);

  return {
    id: attendance.id,
    ...(attendance.attendanceCode !== undefined && {
      attendanceCode: attendance.attendanceCode,
    }),
    startTime: attendance.startTime,
    endTime: attendance.endTime,
    ...(attendance.customerName !== undefined && { customerName: attendance.customerName }),
    status: attendance.status,
    ...(responsibleEmployeeUserId !== undefined && { responsibleEmployeeUserId }),
    services: attendance.services.map((service) => ({
      name: service.name,
      employees: (service.employees ?? []).map((employee) => {
        const employeeName = getAttendanceEmployeeName(employee);
        return {
          employeeUserId: employee.employeeUserId,
          ...(employeeName !== undefined && { employeeName }),
        };
      }),
    })),
  };
};

export const toSettlementClosingSummary = (
  closing: ShopWorkDaySettlementClosingType | null | undefined,
) =>
  closing
    ? {
        id: closing.id,
        closedAt: closing.closedAt,
        ...(closing.storeTimezone !== undefined && { storeTimezone: closing.storeTimezone }),
        ownerDiscountCoverageRate: closing.ownerDiscountCoverageRate,
        discountAllocationMethod: closing.discountAllocationMethod,
      }
    : null;

export const toClosedWorkDaySettlementResponse = (
  settlement: ShopWorkDaySettlementType,
) => {
  const closing = settlement.closing;

  if (!closing) {
    return null;
  }

  return {
    id: closing.id,
    storeId: settlement.storeId,
    workDate: settlement.workDate,
    ...(closing.storeTimezone !== undefined && { storeTimezone: closing.storeTimezone }),
    closedAt: closing.closedAt,
    closedByUserId: closing.closedByUserId,
    ownerDiscountCoverageRate: closing.ownerDiscountCoverageRate,
    discountAllocationMethod: closing.discountAllocationMethod,
    employeeSummaries: settlement.preview.employeeSummaries,
    serviceSummaries: settlement.serviceSummaries,
    summary: closing.summary,
    createdAt: closing.createdAt,
    updatedAt: closing.updatedAt,
  };
};

export const toStoredSettlementPreviewResponse = ({
  settlement,
  attendances,
  includeItems = true,
}: {
  settlement: ShopWorkDaySettlementType;
  attendances?: SettlementAttendance[];
  includeItems?: boolean;
}) => ({
  workDate: settlement.workDate,
  storeId: settlement.storeId,
  ...(settlement.closing?.storeTimezone !== undefined && {
    storeTimezone: settlement.closing.storeTimezone,
  }),
  items: includeItems
    ? (settlement.attendanceItems ??
      (attendances ?? []).filter(isSettlementAttendance).map(toSettlementAttendanceItem))
    : [],
  closing: settlement.closing
    ? {
        id: settlement.closing.id,
        closedAt: settlement.closing.closedAt,
        ...(settlement.closing.storeTimezone !== undefined && {
          storeTimezone: settlement.closing.storeTimezone,
        }),
        ownerDiscountCoverageRate: settlement.closing.ownerDiscountCoverageRate,
        discountAllocationMethod: settlement.closing.discountAllocationMethod,
      }
    : null,
  preview: {
    ownerDiscountCoverageRate: settlement.previewOwnerDiscountCoverageRate,
    discountAllocationMethod: "revenue_share" as const,
    ...settlement.preview,
  },
  pendingEmployees: settlement.pendingEmployees,
});

export const toSettlementPreviewResponse = ({
  workDate,
  storeId,
  attendances,
  employees,
  closing,
  preview,
  ownerDiscountCoverageRate,
}: {
  workDate: string;
  storeId: string;
  attendances: SettlementAttendance[];
  employees: Array<Pick<UserType, "uid" | "name" | "displayName">>;
  closing?: ShopWorkDaySettlementClosingType | null;
  preview: SettlementPreview;
  ownerDiscountCoverageRate: ShopDiscountOwnerCoverageRateType;
}) => {
  const submittedEmployeeUserIds = new Set(preview.submittedEmployeeUserIds);
  const settlementAttendances = attendances.filter(isSettlementAttendance);
  const responsibleEmployeeUserIds = getResponsibleEmployeeUserIds(settlementAttendances);
  const effectiveClosing = isWorkDayClosingEffective(closing, {
    total: responsibleEmployeeUserIds.length,
    closed: submittedEmployeeUserIds.size,
  })
    ? closing
    : null;
  const pendingEmployeeUserIds = effectiveClosing
    ? []
    : responsibleEmployeeUserIds.filter(
        (employeeUserId) => !submittedEmployeeUserIds.has(employeeUserId),
      );
  const employeeNamesById = new Map<string, string>();
  const setEmployeeName = (employeeUserId: string, employeeName: string | undefined) => {
    if (employeeName !== undefined && !employeeNamesById.has(employeeUserId)) {
      employeeNamesById.set(employeeUserId, employeeName);
    }
  };

  employees.forEach((employee) => {
    setEmployeeName(employee.uid, getNamedEmployee(employee));
  });

  settlementAttendances.forEach((attendance) => {
    attendance.assignees.forEach((employee) => {
      setEmployeeName(employee.employeeUserId, getAttendanceEmployeeName(employee));
    });
    attendance.services.forEach((service) => {
      (service.employees ?? []).forEach((employee) => {
        setEmployeeName(employee.employeeUserId, getAttendanceEmployeeName(employee));
      });
    });
  });

  preview.employeeSummaries.forEach((employee) => {
    const employeeName = employee.employeeName?.trim();
    if (employeeName && employeeName !== employee.employeeUserId) {
      setEmployeeName(employee.employeeUserId, employeeName);
    }
  });

  const employeeOptionsById = new Map(
    employees.map((employee) => [
      employee.uid,
      {
        id: employee.uid,
        name: employeeNamesById.get(employee.uid) ?? DEFAULT_EMPLOYEE_DISPLAY_NAME,
      },
    ]),
  );

  preview.employeeSummaries.forEach((employee) => {
    if (!employeeOptionsById.has(employee.employeeUserId)) {
      employeeOptionsById.set(employee.employeeUserId, {
        id: employee.employeeUserId,
        name:
          employeeNamesById.get(employee.employeeUserId) ?? DEFAULT_EMPLOYEE_DISPLAY_NAME,
      });
    }
  });

  const employeeSummaries = preview.employeeSummaries.map((employee) => ({
    ...employee,
    employeeName:
      employeeNamesById.get(employee.employeeUserId) ?? DEFAULT_EMPLOYEE_DISPLAY_NAME,
  }));

  return {
    workDate,
    storeId,
    ...(effectiveClosing?.storeTimezone !== undefined && {
      storeTimezone: effectiveClosing.storeTimezone,
    }),
    items: settlementAttendances.map(toSettlementAttendanceItem),
    closing: toSettlementClosingSummary(effectiveClosing),
    preview: {
      ownerDiscountCoverageRate,
      discountAllocationMethod: "revenue_share" as const,
      ...preview,
      employeeSummaries,
    },
    pendingEmployees: pendingEmployeeUserIds.map(
      (employeeUserId) =>
        employeeOptionsById.get(employeeUserId) ?? {
          id: employeeUserId,
          name: DEFAULT_EMPLOYEE_DISPLAY_NAME,
        },
    ),
  };
};
