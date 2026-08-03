import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it, vi } from "vitest";
import {
  getWeeklyReportFactory,
  listWeeklyReportsFactory,
} from "../../src/repository/firestore/shop/weekly-report.repository.js";
import type { WeeklyReportType } from "../../src/repository/firestore/shop/weekly-report.types.js";

const legacyWeeklyReport: WeeklyReportType = {
  id: "legacy-random-document-id",
  ownerId: "owner-1",
  storeId: "store-1",
  weekStartDate: "2026-07-20",
  weekEndDate: "2026-07-26",
  year: 2026,
  weekNumber: 30,
  isPartial: false,
  summary: {
    totalAttendances: 0,
    totalRevenue: 0,
    totalDiscount: 0,
    totalNetRevenue: 0,
    totalOwnerCommission: 0,
    totalEmployeeEarnings: 0,
    averageTicketSize: 0,
    workingDays: 0,
  },
  dailyMetrics: [],
  employeeBreakdowns: [],
  serviceBreakdowns: [],
  generatedAt: 1,
  generatedByUserId: "owner-1",
  sourceClosingIds: [],
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
};

describe("weekly report repository", () => {
  it("lists a valid legacy report whose document ID predates deterministic IDs", async () => {
    const query = {
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            id: legacyWeeklyReport.id,
            exists: true,
            data: () => legacyWeeklyReport,
          },
        ],
      }),
    };
    query.where.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const firestoreDatabase = new Firestore({ projectId: "test-project" });

    Reflect.set(
      firestoreDatabase,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => query),
        })),
      })),
    );

    const listWeeklyReports = listWeeklyReportsFactory(firestoreDatabase);

    await expect(
      listWeeklyReports("owner-1", "store-1", "2026-07-20", "2026-07-20"),
    ).resolves.toEqual([legacyWeeklyReport]);
  });

  it("falls back to a legacy week query when the deterministic document does not exist", async () => {
    const legacyQuery = {
      where: vi.fn(),
      limit: vi.fn(),
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            id: legacyWeeklyReport.id,
            exists: true,
            data: () => legacyWeeklyReport,
          },
        ],
      }),
    };
    legacyQuery.where.mockReturnValue(legacyQuery);
    legacyQuery.limit.mockReturnValue(legacyQuery);
    const weeklyReportCollection = {
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          id: "store-1__2026-07-20",
          exists: false,
          data: () => undefined,
        }),
      })),
      where: legacyQuery.where,
      limit: legacyQuery.limit,
      get: legacyQuery.get,
    };
    const firestoreDatabase = new Firestore({ projectId: "test-project" });

    Reflect.set(
      firestoreDatabase,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => weeklyReportCollection),
        })),
      })),
    );

    const getWeeklyReport = getWeeklyReportFactory(firestoreDatabase);

    await expect(getWeeklyReport("owner-1", "store-1", "2026-07-20")).resolves.toEqual(
      legacyWeeklyReport,
    );
    expect(weeklyReportCollection.where).toHaveBeenCalledWith("weekStartDate", "==", "2026-07-20");
  });
});
