import type { ShopWorkDaySettlementStatusType } from "./shop.types.js";

export type WorkDaySettlementCommitStage =
  | "employee_closing"
  | "aggregate_mark"
  | "aggregate_prepared"
  | "store_closing"
  | "closed_recalculation"
  | "aggregate_deleted";

export type WorkDaySettlementPersistAction = "create" | "overwrite" | "delete" | "skip";

export type WorkDaySettlementCommit = {
  stage: WorkDaySettlementCommitStage;
  persistAction: WorkDaySettlementPersistAction;
  statusBefore?: ShopWorkDaySettlementStatusType | "missing";
  statusAfter?: ShopWorkDaySettlementStatusType;
  revisionBefore?: number;
  revisionAfter?: number;
};

export type WorkDaySettlementCommitObserver = (commit: WorkDaySettlementCommit) => void;

export const notifyWorkDaySettlementCommit = (
  observer: WorkDaySettlementCommitObserver | undefined,
  commit: WorkDaySettlementCommit,
): void => {
  if (observer === undefined) {
    return;
  }

  try {
    observer(commit);
  } catch {
    // Observability callbacks must never change persistence or API behavior.
  }
};
