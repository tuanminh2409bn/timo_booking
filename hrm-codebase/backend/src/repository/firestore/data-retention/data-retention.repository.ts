import { FieldValue, type Firestore } from "@google-cloud/firestore";
import { DB_NOT_FOUND, FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { cacheDelete } from "../../cache/cache-client.js";
import { getSigninUserCacheKey } from "../user/user-factory.js";
import type { OwnerDataRetentionPlan } from "../user/user.types.js";
import {
  incrementArchivedAttendanceCounter,
  runAttendanceRetention,
} from "./data-retention-attendance-cleanup.js";
import {
  createStoreCleanupTraceState,
  createStoreDataRetentionResult,
  invalidateRetentionCaches,
  type StoreDataRetentionInput,
  type StoreDataRetentionResult,
} from "./data-retention-cleanup-shared.js";
import { runEmployeeClosingRetention } from "./data-retention-employee-closing-cleanup.js";
import { runSettlementRetention } from "./data-retention-settlement-cleanup.js";

const DEFAULT_BATCH_SIZE = 200;

export type OwnerDataRetentionPolicyUpdate = {
  dataRetentionPlan: OwnerDataRetentionPlan;
  dataRetentionPlanChangedAt: number;
  dataRetentionStandardEligibleAt?: number | undefined;
  updatedAt: number;
  updatedByUserId: string;
};

export type DataRetentionPolicyUpdateOptions = {
  onCommitted?: () => void;
  runSigninCacheInvalidation?: (invalidate: () => Promise<void>) => Promise<void>;
};

const notifyPolicyCommit = (observer: DataRetentionPolicyUpdateOptions["onCommitted"]): void => {
  if (observer === undefined) {
    return;
  }

  try {
    observer();
  } catch {
    // Observability callbacks must never change persistence behavior.
  }
};

export const updateOwnerDataRetentionPolicyFactory = (firestoreDB: Firestore) => {
  return async (
    uid: string,
    policy: OwnerDataRetentionPolicyUpdate,
    options: DataRetentionPolicyUpdateOptions = {},
  ): Promise<void> => {
    const userDocument = firestoreDB.collection("users").doc(uid);
    const userSnapshot = await userDocument.get();

    if (!userSnapshot.exists) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.user);
    }

    const firestorePatch: Record<string, unknown> = { ...policy };

    if (policy.dataRetentionStandardEligibleAt === undefined) {
      firestorePatch["dataRetentionStandardEligibleAt"] = FieldValue.delete();
    }

    try {
      await userDocument.set(firestorePatch, { merge: true });
      notifyPolicyCommit(options.onCommitted);

      const invalidateSigninCache = () => cacheDelete(getSigninUserCacheKey(uid));

      if (options.runSigninCacheInvalidation === undefined) {
        await invalidateSigninCache();
      } else {
        await options.runSigninCacheInvalidation(invalidateSigninCache);
      }
    } catch (error) {
      const isNotFoundError =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: number }).code === 5;

      if (isNotFoundError) {
        throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.user);
      }

      throw error;
    }
  };
};

export type OwnerDataRetentionPolicyRecord = {
  uid: string;
  ownerId: string;
  active: boolean;
  dataRetentionPlan?: OwnerDataRetentionPlan;
  dataRetentionPlanChangedAt?: number;
  dataRetentionStandardEligibleAt?: number;
};

export const listOwnerDataRetentionPoliciesFactory = (firestoreDB: Firestore) => {
  return async (): Promise<OwnerDataRetentionPolicyRecord[]> => {
    const snapshot = await firestoreDB.collection("users").where("role", "==", "owner").get();

    return snapshot.docs.flatMap((document) => {
      const data = document.data() as Record<string, unknown>;

      if (
        typeof data["ownerId"] !== "string" ||
        typeof data["active"] !== "boolean" ||
        (data["dataRetentionPlan"] !== undefined &&
          data["dataRetentionPlan"] !== "standard" &&
          data["dataRetentionPlan"] !== "premium")
      ) {
        return [];
      }

      return [
        {
          uid: document.id,
          ownerId: data["ownerId"],
          active: data["active"],
          ...(data["dataRetentionPlan"] !== undefined && {
            dataRetentionPlan: data["dataRetentionPlan"] as OwnerDataRetentionPlan,
          }),
          ...(typeof data["dataRetentionPlanChangedAt"] === "number" && {
            dataRetentionPlanChangedAt: data["dataRetentionPlanChangedAt"],
          }),
          ...(typeof data["dataRetentionStandardEligibleAt"] === "number" && {
            dataRetentionStandardEligibleAt: data["dataRetentionStandardEligibleAt"],
          }),
        },
      ];
    });
  };
};

export const runStoreDataRetentionFactory = (firestoreDB: Firestore) => {
  return async (input: StoreDataRetentionInput): Promise<StoreDataRetentionResult> => {
    const batchSize = Math.min(Math.max(input.batchSize ?? DEFAULT_BATCH_SIZE, 1), 200);
    const dryRun = input.dryRun === true;
    const result = createStoreDataRetentionResult();
    const state = createStoreCleanupTraceState();

    await runAttendanceRetention(firestoreDB, input, result, state, dryRun, batchSize);
    await runSettlementRetention(firestoreDB, input, result, state, dryRun);
    await runEmployeeClosingRetention(firestoreDB, input, result, state, dryRun);

    if (
      !dryRun &&
      result.attendanceDetailsDeleted === 0 &&
      result.employeeWorkDayClosingsDeleted > 0
    ) {
      await invalidateRetentionCaches(input, [], state);
    }

    result.lastCommittedStage = state.lastCommittedStage;
    return result;
  };
};

export { incrementArchivedAttendanceCounter };
export type { StoreDataRetentionInput, StoreDataRetentionResult };
