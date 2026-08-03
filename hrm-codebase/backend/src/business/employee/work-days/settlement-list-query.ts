import { firestoreRepository } from "../../../repository/firestore/index.js";
import { runSingleFlight } from "../../../repository/cache/cache-client.js";
import type { ShopWorkDaySettlementListProjectionType } from "../../../repository/firestore/shop/shop.types.js";

export type SettlementCollectionQuery = {
  pageSize: number;
  cursorWorkDate?: string;
  cursorSettlementEligibleAt?: number;
};

export type SettlementCollectionItem = {
  workDate: string;
  status: ShopWorkDaySettlementListProjectionType["status"];
  attendance: {
    employeeTotalCount: number;
    employeeClosedCount: number;
  };
  employees: Array<{
    employeeUserId: string;
    employeeName?: string;
    attendanceCount: number;
    closedCount: number;
  }>;
};

export type SettlementCollectionResult = {
  items: SettlementCollectionItem[];
  nextCursorWorkDate: string | null;
  nextCursorSettlementEligibleAt: number | null;
  hasMore: boolean;
};

const toSettlementListItem = (
  settlement: ShopWorkDaySettlementListProjectionType,
): SettlementCollectionItem => ({
  workDate: settlement.workDate,
  status: settlement.status,
  attendance: {
    employeeTotalCount: settlement.attendance.employeeTotalCount,
    employeeClosedCount: settlement.attendance.employeeClosedCount,
  },
  employees: settlement.employees.map((employee) => ({
    employeeUserId: employee.employeeUserId,
    ...(employee.employeeName !== undefined && { employeeName: employee.employeeName }),
    attendanceCount: employee.attendanceCount,
    closedCount: employee.closedCount,
  })),
});

export const readClosedWorkDaySettlementCollection = async (
  ownerId: string,
  storeId: string,
  query: SettlementCollectionQuery,
): Promise<SettlementCollectionResult> => {
  const requestKey = [
    "settled-work-day-settlements",
    ownerId,
    storeId,
    query.pageSize,
    query.cursorWorkDate ?? "latest",
  ].join(":");

  return runSingleFlight(requestKey, async () => {
    const paginatedSettlements =
      await firestoreRepository.shop.settlement.listWorkDaySettlementsByStatusPaginated(
        ownerId,
        storeId,
        ["closed"],
        {
          limit: query.pageSize,
          ...(query.cursorWorkDate !== undefined && {
            cursorWorkDate: query.cursorWorkDate,
          }),
        },
      );

    return {
      items: paginatedSettlements.settlements.map(toSettlementListItem),
      nextCursorWorkDate: paginatedSettlements.nextCursor?.workDate ?? null,
      nextCursorSettlementEligibleAt: null,
      hasMore: paginatedSettlements.hasMore,
    };
  });
};

export const readUnsettledWorkDaySettlementCollection = async (
  ownerId: string,
  storeId: string,
  currentTimestamp: number,
  query: SettlementCollectionQuery,
): Promise<SettlementCollectionResult> => {
  const settlementEligibilityCutoffTimestamp = Math.floor(currentTimestamp / 1_000) * 1_000;
  const requestKey = [
    "unsettled-work-day-settlements",
    ownerId,
    storeId,
    settlementEligibilityCutoffTimestamp,
    query.pageSize,
    query.cursorWorkDate ?? "latest",
    query.cursorSettlementEligibleAt ?? "latest",
  ].join(":");

  return runSingleFlight(requestKey, async () => {
    const paginatedSettlements =
      await firestoreRepository.shop.settlement.listWorkDaySettlementsByStatusPaginated(
        ownerId,
        storeId,
        ["open", "ready"],
        {
          limit: query.pageSize,
          toSettlementEligibleAt: settlementEligibilityCutoffTimestamp,
          ...(query.cursorWorkDate !== undefined && {
            cursorWorkDate: query.cursorWorkDate,
          }),
          ...(query.cursorSettlementEligibleAt !== undefined && {
            cursorSettlementEligibleAt: query.cursorSettlementEligibleAt,
          }),
        },
      );

    return {
      items: paginatedSettlements.settlements.map(toSettlementListItem),
      nextCursorWorkDate: paginatedSettlements.nextCursor?.workDate ?? null,
      nextCursorSettlementEligibleAt: paginatedSettlements.nextCursor?.settlementEligibleAt ?? null,
      hasMore: paginatedSettlements.hasMore,
    };
  });
};

export const readLegacyUnsettledWorkDaySettlementCollection = async (
  ownerId: string,
  storeId: string,
  currentWorkDate: string,
  query: SettlementCollectionQuery,
): Promise<SettlementCollectionResult> => {
  const paginatedSettlements =
    await firestoreRepository.shop.settlement.listWorkDaySettlementsByStatusPaginated(
      ownerId,
      storeId,
      ["open", "ready"],
      {
        limit: query.pageSize,
        toWorkDate: currentWorkDate,
        ...(query.cursorWorkDate !== undefined && {
          cursorWorkDate: query.cursorWorkDate,
        }),
      },
    );

  return {
    items: paginatedSettlements.settlements.map(toSettlementListItem),
    nextCursorWorkDate: paginatedSettlements.nextCursor?.workDate ?? null,
    nextCursorSettlementEligibleAt: null,
    hasMore: paginatedSettlements.hasMore,
  };
};
