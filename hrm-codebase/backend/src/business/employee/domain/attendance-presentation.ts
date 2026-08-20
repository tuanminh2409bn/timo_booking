import {
  DEFAULT_BOOKING_STATUS,
  type ShopAttendanceAssigneeType,
  type ShopAttendanceType,
} from "../../../repository/firestore/shop/shop.types.js";
import {
  normalizeSettlementCutoffTime,
  resolveAttendanceCalendarWorkDate,
} from "../../../helpers/business-day.js";
import { buildAttendanceAssignees, mergeAttendanceAssignees } from "./attendance-money.js";
import { DEFAULT_MONEY_CURRENCY, roundMoney, sumMoney } from "../../../helpers/money.js";
import { resolveStoredAttendanceSource } from "./attendance-origin.js";

const roundCurrency = roundMoney;

const toDateTimeIso = (calendarDate: string, timeValue: number): string => {
  const hours = Math.floor(timeValue / 60);
  const minutes = timeValue % 60;
  const isoDate = `${calendarDate}T${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:00.000`;
  return isoDate;
};

const normalizeServiceEmployees = (
  service: Pick<ShopAttendanceType["services"][number], "employees" | "price">,
  employees: ShopAttendanceAssigneeType[],
) => {
  if (employees.length === 0) {
    return [];
  }

  const hasExplicitPercentages = employees.some((employee) => employee.percentage !== undefined);

  if (!hasExplicitPercentages) {
    return employees;
  }

  return buildAttendanceAssignees(
    employees.map((employee) => ({
      employeeUserId: employee.employeeUserId,
      ...(employee.employeeName !== undefined && { employeeName: employee.employeeName }),
      ...(employee.workerType !== undefined && { workerType: employee.workerType }),
      ...(employee.percentage !== undefined && { percentage: employee.percentage }),
    })),
    service.price,
  );
};

export const normalizeAttendanceForResponse = (attendance: ShopAttendanceType) => {
  const normalizedStatus =
    attendance.status ?? (attendance.closedAt !== undefined ? "closed" : "open");
  const mainAssigneeUserId = attendance.mainAssigneeUserId ?? attendance.employeeUserId;
  const assistantAssigneeUserId = attendance.assistantAssigneeUserId;
  const fallbackAssignees = attendance.assignees ?? [];
  const normalizedServices = attendance.services.map((service) => ({
    ...service,
    employees: normalizeServiceEmployees(
      service,
      service.employees?.length ? service.employees : fallbackAssignees,
    ).map((employee) => ({
      ...employee,
      ...(employee.employeeUserId === mainAssigneeUserId && { workerType: "main" as const }),
      ...(employee.employeeUserId === assistantAssigneeUserId && {
        workerType: "assistant" as const,
      }),
    })),
  }));
  const normalizedAssignees = mergeAttendanceAssignees(
    normalizedServices.map((service) => ({
      employees: service.employees,
      price: service.price,
    })),
    attendance.subtotalAmount,
  );
  const effectiveAssignees =
    normalizedServices.length > 0 ? normalizedAssignees : fallbackAssignees;

  return {
    ...attendance,
    ...(mainAssigneeUserId !== undefined && { mainAssigneeUserId }),
    ...(assistantAssigneeUserId !== undefined && { assistantAssigneeUserId }),
    source: resolveStoredAttendanceSource(attendance),
    status: normalizedStatus,
    assignees: effectiveAssignees.map((assignee) => ({
      ...assignee,
      ...(assignee.employeeUserId === mainAssigneeUserId && { workerType: "main" as const }),
      ...(assignee.employeeUserId === assistantAssigneeUserId && {
        workerType: "assistant" as const,
      }),
    })),
    services: normalizedServices,
  };
};

// customerName/customerPhone bị ẩn với employee — chỉ manager/owner mới xem được thông tin khách.
export const toFrontendAttendanceItem = (
  attendance: ShopAttendanceType,
  options?: { redactCustomerInfo?: boolean },
) => {
  const redactCustomerInfo = options?.redactCustomerInfo ?? false;
  const normalizedAttendance = normalizeAttendanceForResponse(attendance);
  const calendarDate = resolveAttendanceCalendarWorkDate(
    normalizedAttendance.workDate,
    normalizedAttendance.startTime,
    normalizedAttendance.settlementCutoffTime,
  );
  const createdAtIso = toDateTimeIso(calendarDate, normalizedAttendance.startTime);
  const endDateIso = toDateTimeIso(calendarDate, normalizedAttendance.endTime);
  const attendanceDiscountAmount =
    normalizedAttendance.discount?.amount ??
    sumMoney(normalizedAttendance.services.map((service) => service.discountAmount ?? 0));
  const responsibleEmployeeUserId =
    normalizedAttendance.mainAssigneeUserId ??
    normalizedAttendance.assignees.find((employee) => employee.workerType === "main")
      ?.employeeUserId ??
    normalizedAttendance.assignees[0]?.employeeUserId ??
    normalizedAttendance.services
      .flatMap((service) => service.employees ?? [])
      .find((employee) => employee.employeeUserId)?.employeeUserId;

  return {
    id: normalizedAttendance.id,
    ...(normalizedAttendance.bookingId !== undefined && {
      bookingId: normalizedAttendance.bookingId,
    }),
    ...(normalizedAttendance.mainAssigneeUserId !== undefined && {
      mainAssigneeUserId: normalizedAttendance.mainAssigneeUserId,
    }),
    ...(normalizedAttendance.assistantAssigneeUserId !== undefined && {
      assistantAssigneeUserId: normalizedAttendance.assistantAssigneeUserId,
    }),
    ...(normalizedAttendance.attendanceCode !== undefined && {
      attendanceCode: normalizedAttendance.attendanceCode,
    }),
    date: createdAtIso,
    createdAt: createdAtIso,
    endDate: endDateIso,
    ...(normalizedAttendance.startTimestamp !== undefined && {
      startTimestamp: normalizedAttendance.startTimestamp,
    }),
    ...(normalizedAttendance.endTimestamp !== undefined && {
      endTimestamp: normalizedAttendance.endTimestamp,
    }),
    customerName: redactCustomerInfo ? "" : (normalizedAttendance.customerName ?? ""),
    customerPhone: redactCustomerInfo ? "" : (normalizedAttendance.customerPhone ?? ""),
    ...(!redactCustomerInfo && normalizedAttendance.customerId !== undefined && {
      customerId: normalizedAttendance.customerId,
    }),
    ...(normalizedAttendance.source !== undefined && { source: normalizedAttendance.source }),
    ...(normalizedAttendance.note !== undefined && { note: normalizedAttendance.note }),
    ...(responsibleEmployeeUserId !== undefined && { responsibleEmployeeUserId }),
    currency: DEFAULT_MONEY_CURRENCY,
    services: normalizedAttendance.services.map((currentService) => {
      // durationMin/Max luôn là số; nếu service không có thì suy từ khung giờ (min == max = 1 giá trị).
      const fallbackDurationMinutes = Math.max(
        normalizedAttendance.endTime - normalizedAttendance.startTime,
        1,
      );
      const servicePrice = roundCurrency(currentService.price);
      // Legacy predefined attendances stored the catalog id directly in `id`.
      // Keep that fallback so a later catalog rename is reflected for old and new bookings.
      const sourceServiceId = currentService.sourceServiceId
        ?? (currentService.type === "predefined" ? currentService.id : undefined);

      return {
        id: currentService.id,
        type: currentService.type,
        ...(sourceServiceId !== undefined && {
          sourceServiceId,
        }),
        name: currentService.name,
        durationMin: currentService.durationMin ?? fallbackDurationMinutes,
        durationMax:
          currentService.durationMax ?? currentService.durationMin ?? fallbackDurationMinutes,
        price: servicePrice,
        amount: servicePrice,
        discountAmount: currentService.discountAmount ?? 0,
        employees: (currentService.employees ?? []).map((employee) => ({
          employeeId: employee.employeeUserId,
          employeeName: employee.employeeName ?? employee.employeeUserId,
          percentage: employee.percentage ?? 0,
          shareAmount: employee.shareAmount ?? 0,
          ...(employee.workerType !== undefined && { workerType: employee.workerType }),
        })),
      };
    }),
    totalAmount: normalizedAttendance.totalAmount,
    subtotalAmount: normalizedAttendance.subtotalAmount,
    ...(attendanceDiscountAmount > 0 && { discountAmount: attendanceDiscountAmount }),
    status: normalizedAttendance.status,
    bookingStatus: normalizedAttendance.bookingStatus ?? DEFAULT_BOOKING_STATUS,
    ...(normalizedAttendance.originatedAsRequest !== undefined && {
      originatedAsRequest: normalizedAttendance.originatedAsRequest,
    }),
    createdBy: normalizedAttendance.createdBy,
    ...(normalizedAttendance.createdByType !== undefined && {
      createdByType: normalizedAttendance.createdByType,
    }),
    ...(normalizedAttendance.createdByUserId !== undefined && {
      createdByUserId: normalizedAttendance.createdByUserId,
    }),
    ...(normalizedAttendance.createdByRole !== undefined && {
      createdByRole: normalizedAttendance.createdByRole,
    }),
    ...(normalizedAttendance.updatedByUserId !== undefined && {
      updatedByUserId: normalizedAttendance.updatedByUserId,
    }),
    ...(normalizedAttendance.updatedByRole !== undefined && {
      updatedByRole: normalizedAttendance.updatedByRole,
    }),
    ...(normalizedAttendance.updatedByName !== undefined && {
      updatedByName: normalizedAttendance.updatedByName,
    }),
    ...(normalizedAttendance.updatedAt !== undefined && {
      updatedAt: normalizedAttendance.updatedAt,
    }),
    ...(normalizedAttendance.bookingSource !== undefined && {
      bookingSource: normalizedAttendance.bookingSource,
    }),
    ...(normalizedAttendance.staffSelectionType !== undefined && {
      staffSelectionType: normalizedAttendance.staffSelectionType,
    }),
    ...(normalizedAttendance.requestedEmployeeUserId !== undefined && {
      requestedEmployeeUserId: normalizedAttendance.requestedEmployeeUserId,
    }),
    ...(normalizedAttendance.requestedEmployeeName !== undefined && {
      requestedEmployeeName: normalizedAttendance.requestedEmployeeName,
    }),
    ...(normalizedAttendance.conflictEmployeeUserId !== undefined && {
      conflictEmployeeUserId: normalizedAttendance.conflictEmployeeUserId,
    }),
    ...(normalizedAttendance.conflictEmployeeName !== undefined && {
      conflictEmployeeName: normalizedAttendance.conflictEmployeeName,
    }),
    ...(normalizedAttendance.proposedAssigneeUserId !== undefined && {
      proposedAssigneeUserId: normalizedAttendance.proposedAssigneeUserId,
    }),
    ...(normalizedAttendance.proposedAssigneeName !== undefined && {
      proposedAssigneeName: normalizedAttendance.proposedAssigneeName,
    }),
    ...(normalizedAttendance.proposedAssigneeWorkerType !== undefined && {
      proposedAssigneeWorkerType: normalizedAttendance.proposedAssigneeWorkerType,
    }),
    storeId: normalizedAttendance.storeId,
    storeName: normalizedAttendance.storeName,
    workDate: normalizedAttendance.workDate,
    ...(normalizedAttendance.storeTimezone !== undefined && {
      storeTimezone: normalizedAttendance.storeTimezone,
    }),
    settlementCutoffTime: normalizeSettlementCutoffTime(normalizedAttendance.settlementCutoffTime),
    raw: {
      subtotalAmount: normalizedAttendance.subtotalAmount,
      discount: normalizedAttendance.discount,
    },
  };
};
