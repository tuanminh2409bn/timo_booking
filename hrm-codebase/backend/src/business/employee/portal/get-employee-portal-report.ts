import type { Request, Response } from "express";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import {
  normalizeBusinessTimeZone,
  normalizeSettlementCutoffTime,
} from "../../../helpers/business-day.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { can } from "../../../helpers/permissions.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { ServerTiming } from "../../../modules/server-timing.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { toPublicStoreId } from "../../shop/stores/store-response.js";
import {
  normalizeAttendanceForResponse,
  toFrontendAttendanceItem,
} from "../domain/attendance-presentation.js";
import {
  buildEmployeePortalReportSummary,
  isAttendanceAssignedToEmployee,
  resolveEmployeePortalDateRange,
  toFrontendDailySettlement,
} from "../domain/employee-portal-shared.js";
import { getWeeksInRange, isCurrentWeek } from "../../../helpers/weekly-report-generator.js";
import { getOrGenerate } from "../../../helpers/weekly-report-provider.js";
import type { WeeklyReportType } from "../../../repository/firestore/shop/weekly-report.types.js";
import { addMoney } from "../../../helpers/money.js";
import {
  canUseWeeklyReportForRange,
  getRawDateRanges,
  getWeeklyMoney,
} from "../domain/weekly-report-reader.js";
import { getSubmittedEmployeeUserIds } from "../../../helpers/work-day-settlement.js";

const SERVICE_ERRORS = {
  forbiddenRole: {
    statusCode: 403,
    type: "/me/report/forbidden-role",
    message: "Forbidden: employee report is available for store-scoped employees only",
  },
  invalidRequest: {
    statusCode: 400,
    type: "/me/report/invalid-request",
    message: "Invalid request",
  },
};

const getCompletedWeeksOverlappingRange = (fromWorkDate: string, toWorkDate: string): string[] => {
  const weeks = getWeeksInRange(fromWorkDate, toWorkDate);
  return weeks.filter((week) => !isCurrentWeek(week));
};

const buildEmployeePortalWeeklySummary = (
  reports: WeeklyReportType[],
  employeeUserId: string,
  fromWorkDate: string,
  toWorkDate: string,
) => {
  const summary = reports
    .flatMap((report) =>
      (Array.isArray(report.dailyEmployeeBreakdowns)
        ? report.dailyEmployeeBreakdowns.filter(
            (breakdown) => breakdown.workDate >= fromWorkDate && breakdown.workDate <= toWorkDate,
          )
        : report.employeeBreakdowns
      ).map((breakdown) => ({ report, breakdown })),
    )
    .filter(({ breakdown }) => breakdown.employeeUserId === employeeUserId)
    .reduce(
      (summaryAccumulator, { report, breakdown }) => {
        const settledRevenue = getWeeklyMoney(
          report,
          breakdown.totalRevenue,
          breakdown.totalRevenueMinor,
        );
        const settledDiscount = getWeeklyMoney(
          report,
          breakdown.totalDiscountAllocated,
          breakdown.totalDiscountAllocatedMinor,
        );
        const settledEarning = getWeeklyMoney(
          report,
          breakdown.totalEarnings,
          breakdown.totalEarningsMinor,
        );

        return {
          attendanceCount: summaryAccumulator.attendanceCount + breakdown.totalAttendances,
          serviceCount: summaryAccumulator.serviceCount,
          settledRevenue: addMoney(summaryAccumulator.settledRevenue, settledRevenue),
          settledDiscount: addMoney(summaryAccumulator.settledDiscount, settledDiscount),
          settledEarning: addMoney(summaryAccumulator.settledEarning, settledEarning),
          settledDayCount: summaryAccumulator.settledDayCount + breakdown.workingDays,
          totalWorkedMinutes:
            summaryAccumulator.totalWorkedMinutes + (breakdown.totalWorkedMinutes ?? 0),
          openAttendanceCount: 0,
          closedAttendanceCount:
            summaryAccumulator.closedAttendanceCount + breakdown.totalAttendances,
        };
      },
      {
        attendanceCount: 0,
        serviceCount: 0,
        settledRevenue: 0,
        settledDiscount: 0,
        settledEarning: 0,
        settledDayCount: 0,
        totalWorkedMinutes: 0,
        openAttendanceCount: 0,
        closedAttendanceCount: 0,
      },
    );

  return summary;
};

const mergeEmployeePortalSummaries = (
  left: ReturnType<typeof buildEmployeePortalWeeklySummary>,
  right: ReturnType<typeof buildEmployeePortalReportSummary>,
) => ({
  attendanceCount: left.attendanceCount + right.attendanceCount,
  serviceCount: left.serviceCount + right.serviceCount,
  settledRevenue: addMoney(left.settledRevenue, right.settledRevenue),
  settledDiscount: addMoney(left.settledDiscount, right.settledDiscount),
  settledEarning: addMoney(left.settledEarning, right.settledEarning),
  settledDayCount: left.settledDayCount + right.settledDayCount,
  totalWorkedMinutes: left.totalWorkedMinutes + right.totalWorkedMinutes,
  openAttendanceCount: left.openAttendanceCount + right.openAttendanceCount,
  closedAttendanceCount: left.closedAttendanceCount + right.closedAttendanceCount,
});

export const getEmployeePortalReport = async (req: Request, res: Response) => {
  const timing = new ServerTiming();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(req.headers["authorization"]),
  );

  const storeId = authContext.storeId;

  if (!can(authContext.role, "employeePortal:use") || !storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  const dateRange = resolveEmployeePortalDateRange(req.query);

  if (!dateRange) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "invalid date range",
    });
  }

  // Scope check bằng chính document của caller (1 doc get) thay vì tải cả danh sách nhân
  // viên của owner. Chạy TRƯỚC mọi nhánh đọc dữ liệu — kể cả nhánh weekly report (trước
  // đây nhánh đó bỏ sót check khi weekly reports phủ đủ range). Store đọc kèm (cache 60s)
  // vì FE cần timezone/cutoff để tính work date mà không phải gọi form-options.
  const [employee, store] = await timing.measure("scope", () =>
    Promise.all([
      firestoreRepository.user.getUser(authContext.uid).catch((error: unknown) => {
        if (error instanceof FirestoreDataNotFoundError) return null;
        throw error;
      }),
      firestoreRepository.shop.store.getStore(authContext.ownerId, storeId).catch((error: unknown) => {
        if (error instanceof FirestoreDataNotFoundError) return null;
        throw error;
      }),
    ]),
  );

  if (
    employee === null ||
    !employee.active ||
    employee.ownerId !== authContext.ownerId ||
    !("storeId" in employee) ||
    employee.storeId !== storeId
  ) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, {
      reason: "employee not in store scope",
      role: authContext.role,
    });
  }

  // FE home cần compensationModel (gate thẻ chấm giờ) + store timezone/cutoff (tính work
  // date) — trả từ các document đã đọc, để FE không phải gọi form-options ở home/earnings.
  const employeeResponseBlock = {
    id: employee.uid,
    name: employee.name?.trim() || employee.displayName?.trim() || employee.email,
    compensationModel:
      employee.compensationModel ?? (employee.hourlyRate !== undefined ? "hourly" : "commission"),
    ...(employee.fixedSalary !== undefined && { fixedSalary: employee.fixedSalary }),
    ...(employee.hourlyRate !== undefined && { hourlyRate: employee.hourlyRate }),
  };
  const storeResponseBlock =
    store === null
      ? undefined
      : {
          id: store.id,
          name: store.name,
          settlementCutoffTime: normalizeSettlementCutoffTime(store.settlementCutoffTime),
          timezone: normalizeBusinessTimeZone(store.timezone),
        };

  const summaryOnly = req.query["summaryOnly"] === "true" || req.query["includeItems"] === "false";
  const completedWeeks = getCompletedWeeksOverlappingRange(
    dateRange.fromWorkDate,
    dateRange.toWorkDate,
  );

  if (summaryOnly && completedWeeks.length > 0) {
    const weeklyReports = await timing.measure("weekly_reports", () =>
      Promise.all(
        completedWeeks.map((weekStartDate) =>
          getOrGenerate(authContext.ownerId, storeId, weekStartDate, authContext.uid),
        ),
      ),
    );
    const usableWeeklyReports = weeklyReports.filter((report) =>
      canUseWeeklyReportForRange(report, dateRange.fromWorkDate, dateRange.toWorkDate),
    );
    const rawDateRanges = getRawDateRanges(
      dateRange.fromWorkDate,
      dateRange.toWorkDate,
      usableWeeklyReports.map((report) => report.weekStartDate),
    );
    let rawReport = {
      attendanceCount: 0,
      serviceCount: 0,
      settledRevenue: 0,
      settledDiscount: 0,
      settledEarning: 0,
      settledDayCount: 0,
      totalWorkedMinutes: 0,
      openAttendanceCount: 0,
      closedAttendanceCount: 0,
    };

    if (rawDateRanges.length > 0) {
      const [attendanceChunks, settlementChunks] = await timing.measure("raw_ranges", () =>
        Promise.all([
          Promise.all(
            rawDateRanges.map((range) =>
              firestoreRepository.shop.attendance.listShopAttendanceByEmployeeDateRange(
                authContext.ownerId,
                storeId,
                authContext.uid,
                range.fromWorkDate,
                range.toWorkDate,
              ),
            ),
          ),
          Promise.all(
            rawDateRanges.map((range) =>
              firestoreRepository.shop.settlement.listClosedWorkDaySettlementFinancialProjectionByStoreDateRange(
                authContext.ownerId,
                storeId,
                range.fromWorkDate,
                range.toWorkDate,
              ),
            ),
          ),
        ]),
      );
      const employeeAttendances = attendanceChunks
        .flat()
        .filter((attendance) => isAttendanceAssignedToEmployee(attendance, authContext.uid))
        .map(normalizeAttendanceForResponse);
      const employeeSettlements = settlementChunks
        .flat()
        .filter((settlement) =>
          settlement.preview.employeeSummaries.some(
            (summary) => summary.employeeUserId === authContext.uid,
          ),
        );
      rawReport = buildEmployeePortalReportSummary(
        employeeAttendances,
        employeeSettlements,
        authContext.uid,
      );
    }

    const weeklyReport = buildEmployeePortalWeeklySummary(
      usableWeeklyReports,
      authContext.uid,
      dateRange.fromWorkDate,
      dateRange.toWorkDate,
    );
    const report = mergeEmployeePortalSummaries(weeklyReport, rawReport);

    res.setHeader("Server-Timing", timing.header());
    res.locals["serverTiming"] = timing.toObject();
    return sendCacheableJson(
      req,
      res,
      {
        report,
        items: [],
        dailySettlements: [],
        employee: employeeResponseBlock,
        ...(storeResponseBlock !== undefined && { store: storeResponseBlock }),
        meta: {
          ownerId: authContext.ownerId,
          employeeUserId: authContext.uid,
          storeId: toPublicStoreId(storeId),
          fromWorkDate: dateRange.fromWorkDate,
          toWorkDate: dateRange.toWorkDate,
          rangeDayCount: dateRange.rangeDayCount,
          summaryOnly: true,
          source: rawDateRanges.length > 0 ? "weekly-report-hybrid" : "weekly-report",
          weeklyReportsUsed: usableWeeklyReports.length,
          rawDateRangesUsed: rawDateRanges,
          rawDateRangeCount: rawDateRanges.length,
        },
      },
      {
        cacheControl: "private, max-age=10, stale-while-revalidate=20",
      },
    );
  }

  // Attendance query đã scope theo employee (array-contains assigneeUserIds + workDate range,
  // index có sẵn) — không tải attendance cả store rồi lọc bằng Node nữa.
  const [attendances, employeeWorkDayClosings, workDaySettlements] = await timing.measure(
    "query",
    () =>
      Promise.all([
        firestoreRepository.shop.attendance.listShopAttendanceByEmployeeDateRange(
          authContext.ownerId,
          storeId,
          authContext.uid,
          dateRange.fromWorkDate,
          dateRange.toWorkDate,
        ),
        firestoreRepository.shop.session.listEmployeeWorkDayClosingsByStoreDateRange(
          authContext.ownerId,
          storeId,
          dateRange.fromWorkDate,
          dateRange.toWorkDate,
        ),
        firestoreRepository.shop.settlement.listClosedWorkDaySettlementFinancialProjectionByStoreDateRange(
          authContext.ownerId,
          storeId,
          dateRange.fromWorkDate,
          dateRange.toWorkDate,
        ),
      ]),
  );

  const response = timing.measureSync("map", () => {
    const employeeAttendances = attendances
      .filter((attendance) => isAttendanceAssignedToEmployee(attendance, authContext.uid))
      .map(normalizeAttendanceForResponse);
    const employeeSettlements = workDaySettlements.filter((settlement) =>
      settlement.preview.employeeSummaries.some(
        (summary) => summary.employeeUserId === authContext.uid,
      ),
    );
    const dailySettlements = employeeSettlements.map(toFrontendDailySettlement);
    const report = buildEmployeePortalReportSummary(
      employeeAttendances,
      employeeSettlements,
      authContext.uid,
    );
    const currentEmployeeWorkDayClosings = employeeWorkDayClosings.filter(
      (closing) =>
        closing.employeeUserId === authContext.uid &&
        getSubmittedEmployeeUserIds(
          employeeAttendances.filter((attendance) => attendance.workDate === closing.workDate),
          [closing],
        ).includes(authContext.uid),
    );

    return {
      report,
      items: employeeAttendances.map((attendance) =>
        toFrontendAttendanceItem(attendance, {
          redactCustomerInfo: authContext.role === "employee",
        }),
      ),
      dailySettlements,
      employeeWorkDayClosings: currentEmployeeWorkDayClosings.map((closing) => ({
        id: closing.id,
        workDate: closing.workDate,
        attendanceCount: closing.attendanceIds.length,
        closedAt: closing.closedAt,
      })),
      employee: employeeResponseBlock,
      ...(storeResponseBlock !== undefined && { store: storeResponseBlock }),
      meta: {
        ownerId: authContext.ownerId,
        employeeUserId: authContext.uid,
        storeId: toPublicStoreId(storeId),
        fromWorkDate: dateRange.fromWorkDate,
        toWorkDate: dateRange.toWorkDate,
        rangeDayCount: dateRange.rangeDayCount,
      },
    };
  });

  res.setHeader("Server-Timing", timing.header());
  res.locals["serverTiming"] = timing.toObject();
  return sendCacheableJson(req, res, response, {
    cacheControl: "private, max-age=10, stale-while-revalidate=20",
  });
};
