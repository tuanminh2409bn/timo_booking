import {
  buildWorkDayServiceSummaries,
  buildWorkDaySettlementPreview,
  getResponsibleEmployeeUserIds,
  isSettlementAttendance,
} from "../../../helpers/work-day-settlement.js";
import { resolveSettlementEligibleAt } from "../../../helpers/business-day.js";
import { addMoney } from "../../../helpers/money.js";
import { createHash } from "node:crypto";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import type { WorkDaySettlementCommitObserver } from "../../../repository/firestore/shop/work-day-settlement-commit-observer.js";
import type {
  ShopDiscountOwnerCoverageRateType,
  ShopWorkDaySettlementPreviewType,
  ShopWorkDaySettlementType,
} from "../../../repository/firestore/shop/shop.types.js";
import { normalizeAttendanceForResponse } from "../domain/attendance-presentation.js";
import {
  buildWorkDaySettlementListItem,
} from "./settlement-list-response.js";
import { toSettlementAttendanceItem } from "./settlement-response.js";

const DEFAULT_OWNER_DISCOUNT_COVERAGE_RATE: ShopDiscountOwnerCoverageRateType = 50;
const DEFAULT_EMPLOYEE_NAME = "Nhân viên";

export const getWorkDaySettlementAttendanceVersion = (
  attendances: Array<{ id: string; updatedAt: number }>,
): string => {
  const versionSource = attendances
    .map((attendance) => `${attendance.id}:${attendance.updatedAt}`)
    .sort()
    .join("|");

  return createHash("sha256").update(versionSource).digest("hex");
};

export const synchronizeWorkDaySettlement = async (
  ownerId: string,
  storeId: string,
  workDate: string,
  options: {
    preserveClosedStatus?: boolean;
    onCommitted?: WorkDaySettlementCommitObserver;
  } = {},
): Promise<ShopWorkDaySettlementType | null> => {
  const [attendances, existingSettlement, employeeWorkDayClosings, storeEmployees] = await Promise.all([
    firestoreRepository.shop.attendance.listShopAttendanceByStoreDateRange(
      ownerId,
      storeId,
      workDate,
      workDate,
      { skipCache: true },
    ),
    firestoreRepository.shop.settlement.getWorkDaySettlement(ownerId, storeId, workDate),
    firestoreRepository.shop.session.listEmployeeWorkDayClosingsByStoreWorkDate(
      ownerId,
      storeId,
      workDate,
      { skipCache: true },
    ),
    firestoreRepository.user.listShopEmployees(ownerId, {
      storeId,
      skipCache: true,
    }),
  ]);
  const normalizedAttendances = attendances.map(normalizeAttendanceForResponse);
  const settlementAttendances = normalizedAttendances.filter(isSettlementAttendance);
  const closing =
    existingSettlement?.status === "closed" ? existingSettlement.closing : undefined;

  if (settlementAttendances.length === 0 && !closing) {
    await firestoreRepository.shop.settlement.deleteWorkDaySettlement(
      ownerId,
      storeId,
      workDate,
    );
    return null;
  }

  const ownerDiscountCoverageRate =
    closing?.ownerDiscountCoverageRate ?? DEFAULT_OWNER_DISCOUNT_COVERAGE_RATE;
  const settlementPreview = buildWorkDaySettlementPreview(normalizedAttendances, {
    ownerDiscountCoverageRate,
    employeeConfigs: storeEmployees.map((employee) => ({
      uid: employee.uid,
      name: employee.name ?? employee.displayName ?? employee.email,
      compensationModel: employee.compensationModel,
      ownerCommissionRate: employee.ownerCommissionRate,
      fixedSalary: employee.fixedSalary,
      hourlyRate: employee.hourlyRate,
    })),
    employeeWorkDayClosings,
  });
  const settlementListItem = buildWorkDaySettlementListItem({
    attendances: normalizedAttendances,
    ...(closing !== undefined && { closing }),
    employeeWorkDayClosings,
    storeId,
    workDate,
  });

  if (!settlementListItem) {
    await firestoreRepository.shop.settlement.deleteWorkDaySettlement(
      ownerId,
      storeId,
      workDate,
    );
    return null;
  }

  const settlementStatus =
    closing !== undefined && options.preserveClosedStatus === true
      ? "closed"
      : settlementListItem.status;

  const employeeNamesById = new Map<string, string>();

  for (const employee of storeEmployees) {
    const employeeName = employee.name?.trim() || employee.displayName?.trim();

    if (employeeName) {
      employeeNamesById.set(employee.uid, employeeName);
    }
  }

  for (const employee of settlementListItem.employees) {
    const employeeName = employee.employeeName?.trim();

    if (employeeName) {
      employeeNamesById.set(employee.employeeUserId, employeeName);
    }
  }

  const responsibleEmployeeUserIds = getResponsibleEmployeeUserIds(settlementAttendances);
  const submittedEmployeeUserIds = new Set(settlementPreview.submittedEmployeeUserIds);
  const pendingEmployees = settlementStatus === "closed"
    ? []
    : responsibleEmployeeUserIds
        .filter((employeeUserId) => !submittedEmployeeUserIds.has(employeeUserId))
        .map((employeeUserId) => ({
          id: employeeUserId,
          name: employeeNamesById.get(employeeUserId) ?? DEFAULT_EMPLOYEE_NAME,
        }));
  const preview: ShopWorkDaySettlementPreviewType = {
    employeeSummaries: settlementPreview.employeeSummaries,
    compensationConfigurationErrors: settlementPreview.compensationConfigurationErrors,
    totalRevenue: settlementPreview.totalRevenue,
    totalDiscount: settlementPreview.totalDiscount,
    totalEmployeeDiscount: settlementPreview.totalEmployeeDiscount,
    totalOwnerDiscount: settlementPreview.totalOwnerDiscount,
    totalOwnerDiscountAbsorbed: settlementPreview.totalOwnerDiscountAbsorbed,
    totalEmployeeDiscountAllocated: settlementPreview.totalEmployeeDiscountAllocated,
    totalUnallocatedDiscount: settlementPreview.totalUnallocatedDiscount,
    totalNetAmount: settlementPreview.totalNetAmount,
    totalOwnerCommission: settlementPreview.totalOwnerCommission,
    totalOwnerNetAfterDiscount: settlementPreview.totalOwnerNetAfterDiscount,
    totalEmployeeEarning: settlementPreview.totalEmployeeEarning,
    allocationSource: "workday",
    ...(settlementPreview.discountAllocationError !== undefined && {
      discountAllocationError: settlementPreview.discountAllocationError,
    }),
    discountTargetEmployeeUserIds: settlementPreview.discountTargetEmployeeUserIds,
    discountEligibleEmployeeUserIds: settlementPreview.discountEligibleEmployeeUserIds,
    submittedEmployeeUserIds: settlementStatus === "closed"
      ? responsibleEmployeeUserIds
      : settlementPreview.submittedEmployeeUserIds,
    incompleteAttendanceIds: settlementPreview.incompleteAttendanceIds,
  };
  const recalculatedClosingSummary =
    closing === undefined
      ? undefined
      : settlementAttendances.reduce(
          (summary, attendance) => {
            summary.totalEntries += 1;
            summary.subtotalAmount = addMoney(summary.subtotalAmount, attendance.subtotalAmount);
            summary.totalNetAmount = addMoney(summary.totalNetAmount, attendance.totalAmount);
            return summary;
          },
          {
            totalEntries: 0,
            subtotalAmount: 0,
            totalDiscountAmount: settlementPreview.totalDiscount,
            totalEmployeeDiscountAmount: settlementPreview.totalEmployeeDiscount,
            totalOwnerDiscountAmount: settlementPreview.totalOwnerDiscount,
            totalNetAmount: 0,
            totalOwnerCommission: settlementPreview.totalOwnerCommission,
            totalEmployeeEarning: settlementPreview.totalEmployeeEarning,
          },
        );

  const commitStage =
    closing !== undefined && settlementStatus === "closed"
      ? "closed_recalculation"
      : "aggregate_prepared";

  return firestoreRepository.shop.settlement.upsertWorkDaySettlement(ownerId, {
    storeId,
    workDate,
    settlementEligibleAt: resolveSettlementEligibleAt(workDate, {
      timeZone: normalizedAttendances[0]?.storeTimezone ?? closing?.storeTimezone,
      settlementCutoffTime: normalizedAttendances[0]?.settlementCutoffTime,
    }),
    status: settlementStatus,
    attendance: settlementListItem.attendance,
    employees: settlementListItem.employees,
    totalRevenue: settlementListItem.totalRevenue,
    totalDiscount: settlementListItem.totalDiscount,
    totalNetAmount: settlementListItem.totalNetAmount,
    totalOwnerNetAfterDiscount: settlementListItem.totalOwnerNetAfterDiscount,
    attendanceVersion: getWorkDaySettlementAttendanceVersion(normalizedAttendances),
    previewOwnerDiscountCoverageRate: ownerDiscountCoverageRate,
    preview,
    pendingEmployees,
    attendanceItems: settlementAttendances.map(toSettlementAttendanceItem),
    serviceSummaries:
      settlementStatus === "closed" && existingSettlement?.serviceSummaries !== undefined
        ? existingSettlement.serviceSummaries
        : buildWorkDayServiceSummaries(normalizedAttendances),
    ...(closing !== undefined && settlementStatus === "closed" && {
      closing: {
        id: closing.id,
        closedAt: closing.closedAt,
        closedByUserId: closing.closedByUserId,
        ownerDiscountCoverageRate: closing.ownerDiscountCoverageRate,
        discountAllocationMethod: closing.discountAllocationMethod,
        employeeSummaries: settlementPreview.employeeSummaries,
        summary: recalculatedClosingSummary ?? closing.summary,
        createdAt: closing.createdAt,
        updatedAt: Date.now(),
        ...(closing.storeTimezone !== undefined && {
          storeTimezone: closing.storeTimezone,
        }),
      },
    }),
  }, {
    commitStage,
    ...(options.onCommitted !== undefined && { onCommitted: options.onCommitted }),
  });
};
