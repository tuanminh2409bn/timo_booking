import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { can } from "../../../helpers/permissions.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import {
  buildWorkDayServiceSummaries,
  buildWorkDaySettlementPreview,
  getPendingResponsibleEmployeeUserIds,
  getResponsibleEmployeeUserIds,
  isSettlementAttendance,
} from "../../../helpers/work-day-settlement.js";
import type {
  ShopWorkDaySettlementClosingType,
  ShopWorkDaySettlementType,
} from "../../../repository/firestore/shop/shop.types.js";
import { normalizeAttendanceForResponse } from "../domain/attendance-presentation.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { addMoney } from "../../../helpers/money.js";
import { resolveAttendanceStoreScope } from "../domain/attendance-store-scope.js";
import { toStoredSettlementPreviewResponse } from "./settlement-response.js";
import { normalizeBusinessTimeZone } from "../../../helpers/business-day.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { FirestoreDataExistingError } from "../../../constants/firestore-error.js";
import { synchronizeWorkDaySettlement } from "./work-day-settlement-sync.js";
import {
  getStoreCloseInvalidStateTraceOutcome,
  markWorkDaySettlementPostWriteFailure,
  observeWorkDaySettlementCommit,
  setActiveWorkDaySettlementSpanAttributes,
  setWorkDaySettlementTraceOutcome,
  withWorkDaySettlementSpan,
} from "./work-day-settlement-observability.js";
import { WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS } from "./work-day-settlement-tracing-contract.js";

const WORK_DAY_CLOSING_SERVICE_ERRORS = {
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/work-day-settlements/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/work-day-settlements/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/work-day-settlements/invalid-request",
    message: "Invalid work-day closing request",
  },
  workDayAlreadyClosed: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/work-day-settlements/work-day-already-closed",
    message: "The selected store work day has already been closed",
  },
  invalidSettlementState: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/work-day-settlements/invalid-settlement-state",
    message: "The selected store work day is not ready to be settled",
  },
  workDayHasOpenAttendance: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/work-day-settlements/work-day-has-open-attendance",
    message: "Cannot close: some responsible employees have not closed their work day",
  },
  noDiscountEligibleEmployees: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/work-day-settlements/no-discount-eligible-employees",
    message: "No commission-based employees are eligible to absorb discount",
  },
};

export const createClosedWorkDaySettlement = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (!can(authContext.role, "workday:close")) {
    return createErrorResponse(res, WORK_DAY_CLOSING_SERVICE_ERRORS.forbiddenRole, {
      role: authContext.role,
    });
  }

  const requestedStoreId = getStoreIdFromUrlPath(req);
  const payloadParseResult = z
    .object({
      workDate: z.string().refine(isValidWorkDate, {
        message: "workDate must use YYYY-MM-DD",
      }),
      ownerDiscountCoverageRate: z.coerce
        .number()
        .pipe(z.union([z.literal(0), z.literal(50), z.literal(100)]))
        .default(50),
      closedAt: z.number().int().positive().optional(),
    })
    .safeParse({
      workDate: req.body?.workDate ?? req.body?.date,
      ownerDiscountCoverageRate:
        req.body?.ownerDiscountCoverageRate ?? req.body?.ownerDiscountSharePercent,
      closedAt: req.body?.closedAt,
    });

  if (!requestedStoreId || !payloadParseResult.success) {
    return createErrorResponse(res, WORK_DAY_CLOSING_SERVICE_ERRORS.invalidRequest, {
      requestedStoreId,
      ...(!payloadParseResult.success && {
        validation: payloadParseResult.error.flatten().fieldErrors,
      }),
    });
  }

  const { workDate, ownerDiscountCoverageRate, closedAt } = payloadParseResult.data;
  setActiveWorkDaySettlementSpanAttributes({
    "settlement.work_date": workDate,
    "settlement.owner_discount_coverage_rate": ownerDiscountCoverageRate,
  });

  const storeScope = await withWorkDaySettlementSpan(
    WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.scopeResolve,
    { "settlement.work_date": workDate },
    () =>
      resolveAttendanceStoreScope(authContext, requestedStoreId, {
        skipCache: true,
      }),
  );

  if (!storeScope || !canAccessStore(authContext, storeScope.storeId)) {
    return createErrorResponse(res, WORK_DAY_CLOSING_SERVICE_ERRORS.forbiddenStore, {
      requestedStoreId,
      role: authContext.role,
    });
  }

  const storeId = storeScope.storeId;
  setActiveWorkDaySettlementSpanAttributes({ "app.store_id": storeId });

  const existingSettlement = await firestoreRepository.shop.settlement.getWorkDaySettlement(
    authContext.ownerId,
    storeId,
    workDate,
  );

  setActiveWorkDaySettlementSpanAttributes({
    "settlement.existing_status": existingSettlement?.status ?? "missing",
    "settlement.aggregate_present": Boolean(existingSettlement),
  });

  if (existingSettlement?.status === "closed") {
    return createErrorResponse(res, WORK_DAY_CLOSING_SERVICE_ERRORS.workDayAlreadyClosed, {
      storeId,
      workDate,
    });
  }

  const [store, attendances, employeeWorkDayClosings, storeEmployees] =
    await withWorkDaySettlementSpan(
      WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.contextLoad,
      { "app.store_id": storeId, "settlement.work_date": workDate },
      () =>
        Promise.all([
          storeScope.store ??
            firestoreRepository.shop.store.getStore(authContext.ownerId, storeId, {
              skipCache: true,
            }),
          firestoreRepository.shop.attendance.listShopAttendanceByStoreWorkDateKey(
            authContext.ownerId,
            storeId,
            workDate,
            { skipCache: true },
          ),
          firestoreRepository.shop.session.listEmployeeWorkDayClosingsByStoreWorkDate(
            authContext.ownerId,
            storeId,
            workDate,
            { skipCache: true },
          ),
          firestoreRepository.user.listShopEmployees(authContext.ownerId, {
            storeId,
            skipCache: true,
          }),
        ]),
    );
  const storeTimezone = normalizeBusinessTimeZone(store.timezone);
  const normalizedStoreAttendances = attendances.map(normalizeAttendanceForResponse);
  const unresolvedAttendanceIds = normalizedStoreAttendances
    .filter(
      (attendance) =>
        attendance.bookingStatus !== undefined &&
        attendance.bookingStatus !== "confirmed" &&
        attendance.bookingStatus !== "cancelled" &&
        attendance.bookingStatus !== "no_show",
    )
    .map((attendance) => attendance.id);
  const normalizedAttendances = normalizedStoreAttendances.filter(isSettlementAttendance);
  const responsibleEmployeeUserIds = getResponsibleEmployeeUserIds(normalizedAttendances);

  setActiveWorkDaySettlementSpanAttributes({
    "settlement.attendance_count": normalizedStoreAttendances.length,
    "settlement.eligible_attendance_count": normalizedAttendances.length,
    "settlement.unresolved_booking_count": unresolvedAttendanceIds.length,
    "settlement.responsible_employee_count": responsibleEmployeeUserIds.length,
  });

  if (unresolvedAttendanceIds.length > 0) {
    setWorkDaySettlementTraceOutcome(res, "booking_unresolved");
    return createErrorResponse(res, WORK_DAY_CLOSING_SERVICE_ERRORS.invalidSettlementState, {
      storeId,
      workDate,
      unresolvedAttendanceIds,
    });
  }

  const settlementPreview = await withWorkDaySettlementSpan(
    WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.previewCalculate,
    { "app.store_id": storeId, "settlement.work_date": workDate },
    async () =>
      buildWorkDaySettlementPreview(normalizedAttendances, {
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
      }),
  );
  const negativeEmployeeEarning = settlementPreview.employeeSummaries.some(
    (employeeSummary) =>
      employeeSummary.compensationModel === "commission" && employeeSummary.employeeEarning < 0,
  );
  const compensationModelCounts = settlementPreview.employeeSummaries.reduce(
    (counts, employeeSummary) => {
      counts[employeeSummary.compensationModel] += 1;
      return counts;
    },
    { commission: 0, fixed: 0, hourly: 0 },
  );

  setActiveWorkDaySettlementSpanAttributes({
    "settlement.submitted_employee_count": settlementPreview.submittedEmployeeUserIds.length,
    "settlement.incomplete_attendance_count": settlementPreview.incompleteAttendanceIds.length,
    "settlement.compensation_error_count": settlementPreview.compensationConfigurationErrors.length,
    "settlement.unallocated_discount_present": settlementPreview.totalUnallocatedDiscount > 0,
    "settlement.negative_employee_earning_present": negativeEmployeeEarning,
    "settlement.commission_employee_count": compensationModelCounts.commission,
    "settlement.fixed_employee_count": compensationModelCounts.fixed,
    "settlement.hourly_employee_count": compensationModelCounts.hourly,
  });

  if (settlementPreview.discountAllocationError === "no_discount_eligible_employees") {
    return createErrorResponse(res, WORK_DAY_CLOSING_SERVICE_ERRORS.noDiscountEligibleEmployees, {
      storeId,
      workDate,
    });
  }

  // Owner settlement waits for each responsible employee's current day-closing snapshot.
  // Attendance status is independent; editing an attendance invalidates the saved snapshot.
  const pendingEmployeeUserIds = getPendingResponsibleEmployeeUserIds(
    normalizedAttendances,
    employeeWorkDayClosings,
  );

  setActiveWorkDaySettlementSpanAttributes({
    "settlement.pending_employee_count": pendingEmployeeUserIds.length,
  });

  if (pendingEmployeeUserIds.length > 0) {
    return createErrorResponse(res, WORK_DAY_CLOSING_SERVICE_ERRORS.workDayHasOpenAttendance, {
      storeId,
      workDate,
      pendingEmployeeUserIds,
    });
  }

  // Chỉ chặn khi dữ liệu chưa đủ để chia tiền (thiếu thợ, giảm giá chưa phân bổ hết, thợ âm tiền công).
  const invalidStateOutcome = getStoreCloseInvalidStateTraceOutcome({
    attendanceCount: normalizedAttendances.length,
    incompleteAttendanceCount: settlementPreview.incompleteAttendanceIds.length,
    compensationErrorCount: settlementPreview.compensationConfigurationErrors.length,
    discountAllocationInvalid:
      settlementPreview.discountAllocationError !== undefined ||
      settlementPreview.totalUnallocatedDiscount > 0,
    negativeEmployeeEarning,
  });

  if (invalidStateOutcome !== undefined) {
    setWorkDaySettlementTraceOutcome(res, invalidStateOutcome);
    return createErrorResponse(res, WORK_DAY_CLOSING_SERVICE_ERRORS.invalidSettlementState, {
      storeId,
      workDate,
    });
  }

  // Every responsible employee has closed the day, so persist the owner-level work-day closing.
  // This timestamp is independent from attendance-level timestamps.
  const closedAtTimestamp = closedAt ?? Date.now();
  const settledAttendances = normalizedAttendances;

  const summary = normalizedAttendances.reduce(
    (closingSummaryAccumulator, attendance) => {
      closingSummaryAccumulator.totalEntries += 1;
      closingSummaryAccumulator.subtotalAmount = addMoney(
        closingSummaryAccumulator.subtotalAmount,
        attendance.subtotalAmount,
      );
      closingSummaryAccumulator.totalNetAmount = addMoney(
        closingSummaryAccumulator.totalNetAmount,
        attendance.totalAmount,
      );
      return closingSummaryAccumulator;
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

  const closingPayload: ShopWorkDaySettlementClosingType = {
    id: `${storeId}__${workDate}`,
    closedAt: closedAtTimestamp,
    closedByUserId: authContext.uid,
    ownerDiscountCoverageRate,
    discountAllocationMethod: "revenue_share",
    storeTimezone,
    employeeSummaries: settlementPreview.employeeSummaries,
    summary,
    createdAt: closedAtTimestamp,
    updatedAt: closedAtTimestamp,
  };

  let storeClosingCommitted = false;
  const onSettlementCommit = (commit: Parameters<typeof observeWorkDaySettlementCommit>[0]) => {
    observeWorkDaySettlementCommit(commit);

    if (commit.stage === "store_closing") {
      storeClosingCommitted = true;
    }
  };

  const preparedSettlement = await synchronizeWorkDaySettlement(
    authContext.ownerId,
    storeId,
    workDate,
    { onCommitted: onSettlementCommit },
  );

  if (!preparedSettlement) {
    setWorkDaySettlementTraceOutcome(res, "invalid_settlement_state");
    return createErrorResponse(res, WORK_DAY_CLOSING_SERVICE_ERRORS.invalidSettlementState, {
      storeId,
      workDate,
    });
  }

  if (preparedSettlement.pendingEmployees.length > 0) {
    setActiveWorkDaySettlementSpanAttributes({
      "settlement.pending_employee_count": preparedSettlement.pendingEmployees.length,
    });
    setWorkDaySettlementTraceOutcome(res, "employee_closing_pending");
    return createErrorResponse(res, WORK_DAY_CLOSING_SERVICE_ERRORS.workDayHasOpenAttendance, {
      storeId,
      workDate,
      pendingEmployeeUserIds: preparedSettlement.pendingEmployees.map((employee) => employee.id),
    });
  }

  let closedSettlement: ShopWorkDaySettlementType;

  try {
    closedSettlement = await firestoreRepository.shop.settlement.createClosedWorkDaySettlement(
      authContext.ownerId,
      {
        storeId,
        workDate,
        settlementEligibleAt: preparedSettlement.settlementEligibleAt,
        status: "closed",
        attendance: preparedSettlement.attendance,
        employees: preparedSettlement.employees,
        totalRevenue: preparedSettlement.totalRevenue,
        totalDiscount: preparedSettlement.totalDiscount,
        totalNetAmount: preparedSettlement.totalNetAmount,
        totalOwnerNetAfterDiscount: settlementPreview.totalOwnerNetAfterDiscount,
        attendanceVersion: preparedSettlement.attendanceVersion,
        previewOwnerDiscountCoverageRate: ownerDiscountCoverageRate,
        preview: {
          ...preparedSettlement.preview,
          employeeSummaries: settlementPreview.employeeSummaries,
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
          submittedEmployeeUserIds: responsibleEmployeeUserIds,
          incompleteAttendanceIds: settlementPreview.incompleteAttendanceIds,
        },
        pendingEmployees: [],
        ...(preparedSettlement.attendanceItems !== undefined && {
          attendanceItems: preparedSettlement.attendanceItems,
        }),
        serviceSummaries: buildWorkDayServiceSummaries(normalizedAttendances),
        closing: closingPayload,
      },
      { onCommitted: onSettlementCommit },
    );
  } catch (error) {
    if (error instanceof FirestoreDataExistingError) {
      setWorkDaySettlementTraceOutcome(res, "concurrent_close_conflict");
      return createErrorResponse(res, WORK_DAY_CLOSING_SERVICE_ERRORS.workDayAlreadyClosed, {
        storeId,
        workDate,
      });
    }

    if (storeClosingCommitted) {
      markWorkDaySettlementPostWriteFailure(res, "cache_invalidation");
    }

    throw error;
  }

  const closingId = closedSettlement.closing?.id ?? `${storeId}__${workDate}`;

  try {
    await withWorkDaySettlementSpan(
      WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.auditWrite,
      { "app.store_id": storeId, "settlement.work_date": workDate },
      () =>
        writeShopAuditLog({
          ownerId: authContext.ownerId,
          eventType: "workday_closed",
          entityType: "work_day",
          entityId: closingId,
          storeId,
          workDate,
          actor: {
            uid: authContext.uid,
            role: authContext.role,
          },
          metadata: {
            totalEntries: summary.totalEntries,
            subtotalAmount: summary.subtotalAmount,
            totalDiscountAmount: summary.totalDiscountAmount,
            totalEmployeeDiscountAmount: summary.totalEmployeeDiscountAmount,
            totalNetAmount: summary.totalNetAmount,
            totalOwnerCommission: summary.totalOwnerCommission,
            totalEmployeeEarning: summary.totalEmployeeEarning,
            ownerDiscountCoverageRate,
            discountAllocationMethod: "revenue_share",
            attendanceCount: normalizedAttendances.length,
          },
        }),
    );
  } catch (error) {
    if (storeClosingCommitted) {
      markWorkDaySettlementPostWriteFailure(res, "audit");
    }

    throw error;
  }

  const responsePayload = toStoredSettlementPreviewResponse({
    settlement: closedSettlement,
    attendances: settledAttendances,
  });

  if (req.method === "POST" && req.path.endsWith("/work-day-settlements")) {
    res.setHeader(
      "Location",
      `/api/v1/stores/${encodeURIComponent(storeId)}/work-day-settlements/${encodeURIComponent(workDate)}`,
    );
    return res.status(StatusCodes.CREATED).json(responsePayload);
  }

  return res.status(StatusCodes.OK).json(responsePayload);
};
