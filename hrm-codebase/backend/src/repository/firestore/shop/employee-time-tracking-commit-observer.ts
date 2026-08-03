export type EmployeeTimeTrackingPersistAction = "create" | "update";
export type EmployeeTimeTrackingStatus = "missing" | "working" | "completed";
export type EmployeeTimeTrackingCommit = {
  action: "check_in" | "check_out";
  persistAction: EmployeeTimeTrackingPersistAction;
  statusBefore: EmployeeTimeTrackingStatus;
  statusAfter: Exclude<EmployeeTimeTrackingStatus, "missing">;
  storeId: string;
  workDate: string;
};

export type EmployeeTimeTrackingCommitObserver = (commit: EmployeeTimeTrackingCommit) => void;

export const notifyEmployeeTimeTrackingCommit = (
  observer: EmployeeTimeTrackingCommitObserver | undefined,
  commit: EmployeeTimeTrackingCommit,
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
