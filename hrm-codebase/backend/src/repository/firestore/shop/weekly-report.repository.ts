import type { DocumentSnapshot, Firestore } from "@google-cloud/firestore";
import { z } from "zod";
import { FirestoreDataValidationError } from "../../../constants/firestore-error.js";
import { getEmployeeReportResponseCachePrefix } from "../../../helpers/cache-keys.js";
import { getWeekEndDate } from "../../../helpers/weekly-report-generator.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { cacheDeleteByPrefix } from "../../cache/cache-client.js";
import { getStoreSubcollection } from "../collection-paths.js";
import type { WeeklyReportType } from "./weekly-report.types.js";

const WEEKLY_REPORTS_SUBCOLLECTION = "weekly_reports";
const WEEKLY_REPORT_LIST_LIMIT = 60;

const optionalMinorMoneySchema = z.number().int().optional();

const weeklyReportDailyMetricSchema = z
  .object({
    workDate: z.string().refine(isValidWorkDate),
    attendanceCount: z.number().int().nonnegative(),
    revenue: z.number().finite(),
    revenueMinor: optionalMinorMoneySchema,
    discount: z.number().finite(),
    discountMinor: optionalMinorMoneySchema,
    netRevenue: z.number().finite(),
    netRevenueMinor: optionalMinorMoneySchema,
    ownerCommission: z.number().finite(),
    ownerCommissionMinor: optionalMinorMoneySchema,
    employeeEarnings: z.number().finite(),
    employeeEarningsMinor: optionalMinorMoneySchema,
  })
  .passthrough();

const weeklyReportEmployeeBreakdownSchema = z
  .object({
    employeeUserId: z.string().trim().min(1),
    employeeName: z.string().trim().min(1),
    totalAttendances: z.number().int().nonnegative(),
    totalRevenue: z.number().finite(),
    totalRevenueMinor: optionalMinorMoneySchema,
    totalEarnings: z.number().finite(),
    totalEarningsMinor: optionalMinorMoneySchema,
    totalDiscountAllocated: z.number().finite().optional(),
    totalDiscountAllocatedMinor: optionalMinorMoneySchema,
    totalOwnerCommission: z.number().finite().optional(),
    totalOwnerCommissionMinor: optionalMinorMoneySchema,
    totalWorkedMinutes: z.number().int().nonnegative().optional(),
    compensationModel: z.enum(["commission", "fixed", "hourly"]).optional(),
    fixedSalary: z.number().finite().nonnegative().optional(),
    fixedSalaryMinor: optionalMinorMoneySchema,
    hourlyRate: z.number().finite().nonnegative().optional(),
    hourlyRateMinor: optionalMinorMoneySchema,
    workingDays: z.number().int().nonnegative(),
  })
  .passthrough();

const weeklyReportDailyEmployeeBreakdownSchema = weeklyReportEmployeeBreakdownSchema.extend({
  workDate: z.string().refine(isValidWorkDate),
});

const weeklyReportServiceBreakdownSchema = z
  .object({
    serviceId: z.string().trim().min(1),
    serviceName: z.string().trim().min(1),
    category: z.string(),
    count: z.number().int().nonnegative(),
    totalRevenue: z.number().finite(),
    totalRevenueMinor: optionalMinorMoneySchema,
    averagePrice: z.number().finite(),
    averagePriceMinor: optionalMinorMoneySchema,
  })
  .passthrough();

const weeklyReportDailyServiceBreakdownSchema = weeklyReportServiceBreakdownSchema.extend({
  workDate: z.string().refine(isValidWorkDate),
});

const weeklyReportSummarySchema = z
  .object({
    totalAttendances: z.number().int().nonnegative(),
    totalRevenue: z.number().finite(),
    totalRevenueMinor: optionalMinorMoneySchema,
    totalDiscount: z.number().finite(),
    totalDiscountMinor: optionalMinorMoneySchema,
    totalNetRevenue: z.number().finite(),
    totalNetRevenueMinor: optionalMinorMoneySchema,
    totalOwnerCommission: z.number().finite(),
    totalOwnerCommissionMinor: optionalMinorMoneySchema,
    totalEmployeeEarnings: z.number().finite(),
    totalEmployeeEarningsMinor: optionalMinorMoneySchema,
    averageTicketSize: z.number().finite(),
    averageTicketSizeMinor: optionalMinorMoneySchema,
    workingDays: z.number().int().nonnegative(),
  })
  .passthrough();

const weeklyReportDocumentSchema = z
  .object({
    id: z.string().trim().min(1),
    ownerId: z.string().trim().min(1),
    storeId: z.string().trim().min(1),
    weekStartDate: z.string().refine(isValidWorkDate),
    weekEndDate: z.string().refine(isValidWorkDate),
    year: z.number().int(),
    weekNumber: z.number().int().min(1).max(53),
    isPartial: z.boolean(),
    currency: z.string().trim().min(1).optional(),
    moneyScale: z.number().int().positive().optional(),
    summary: weeklyReportSummarySchema,
    dailyMetrics: z.array(weeklyReportDailyMetricSchema),
    employeeBreakdowns: z.array(weeklyReportEmployeeBreakdownSchema),
    dailyEmployeeBreakdowns: z.array(weeklyReportDailyEmployeeBreakdownSchema).optional(),
    serviceBreakdowns: z.array(weeklyReportServiceBreakdownSchema),
    dailyServiceBreakdowns: z.array(weeklyReportDailyServiceBreakdownSchema).optional(),
    generatedAt: z.number().int().nonnegative(),
    generatedByUserId: z.string().trim().min(1),
    sourceClosingIds: z.array(z.string().trim().min(1)),
    revision: z.number().int().positive(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .passthrough();

const getStoreWeeklyReports = (firestoreDatabase: Firestore, storeId: string) =>
  getStoreSubcollection(firestoreDatabase, storeId, WEEKLY_REPORTS_SUBCOLLECTION);

const readValidatedWeeklyReportDocument = (
  weeklyReportDocument: DocumentSnapshot,
  ownerId: string,
  storeId: string,
): WeeklyReportType | null => {
  if (!weeklyReportDocument.exists) {
    return null;
  }

  const weeklyReportParseResult = weeklyReportDocumentSchema.safeParse(weeklyReportDocument.data());

  if (!weeklyReportParseResult.success) {
    throw new FirestoreDataValidationError("Stored weekly report data is invalid");
  }

  const weeklyReport = weeklyReportParseResult.data;

  if (weeklyReport.ownerId !== ownerId || weeklyReport.storeId !== storeId) {
    return null;
  }

  if (weeklyReport.id !== weeklyReportDocument.id) {
    throw new FirestoreDataValidationError("Stored weekly report does not match its document path");
  }

  if (weeklyReport.weekEndDate !== getWeekEndDate(weeklyReport.weekStartDate)) {
    throw new FirestoreDataValidationError("Stored weekly report date range is invalid");
  }

  return weeklyReport;
};

export const getWeeklyReportFactory = (firestoreDatabase: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    weekStartDate: string,
  ): Promise<WeeklyReportType | null> => {
    if (
      ownerId.trim().length === 0 ||
      storeId.trim().length === 0 ||
      !isValidWorkDate(weekStartDate)
    ) {
      throw new FirestoreDataValidationError("Invalid weekly report lookup");
    }

    const weeklyReportCollection = getStoreWeeklyReports(firestoreDatabase, storeId);
    const weeklyReportDocumentId = `${storeId}__${weekStartDate}`;
    const weeklyReportDocument = await weeklyReportCollection
      .doc(weeklyReportDocumentId)
      .get();
    const weeklyReport = readValidatedWeeklyReportDocument(
      weeklyReportDocument,
      ownerId,
      storeId,
    );

    if (weeklyReport !== null) {
      return weeklyReport;
    }

    const legacyWeeklyReportSnapshot = await weeklyReportCollection
      .where("weekStartDate", "==", weekStartDate)
      .limit(1)
      .get();
    const legacyWeeklyReportDocument = legacyWeeklyReportSnapshot.docs[0];

    if (legacyWeeklyReportDocument === undefined) {
      return null;
    }

    return readValidatedWeeklyReportDocument(legacyWeeklyReportDocument, ownerId, storeId);
  };
};

export const createWeeklyReportFactory = (firestoreDatabase: Firestore) => {
  return async (
    ownerId: string,
    weeklyReportDraft: Omit<WeeklyReportType, "id" | "ownerId" | "createdAt" | "updatedAt">,
  ): Promise<string> => {
    if (weeklyReportDraft.weekEndDate !== getWeekEndDate(weeklyReportDraft.weekStartDate)) {
      throw new FirestoreDataValidationError("Weekly report date range is invalid");
    }

    const weeklyReportDocumentId = `${weeklyReportDraft.storeId}__${weeklyReportDraft.weekStartDate}`;
    const weeklyReportDocument = getStoreWeeklyReports(
      firestoreDatabase,
      weeklyReportDraft.storeId,
    ).doc(weeklyReportDocumentId);
    const timestamp = Date.now();
    const storedWeeklyReport = {
      id: weeklyReportDocumentId,
      ownerId,
      ...weeklyReportDraft,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const weeklyReportParseResult = weeklyReportDocumentSchema.safeParse(storedWeeklyReport);

    if (!weeklyReportParseResult.success) {
      throw new FirestoreDataValidationError("Weekly report write payload is invalid");
    }

    await weeklyReportDocument.set(weeklyReportParseResult.data);
    await cacheDeleteByPrefix(getEmployeeReportResponseCachePrefix(ownerId));

    return weeklyReportDocumentId;
  };
};

export const deleteWeeklyReportsByWeekFactory = (firestoreDatabase: Firestore) => {
  return async (storeId: string, weekStartDate: string): Promise<void> => {
    if (storeId.trim().length === 0 || !isValidWorkDate(weekStartDate)) {
      throw new FirestoreDataValidationError("Invalid weekly report delete scope");
    }

    const weeklyReportDocumentId = `${storeId}__${weekStartDate}`;
    await getStoreWeeklyReports(firestoreDatabase, storeId).doc(weeklyReportDocumentId).delete();
  };
};

export const listWeeklyReportsFactory = (firestoreDatabase: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    fromWeek: string,
    toWeek: string,
  ): Promise<WeeklyReportType[]> => {
    if (
      ownerId.trim().length === 0 ||
      storeId.trim().length === 0 ||
      !isValidWorkDate(fromWeek) ||
      !isValidWorkDate(toWeek) ||
      fromWeek > toWeek
    ) {
      throw new FirestoreDataValidationError("Invalid weekly report range");
    }

    const weeklyReportSnapshot = await getStoreWeeklyReports(firestoreDatabase, storeId)
      .where("weekStartDate", ">=", fromWeek)
      .where("weekStartDate", "<=", toWeek)
      .orderBy("weekStartDate", "asc")
      .limit(WEEKLY_REPORT_LIST_LIMIT)
      .get();
    const weeklyReports: WeeklyReportType[] = [];

    for (const weeklyReportDocument of weeklyReportSnapshot.docs) {
      const weeklyReport = readValidatedWeeklyReportDocument(
        weeklyReportDocument,
        ownerId,
        storeId,
      );

      if (weeklyReport !== null) {
        weeklyReports.push(weeklyReport);
      }
    }

    return weeklyReports;
  };
};
