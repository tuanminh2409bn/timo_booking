// Lấy-hoặc-sinh weekly report (lazy). Tầng NEUTRAL: chỉ phụ thuộc repository + helpers sinh/cache — KHÔNG
// phụ thuộc business context nào. Trước đây nằm trong business/shop/weekly-reports/weekly-report-shared.ts
// khiến employee/salary + employee/portal phải import chéo sang shop; chuyển ra đây để mọi consumer
// (shop lẫn employee) đọc qua tầng chung, hết cross-context import.
import { firestoreRepository } from "../repository/firestore/index.js";
import { generateWeeklyReport } from "./weekly-report-generator.js";
import { getOrGenerateWeeklyReport } from "./weekly-report-cache.js";
import type { WeeklyReportType } from "../repository/firestore/shop/weekly-report.types.js";

export const generateAndPersistWeeklyReport = async (
  ownerId: string,
  storeId: string,
  weekStartDate: string,
  generatedByUserId: string,
): Promise<WeeklyReportType> => {
  const weekEndDate = new Date(`${weekStartDate}T00:00:00.000Z`);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
  const weekEnd = weekEndDate.toISOString().slice(0, 10);

  const closedSettlements =
    await firestoreRepository.shop.settlement.listClosedWorkDaySettlementFinancialProjectionByStoreDateRange(
      ownerId,
      storeId,
      weekStartDate,
      weekEnd,
    );

  const draft = generateWeeklyReport(
    ownerId,
    storeId,
    weekStartDate,
    generatedByUserId,
    closedSettlements.map((settlement) => ({
      id: settlement.closing.id,
      workDate: settlement.workDate,
      employeeSummaries: settlement.preview.employeeSummaries,
      serviceSummaries: settlement.serviceSummaries,
      summary: settlement.closing.summary,
    })),
  );
  const reportId = await firestoreRepository.shop.weeklyReport.createWeeklyReport(
    ownerId,
    draft,
  );
  const timestamp = Date.now();

  return {
    id: reportId,
    ...draft,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const getOrGenerate = async (
  ownerId: string,
  storeId: string,
  weekStartDate: string,
  generatedByUserId: string,
): Promise<WeeklyReportType> => {
  const cached = await getOrGenerateWeeklyReport<WeeklyReportType | null>(
    ownerId,
    storeId,
    weekStartDate,
    async () => {
      const existing = await firestoreRepository.shop.weeklyReport.getWeeklyReport(
        ownerId,
        storeId,
        weekStartDate,
      );

      if (existing) {
        return existing;
      }

      return generateAndPersistWeeklyReport(ownerId, storeId, weekStartDate, generatedByUserId);
    },
  );

  if (!cached) {
    return generateAndPersistWeeklyReport(ownerId, storeId, weekStartDate, generatedByUserId);
  }

  return cached;
};
