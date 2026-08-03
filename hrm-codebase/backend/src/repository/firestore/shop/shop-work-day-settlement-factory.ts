import type { Firestore, Query } from "@google-cloud/firestore";
import { z } from "zod";
import { WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS } from "../../../business/employee/work-days/work-day-settlement-tracing-contract.js";
import { withWorkDaySettlementSpan } from "../../../business/employee/work-days/work-day-settlement-observability.js";
import {
  FirestoreDataExistingError,
  FirestoreDataValidationError,
} from "../../../constants/firestore-error.js";
import {
  getEmployeeReportResponseCachePrefix,
  getMonthlySalaryResponseCachePrefix,
  getWeeklySalaryResponseCachePrefix,
} from "../../../helpers/cache-keys.js";
import { invalidateWeeklyReport } from "../../../helpers/weekly-report-cache.js";
import { getWeekStartDate } from "../../../helpers/weekly-report-generator.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { cacheDeleteByPrefix } from "../../cache/cache-client.js";
import { getStoreSubcollection } from "../collection-paths.js";
import {
  isStoreScopedDocumentData,
  mapStoreScopedDocumentToShopData,
  toStoreScopedWritePayload,
} from "../store-document-mapper.js";
import type {
  ShopWorkDaySettlementAttendanceItemType,
  ShopWorkDaySettlementFinancialProjectionType,
  ShopWorkDaySettlementListProjectionType,
  ShopWorkDaySettlementStatusType,
  ShopWorkDaySettlementType,
} from "./shop.types.js";
import {
  ShopDiscountOwnerCoverageRateEnum,
  ShopEmployeeCompensationModelEnum,
  ShopWorkDayDiscountAllocationMethodEnum,
  SHOP_WORK_DAY_SETTLEMENT_STATUS_VALUES,
} from "./shop.types.js";
import { deleteWeeklyReportsByWeekFactory } from "./weekly-report.repository.js";
import {
  notifyWorkDaySettlementCommit,
  type WorkDaySettlementCommit,
  type WorkDaySettlementCommitObserver,
  type WorkDaySettlementCommitStage,
} from "./work-day-settlement-commit-observer.js";

const settlementListProjectionSchema = z
  .object({
    ownerId: z.string().min(1),
    storeId: z.string().min(1),
    workDate: z.string().refine(isValidWorkDate),
    settlementEligibleAt: z.number().int().nonnegative(),
    status: z.enum(SHOP_WORK_DAY_SETTLEMENT_STATUS_VALUES),
    attendance: z.object({
      employeeTotalCount: z.number().int().nonnegative(),
      employeeClosedCount: z.number().int().nonnegative(),
    }),
    employees: z.array(
      z.object({
        employeeUserId: z.string().min(1),
        employeeName: z.string().optional(),
        attendanceCount: z.number().int().nonnegative(),
        closedCount: z.number().int().nonnegative(),
        totalRevenue: z.number().finite(),
      }),
    ),
  })
  .passthrough();

const settlementAttendanceItemSchema = z.object({
  id: z.string().min(1),
  attendanceCode: z.string().optional(),
  startTime: z.number().int().nonnegative(),
  endTime: z.number().int().positive(),
  customerName: z.string().optional(),
  status: z.enum(["open", "closed"]),
  responsibleEmployeeUserId: z.string().min(1).optional(),
  services: z.array(
    z.object({
      name: z.string().min(1),
      employees: z.array(
        z.object({
          employeeUserId: z.string().min(1),
          employeeName: z.string().min(1).optional(),
        }),
      ),
    }),
  ),
});

const settlementDocumentSchema = settlementListProjectionSchema
  .extend({
    attendance: z.object({
      totalCount: z.number().int().nonnegative(),
      openCount: z.number().int().nonnegative(),
      closedCount: z.number().int().nonnegative(),
      incompleteCount: z.number().int().nonnegative(),
      employeeTotalCount: z.number().int().nonnegative(),
      employeeClosedCount: z.number().int().nonnegative(),
    }),
    totalRevenue: z.number().finite(),
    totalDiscount: z.number().finite(),
    totalNetAmount: z.number().finite(),
    totalOwnerNetAfterDiscount: z.number().finite(),
    attendanceVersion: z.string().min(1),
    previewOwnerDiscountCoverageRate: ShopDiscountOwnerCoverageRateEnum,
    preview: z
      .object({
        employeeSummaries: z
          .array(
            z.object({
              employeeUserId: z.string().min(1),
              employeeName: z.string(),
              totalRevenue: z.number().finite(),
              discountAllocated: z.number().finite(),
              ownerDiscountSupported: z.number().finite(),
              revenueAfterDiscount: z.number().finite(),
              ownerCommission: z.number().finite(),
              employeeEarning: z.number().finite(),
              compensationModel: ShopEmployeeCompensationModelEnum,
              ownerCommissionRate: z.number().finite().optional(),
              fixedSalary: z.number().finite().optional(),
              hourlyRate: z.number().finite().optional(),
              workedMinutes: z.number().int().nonnegative(),
              isSelectedForDiscount: z.boolean(),
            }),
          )
          .optional(),
        compensationConfigurationErrors: z.array(
          z.object({
            employeeUserId: z.string().min(1),
            reason: z.enum([
              "hourly_rate_missing",
              "fixed_salary_missing",
              "owner_commission_rate_missing",
              "compensation_model_missing",
              "employee_missing",
            ]),
          }),
        ),
        totalRevenue: z.number().finite(),
        totalDiscount: z.number().finite(),
        totalEmployeeDiscount: z.number().finite(),
        totalOwnerDiscount: z.number().finite(),
        totalOwnerDiscountAbsorbed: z.number().finite(),
        totalEmployeeDiscountAllocated: z.number().finite(),
        totalUnallocatedDiscount: z.number().finite(),
        totalNetAmount: z.number().finite(),
        totalOwnerCommission: z.number().finite(),
        totalOwnerNetAfterDiscount: z.number().finite(),
        totalEmployeeEarning: z.number().finite(),
        allocationSource: z.literal("workday"),
        discountAllocationError: z.string().min(1).optional(),
        discountTargetEmployeeUserIds: z.array(z.string()),
        discountEligibleEmployeeUserIds: z.array(z.string()),
        submittedEmployeeUserIds: z.array(z.string()),
        incompleteAttendanceIds: z.array(z.string()),
      })
      .passthrough(),
    pendingEmployees: z.array(z.object({ id: z.string().min(1), name: z.string() }).passthrough()),
    attendanceItems: z.array(settlementAttendanceItemSchema).optional(),
    serviceSummaries: z.array(
      z
        .object({
          serviceId: z.string().min(1),
          serviceName: z.string(),
          category: z.string(),
          count: z.number().int().nonnegative(),
          totalRevenue: z.number().finite(),
          totalRevenueMinor: z.number().int().optional(),
          averagePrice: z.number().finite(),
          averagePriceMinor: z.number().int().optional(),
        })
        .passthrough(),
    ),
    closing: z
      .object({
        id: z.string().min(1),
        closedAt: z.number().int().positive(),
        closedByUserId: z.string().min(1),
        ownerDiscountCoverageRate: ShopDiscountOwnerCoverageRateEnum,
        discountAllocationMethod: ShopWorkDayDiscountAllocationMethodEnum,
        storeTimezone: z.string().min(1).optional(),
        employeeSummaries: z.array(
          z.object({
            employeeUserId: z.string().min(1),
            employeeName: z.string(),
            totalRevenue: z.number().finite(),
            discountAllocated: z.number().finite(),
            ownerDiscountSupported: z.number().finite(),
            revenueAfterDiscount: z.number().finite(),
            ownerCommission: z.number().finite(),
            employeeEarning: z.number().finite(),
            compensationModel: ShopEmployeeCompensationModelEnum,
            ownerCommissionRate: z.number().finite().optional(),
            fixedSalary: z.number().finite().optional(),
            hourlyRate: z.number().finite().optional(),
            workedMinutes: z.number().int().nonnegative(),
            isSelectedForDiscount: z.boolean(),
          }),
        ),
        summary: z
          .object({
            totalEntries: z.number().int().nonnegative(),
            subtotalAmount: z.number().finite(),
            totalDiscountAmount: z.number().finite(),
            totalEmployeeDiscountAmount: z.number().finite().optional(),
            totalOwnerDiscountAmount: z.number().finite().optional(),
            totalNetAmount: z.number().finite(),
            totalOwnerCommission: z.number().finite(),
            totalEmployeeEarning: z.number().finite(),
          })
          .passthrough(),
        createdAt: z.number().int().positive(),
        updatedAt: z.number().int().positive(),
      })
      .passthrough()
      .optional(),
    revision: z.number().int().positive(),
    createdAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
  })
  .passthrough();

const settlementFinancialProjectionSchema = z
  .object({
    ownerId: z.string().min(1),
    storeId: z.string().min(1),
    workDate: z.string().refine(isValidWorkDate),
    status: z.literal("closed"),
    updatedAt: z.number().int().positive(),
    attendance: z.object({
      totalCount: z.number().int().nonnegative(),
    }),
    employees: z.array(
      z
        .object({
          employeeUserId: z.string().min(1),
          attendanceCount: z.number().int().nonnegative(),
        })
        .passthrough(),
    ),
    preview: z.object({
      employeeSummaries: z.array(
        z.object({
          employeeUserId: z.string().min(1),
          employeeName: z.string(),
          totalRevenue: z.number().finite(),
          discountAllocated: z.number().finite(),
          ownerDiscountSupported: z.number().finite(),
          revenueAfterDiscount: z.number().finite(),
          ownerCommission: z.number().finite(),
          employeeEarning: z.number().finite(),
          compensationModel: ShopEmployeeCompensationModelEnum,
          ownerCommissionRate: z.number().finite().optional(),
          fixedSalary: z.number().finite().optional(),
          hourlyRate: z.number().finite().optional(),
          workedMinutes: z.number().int().nonnegative(),
          isSelectedForDiscount: z.boolean(),
        }),
      ),
      totalEmployeeEarning: z.number().finite(),
      totalOwnerCommission: z.number().finite(),
    }),
    serviceSummaries: z.array(
      z.object({
        serviceId: z.string().min(1),
        serviceName: z.string(),
        category: z.string(),
        count: z.number().int().nonnegative(),
        totalRevenue: z.number().finite(),
        totalRevenueMinor: z.number().int().optional(),
        averagePrice: z.number().finite(),
        averagePriceMinor: z.number().int().optional(),
      }),
    ),
    closing: z.object({
      id: z.string().min(1),
      closedAt: z.number().int().positive(),
      closedByUserId: z.string().min(1),
      ownerDiscountCoverageRate: ShopDiscountOwnerCoverageRateEnum,
      discountAllocationMethod: ShopWorkDayDiscountAllocationMethodEnum,
      employeeSummaries: z.array(
        z.object({
          employeeUserId: z.string().min(1),
          employeeName: z.string(),
          totalRevenue: z.number().finite(),
          discountAllocated: z.number().finite(),
          ownerDiscountSupported: z.number().finite(),
          revenueAfterDiscount: z.number().finite(),
          ownerCommission: z.number().finite(),
          employeeEarning: z.number().finite(),
          compensationModel: ShopEmployeeCompensationModelEnum,
          ownerCommissionRate: z.number().finite().optional(),
          fixedSalary: z.number().finite().optional(),
          hourlyRate: z.number().finite().optional(),
          workedMinutes: z.number().int().nonnegative(),
          isSelectedForDiscount: z.boolean(),
        }),
      ),
      summary: z.object({
        totalEntries: z.number().int().nonnegative(),
        subtotalAmount: z.number().finite(),
        totalDiscountAmount: z.number().finite(),
        totalEmployeeDiscountAmount: z.number().finite().optional(),
        totalOwnerDiscountAmount: z.number().finite().optional(),
        totalNetAmount: z.number().finite(),
        totalOwnerCommission: z.number().finite(),
        totalEmployeeEarning: z.number().finite(),
      }),
    }),
  })
  .passthrough();

const WORK_DAY_SETTLEMENTS_SUBCOLLECTION = "work_day_settlements";
const FINANCIAL_CACHE_GROUP_COUNT = 5;

type MarkEmployeeClosedTransactionResult = {
  storedSettlement: ShopWorkDaySettlementType | null;
  commit?: WorkDaySettlementCommit;
};

const getSettlementPersistSpanName = (stage: WorkDaySettlementCommitStage) => {
  if (stage === "store_closing") {
    return WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.storeClosingPersist;
  }

  if (stage === "closed_recalculation") {
    return WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.closedRecalculate;
  }

  return WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.snapshotSync;
};

const getStoreWorkDaySettlements = (firestoreDB: Firestore, storeId: string) =>
  getStoreSubcollection(firestoreDB, storeId, WORK_DAY_SETTLEMENTS_SUBCOLLECTION);

export type PaginatedWorkDaySettlements = {
  settlements: ShopWorkDaySettlementListProjectionType[];
  nextCursor: {
    workDate: string;
    settlementEligibleAt?: number;
  } | null;
  hasMore: boolean;
};

export const getShopWorkDaySettlementFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    workDate: string,
  ): Promise<ShopWorkDaySettlementType | null> => {
    const settlementDocument = await getStoreWorkDaySettlements(firestoreDB, storeId)
      .doc(workDate)
      .get();
    const settlementData = settlementDocument.data();
    const settlementParseResult = settlementDocumentSchema.safeParse(settlementData);

    if (
      !settlementDocument.exists ||
      !isStoreScopedDocumentData(settlementData, ownerId, storeId)
    ) {
      return null;
    }

    if (!settlementParseResult.success) {
      throw new FirestoreDataValidationError("Stored work-day settlement data is invalid");
    }

    if (settlementParseResult.data.workDate !== workDate) {
      throw new FirestoreDataValidationError(
        "Stored work-day settlement does not match its document path",
      );
    }

    return mapStoreScopedDocumentToShopData<ShopWorkDaySettlementType>(settlementDocument, ownerId);
  };
};

export const listShopWorkDaySettlementAttendanceItemsFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    workDate: string,
  ): Promise<ShopWorkDaySettlementAttendanceItemType[] | null> => {
    const settlementDocument = await getStoreWorkDaySettlements(firestoreDB, storeId)
      .doc(workDate)
      .get();
    const settlementData = settlementDocument.data();

    if (
      !settlementDocument.exists ||
      !isStoreScopedDocumentData(settlementData, ownerId, storeId)
    ) {
      return null;
    }

    const settlementParseResult = settlementDocumentSchema.safeParse(settlementData);

    if (!settlementParseResult.success) {
      throw new FirestoreDataValidationError("Stored work-day settlement data is invalid");
    }

    if (settlementParseResult.data.workDate !== workDate) {
      throw new FirestoreDataValidationError(
        "Stored work-day settlement does not match its document path",
      );
    }

    return (
      mapStoreScopedDocumentToShopData<ShopWorkDaySettlementType>(settlementDocument, ownerId)
        .attendanceItems ?? []
    );
  };
};

export const markShopWorkDaySettlementEmployeeClosedFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    workDate: string,
    employeeUserId: string,
    options: { onCommitted?: WorkDaySettlementCommitObserver } = {},
  ): Promise<ShopWorkDaySettlementType | null> => {
    const settlementDocument = getStoreWorkDaySettlements(firestoreDB, storeId).doc(workDate);

    const transactionResult = await withWorkDaySettlementSpan(
      WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.aggregateMarkEmployeeClosed,
      {
        "app.store_id": storeId,
        "settlement.work_date": workDate,
      },
      () =>
        firestoreDB.runTransaction<MarkEmployeeClosedTransactionResult>(async (transaction) => {
          const existingDocument = await transaction.get(settlementDocument);
          const existingData = existingDocument.data();

          if (
            !existingDocument.exists ||
            !isStoreScopedDocumentData(existingData, ownerId, storeId)
          ) {
            return { storedSettlement: null };
          }

          const settlementParseResult = settlementDocumentSchema.safeParse(existingData);

          if (!settlementParseResult.success) {
            throw new FirestoreDataValidationError("Stored work-day settlement data is invalid");
          }

          const settlement = mapStoreScopedDocumentToShopData<ShopWorkDaySettlementType>(
            existingDocument,
            ownerId,
          );

          if (settlement.status === "closed") {
            return {
              storedSettlement: mapStoreScopedDocumentToShopData<ShopWorkDaySettlementType>(
                existingDocument,
                ownerId,
              ),
            };
          }

          const employees = settlement.employees.map((employee) =>
            employee.employeeUserId === employeeUserId
              ? {
                  ...employee,
                  closedCount: 1,
                }
              : employee,
          );
          const closedEmployeeUserIds = new Set(settlement.preview.submittedEmployeeUserIds);
          closedEmployeeUserIds.add(employeeUserId);
          const employeeClosedCount = employees.filter(
            (employee) => employee.closedCount > 0,
          ).length;
          const everyResponsibleEmployeeClosed =
            settlement.attendance.employeeTotalCount > 0 &&
            employeeClosedCount === settlement.attendance.employeeTotalCount;
          const timestamp = Date.now();
          const nextStatus =
            everyResponsibleEmployeeClosed && settlement.attendance.incompleteCount === 0
              ? "ready"
              : "open";
          const nextRevision = settlement.revision + 1;
          const nextSettlement: ShopWorkDaySettlementType = {
            ...settlement,
            status: nextStatus,
            attendance: {
              ...settlement.attendance,
              employeeClosedCount,
            },
            employees,
            preview: {
              ...settlement.preview,
              submittedEmployeeUserIds: Array.from(closedEmployeeUserIds).sort(),
            },
            pendingEmployees: settlement.pendingEmployees.filter(
              (employee) => employee.id !== employeeUserId,
            ),
            revision: nextRevision,
            updatedAt: timestamp,
          };

          if (!settlementDocumentSchema.safeParse(nextSettlement).success) {
            throw new FirestoreDataValidationError("Work-day settlement write payload is invalid");
          }

          transaction.set(settlementDocument, toStoreScopedWritePayload(ownerId, nextSettlement));
          return {
            storedSettlement: nextSettlement,
            commit: {
              stage: "aggregate_mark",
              persistAction: "overwrite",
              statusBefore: settlement.status,
              statusAfter: nextStatus,
              revisionBefore: settlement.revision,
              revisionAfter: nextRevision,
            } satisfies WorkDaySettlementCommit,
          };
        }),
    );

    if (transactionResult.commit !== undefined) {
      notifyWorkDaySettlementCommit(options.onCommitted, transactionResult.commit);
    }

    return transactionResult.storedSettlement;
  };
};

export const listClosedShopWorkDaySettlementFinancialProjectionByStoreDateRangeFactory = (
  firestoreDB: Firestore,
) => {
  return async (
    ownerId: string,
    storeId: string,
    fromWorkDate: string,
    toWorkDate: string,
  ): Promise<ShopWorkDaySettlementFinancialProjectionType[]> => {
    if (
      ownerId.trim().length === 0 ||
      storeId.trim().length === 0 ||
      !isValidWorkDate(fromWorkDate) ||
      !isValidWorkDate(toWorkDate) ||
      fromWorkDate > toWorkDate
    ) {
      throw new FirestoreDataValidationError("Invalid work-day settlement date range");
    }

    const snapshot = await getStoreWorkDaySettlements(firestoreDB, storeId)
      .where("workDate", ">=", fromWorkDate)
      .where("workDate", "<=", toWorkDate)
      .orderBy("workDate", "desc")
      .select(
        "ownerId",
        "storeId",
        "workDate",
        "status",
        "updatedAt",
        "attendance.totalCount",
        "employees",
        "preview.employeeSummaries",
        "preview.totalEmployeeEarning",
        "preview.totalOwnerCommission",
        "serviceSummaries",
        "closing.id",
        "closing.closedAt",
        "closing.closedByUserId",
        "closing.ownerDiscountCoverageRate",
        "closing.discountAllocationMethod",
        "closing.employeeSummaries",
        "closing.summary",
      )
      .get();
    const settlements: ShopWorkDaySettlementFinancialProjectionType[] = [];

    for (const document of snapshot.docs) {
      const settlementData = document.data();

      if (!isStoreScopedDocumentData(settlementData, ownerId, storeId)) {
        continue;
      }

      if (settlementData["status"] !== "closed") {
        continue;
      }

      const settlementParseResult = settlementFinancialProjectionSchema.safeParse(settlementData);

      if (!settlementParseResult.success) {
        throw new FirestoreDataValidationError(
          "Stored work-day settlement financial data is invalid",
        );
      }

      if (settlementParseResult.data.workDate !== document.id) {
        throw new FirestoreDataValidationError(
          "Stored work-day settlement does not match its document path",
        );
      }

      settlements.push({
        id: document.id,
        ownerId: settlementParseResult.data.ownerId,
        storeId: settlementParseResult.data.storeId,
        workDate: settlementParseResult.data.workDate,
        status: settlementParseResult.data.status,
        updatedAt: settlementParseResult.data.updatedAt,
        attendance: settlementParseResult.data.attendance,
        employees: settlementParseResult.data.employees.map((employee) => ({
          employeeUserId: employee.employeeUserId,
          attendanceCount: employee.attendanceCount,
        })),
        preview: {
          employeeSummaries: settlementParseResult.data.preview.employeeSummaries.map(
            (employeeSummary) => ({
              employeeUserId: employeeSummary.employeeUserId,
              employeeName: employeeSummary.employeeName,
              totalRevenue: employeeSummary.totalRevenue,
              discountAllocated: employeeSummary.discountAllocated,
              ownerDiscountSupported: employeeSummary.ownerDiscountSupported,
              revenueAfterDiscount: employeeSummary.revenueAfterDiscount,
              ownerCommission: employeeSummary.ownerCommission,
              employeeEarning: employeeSummary.employeeEarning,
              compensationModel: employeeSummary.compensationModel,
              workedMinutes: employeeSummary.workedMinutes,
              isSelectedForDiscount: employeeSummary.isSelectedForDiscount,
              ...(employeeSummary.ownerCommissionRate !== undefined && {
                ownerCommissionRate: employeeSummary.ownerCommissionRate,
              }),
              ...(employeeSummary.hourlyRate !== undefined && {
                hourlyRate: employeeSummary.hourlyRate,
              }),
              ...(employeeSummary.fixedSalary !== undefined && {
                fixedSalary: employeeSummary.fixedSalary,
              }),
            }),
          ),
          totalEmployeeEarning: settlementParseResult.data.preview.totalEmployeeEarning,
          totalOwnerCommission: settlementParseResult.data.preview.totalOwnerCommission,
        },
        serviceSummaries: settlementParseResult.data.serviceSummaries.map((service) => ({
          serviceId: service.serviceId,
          serviceName: service.serviceName,
          category: service.category,
          count: service.count,
          totalRevenue: service.totalRevenue,
          averagePrice: service.averagePrice,
          ...(service.totalRevenueMinor !== undefined && {
            totalRevenueMinor: service.totalRevenueMinor,
          }),
          ...(service.averagePriceMinor !== undefined && {
            averagePriceMinor: service.averagePriceMinor,
          }),
        })),
        closing: {
          id: settlementParseResult.data.closing.id,
          closedAt: settlementParseResult.data.closing.closedAt,
          closedByUserId: settlementParseResult.data.closing.closedByUserId,
          ownerDiscountCoverageRate: settlementParseResult.data.closing.ownerDiscountCoverageRate,
          discountAllocationMethod: settlementParseResult.data.closing.discountAllocationMethod,
          summary: {
            totalEntries: settlementParseResult.data.closing.summary.totalEntries,
            subtotalAmount: settlementParseResult.data.closing.summary.subtotalAmount,
            totalDiscountAmount: settlementParseResult.data.closing.summary.totalDiscountAmount,
            totalNetAmount: settlementParseResult.data.closing.summary.totalNetAmount,
            totalOwnerCommission: settlementParseResult.data.closing.summary.totalOwnerCommission,
            totalEmployeeEarning: settlementParseResult.data.closing.summary.totalEmployeeEarning,
            ...(settlementParseResult.data.closing.summary.totalEmployeeDiscountAmount !==
              undefined && {
              totalEmployeeDiscountAmount:
                settlementParseResult.data.closing.summary.totalEmployeeDiscountAmount,
            }),
            ...(settlementParseResult.data.closing.summary.totalOwnerDiscountAmount !==
              undefined && {
              totalOwnerDiscountAmount:
                settlementParseResult.data.closing.summary.totalOwnerDiscountAmount,
            }),
          },
        },
      });
    }

    return settlements;
  };
};

export const countOpenShopWorkDaySettlementsByStoreFactory = (firestoreDB: Firestore) => {
  return async (ownerId: string, storeId: string): Promise<number> => {
    const snapshot = await getStoreWorkDaySettlements(firestoreDB, storeId)
      .where("ownerId", "==", ownerId)
      .where("status", "in", ["open", "ready"])
      .count()
      .get();

    return snapshot.data().count;
  };
};

export const listShopWorkDaySettlementsByStatusPaginatedFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    statuses: ShopWorkDaySettlementStatusType[],
    options: {
      limit: number;
      cursorWorkDate?: string;
      cursorSettlementEligibleAt?: number;
      toWorkDate?: string;
      toSettlementEligibleAt?: number;
    },
  ): Promise<PaginatedWorkDaySettlements> => {
    let settlementQuery: Query = getStoreWorkDaySettlements(firestoreDB, storeId).where(
      "ownerId",
      "==",
      ownerId,
    );

    if (statuses.length === 1) {
      settlementQuery = settlementQuery.where("status", "==", statuses[0]);
    } else {
      settlementQuery = settlementQuery.where("status", "in", statuses);
    }

    if (options.toSettlementEligibleAt !== undefined) {
      settlementQuery = settlementQuery.where(
        "settlementEligibleAt",
        "<=",
        options.toSettlementEligibleAt,
      );
      settlementQuery = settlementQuery
        .orderBy("settlementEligibleAt", "desc")
        .orderBy("workDate", "desc");
    } else if (options.toWorkDate !== undefined) {
      settlementQuery = settlementQuery.where("workDate", "<=", options.toWorkDate);
      settlementQuery = settlementQuery.orderBy("workDate", "desc");
    } else {
      settlementQuery = settlementQuery.orderBy("workDate", "desc");
    }

    if (options.cursorWorkDate !== undefined) {
      if (
        options.toSettlementEligibleAt !== undefined &&
        options.cursorSettlementEligibleAt !== undefined
      ) {
        settlementQuery = settlementQuery.startAfter(
          options.cursorSettlementEligibleAt,
          options.cursorWorkDate,
        );
      } else {
        settlementQuery = settlementQuery.startAfter(options.cursorWorkDate);
      }
    }

    settlementQuery = settlementQuery.select(
      "ownerId",
      "storeId",
      "workDate",
      "settlementEligibleAt",
      "status",
      "attendance.employeeTotalCount",
      "attendance.employeeClosedCount",
      "employees",
    );

    const snapshot = await settlementQuery.limit(options.limit + 1).get();
    const fetchedSettlements: ShopWorkDaySettlementListProjectionType[] = [];

    for (const document of snapshot.docs) {
      const settlementData = document.data();

      if (!isStoreScopedDocumentData(settlementData, ownerId, storeId)) {
        continue;
      }

      if (!settlementListProjectionSchema.safeParse(settlementData).success) {
        throw new FirestoreDataValidationError("Stored work-day settlement data is invalid");
      }

      fetchedSettlements.push(
        mapStoreScopedDocumentToShopData<ShopWorkDaySettlementListProjectionType>(
          document,
          ownerId,
        ),
      );
    }
    const hasMore = fetchedSettlements.length > options.limit;
    const settlements = hasMore ? fetchedSettlements.slice(0, options.limit) : fetchedSettlements;
    const lastSettlement = settlements[settlements.length - 1];

    return {
      settlements,
      nextCursor:
        hasMore && lastSettlement
          ? {
              workDate: lastSettlement.workDate,
              ...(options.toSettlementEligibleAt !== undefined && {
                settlementEligibleAt: lastSettlement.settlementEligibleAt,
              }),
            }
          : null,
      hasMore,
    };
  };
};

export const upsertShopWorkDaySettlementFactory = (firestoreDB: Firestore) => {
  const deleteWeeklyReportsByWeek = deleteWeeklyReportsByWeekFactory(firestoreDB);

  type UpsertOptions = {
    rejectClosedSettlement?: boolean;
    onCommitted?: WorkDaySettlementCommitObserver;
    commitStage?: WorkDaySettlementCommitStage;
  };

  return async (
    ownerId: string,
    settlement: Omit<
      ShopWorkDaySettlementType,
      "id" | "ownerId" | "revision" | "createdAt" | "updatedAt"
    >,
    options: UpsertOptions = {},
  ): Promise<ShopWorkDaySettlementType> => {
    const settlementDocument = getStoreWorkDaySettlements(firestoreDB, settlement.storeId).doc(
      settlement.workDate,
    );

    const commitStage =
      options.commitStage ??
      (settlement.status === "closed" ? "store_closing" : "aggregate_prepared");
    const persistSpanName = getSettlementPersistSpanName(commitStage);
    const transactionResult = await withWorkDaySettlementSpan(
      persistSpanName,
      {
        "app.store_id": settlement.storeId,
        "settlement.work_date": settlement.workDate,
      },
      () =>
        firestoreDB.runTransaction(async (transaction) => {
          const existingDocument = await transaction.get(settlementDocument);
          const existingData = existingDocument.data();

          if (options.rejectClosedSettlement === true && existingData?.["status"] === "closed") {
            throw new FirestoreDataExistingError("Work-day settlement already exists");
          }

          const timestamp = Date.now();
          const hasScopedExistingSettlement =
            existingDocument.exists &&
            isStoreScopedDocumentData(existingData, ownerId, settlement.storeId);
          const existingSettlementParseResult = settlementDocumentSchema.safeParse(existingData);
          let statusBefore: ShopWorkDaySettlementStatusType | "missing" | undefined = "missing";

          if (hasScopedExistingSettlement) {
            statusBefore = existingSettlementParseResult.success
              ? existingSettlementParseResult.data.status
              : undefined;
          }

          const revisionBefore =
            hasScopedExistingSettlement && typeof existingData?.["revision"] === "number"
              ? existingData["revision"]
              : undefined;
          const nextRevision = revisionBefore === undefined ? 1 : revisionBefore + 1;
          const storedSettlement: ShopWorkDaySettlementType = {
            id: settlement.workDate,
            ownerId,
            ...settlement,
            revision: nextRevision,
            createdAt:
              hasScopedExistingSettlement && typeof existingData?.["createdAt"] === "number"
                ? existingData["createdAt"]
                : timestamp,
            updatedAt: timestamp,
          };

          if (!settlementDocumentSchema.safeParse(storedSettlement).success) {
            throw new FirestoreDataValidationError("Work-day settlement write payload is invalid");
          }

          transaction.set(settlementDocument, toStoreScopedWritePayload(ownerId, storedSettlement));

          const commit: WorkDaySettlementCommit = {
            stage: commitStage,
            persistAction: hasScopedExistingSettlement ? "overwrite" : "create",
            ...(statusBefore !== undefined && { statusBefore }),
            statusAfter: storedSettlement.status,
            ...(revisionBefore !== undefined && { revisionBefore }),
            revisionAfter: storedSettlement.revision,
          };

          return {
            storedSettlement,
            commit,
            shouldInvalidateFinancialCaches:
              storedSettlement.status === "closed" ||
              (isStoreScopedDocumentData(existingData, ownerId, settlement.storeId) &&
                existingData?.["status"] === "closed"),
          };
        }),
    );

    notifyWorkDaySettlementCommit(options.onCommitted, transactionResult.commit);

    if (transactionResult.shouldInvalidateFinancialCaches) {
      const weekStartDate = getWeekStartDate(settlement.workDate);

      await withWorkDaySettlementSpan(
        WORK_DAY_SETTLEMENT_TRACE_CHILD_SPANS.cacheInvalidate,
        {
          "app.store_id": settlement.storeId,
          "settlement.work_date": settlement.workDate,
          "settlement.post_write_phase": "cache_invalidation",
          "settlement.cache_group_count": FINANCIAL_CACHE_GROUP_COUNT,
        },
        async () => {
          await Promise.all([
            cacheDeleteByPrefix(getEmployeeReportResponseCachePrefix(ownerId)),
            cacheDeleteByPrefix(getMonthlySalaryResponseCachePrefix(ownerId, settlement.storeId)),
            cacheDeleteByPrefix(getWeeklySalaryResponseCachePrefix(ownerId, settlement.storeId)),
            invalidateWeeklyReport(ownerId, settlement.storeId, weekStartDate),
            deleteWeeklyReportsByWeek(settlement.storeId, weekStartDate),
          ]);
        },
      );
    }

    return transactionResult.storedSettlement;
  };
};

export const deleteShopWorkDaySettlementFactory = (firestoreDB: Firestore) => {
  const deleteWeeklyReportsByWeek = deleteWeeklyReportsByWeekFactory(firestoreDB);

  return async (ownerId: string, storeId: string, workDate: string): Promise<void> => {
    const settlementDocument = getStoreWorkDaySettlements(firestoreDB, storeId).doc(workDate);
    const settlementSnapshot = await settlementDocument.get();
    const settlementData = settlementSnapshot.data();

    if (
      !settlementSnapshot.exists ||
      !isStoreScopedDocumentData(settlementData, ownerId, storeId)
    ) {
      return;
    }

    const settlementParseResult = settlementDocumentSchema.safeParse(settlementData);

    if (!settlementParseResult.success) {
      throw new FirestoreDataValidationError("Stored work-day settlement data is invalid");
    }

    await settlementDocument.delete();

    if (settlementParseResult.data.status === "closed") {
      const weekStartDate = getWeekStartDate(workDate);

      await Promise.all([
        cacheDeleteByPrefix(getEmployeeReportResponseCachePrefix(ownerId)),
        cacheDeleteByPrefix(getMonthlySalaryResponseCachePrefix(ownerId, storeId)),
        cacheDeleteByPrefix(getWeeklySalaryResponseCachePrefix(ownerId, storeId)),
        invalidateWeeklyReport(ownerId, storeId, weekStartDate),
        deleteWeeklyReportsByWeek(storeId, weekStartDate),
      ]);
    }
  };
};
