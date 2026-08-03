import { Firestore } from "@google-cloud/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheDeleteMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/repository/cache/cache-client.js", () => ({
  cacheDelete: cacheDeleteMock,
  cacheDeleteByPrefix: vi.fn().mockResolvedValue(undefined),
  cacheGetJson: vi.fn().mockResolvedValue(undefined),
  cacheSetJson: vi.fn().mockResolvedValue(undefined),
  runSingleFlight: vi.fn((_key: string, operation: () => Promise<unknown>) => operation()),
}));

import { updateOwnerDataRetentionPolicyFactory } from "../../src/repository/firestore/data-retention/data-retention.repository.js";

const createFirestoreWithOwner = () => {
  const setUserDocument = vi.fn().mockResolvedValue(undefined);
  const getUserDocument = vi.fn().mockResolvedValue({ exists: true });
  const firestoreDB = new Firestore({ projectId: "test-project" });

  Reflect.set(
    firestoreDB,
    "collection",
    vi.fn(() => ({
      doc: vi.fn(() => ({
        get: getUserDocument,
        set: setUserDocument,
      })),
    })),
  );

  return { firestoreDB, setUserDocument };
};

describe("data retention policy repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the Firestore commit before traced sign-in cache invalidation", async () => {
    const { firestoreDB, setUserDocument } = createFirestoreWithOwner();
    const calls: string[] = [];
    setUserDocument.mockImplementationOnce(async () => {
      calls.push("firestore");
    });
    const onCommitted = vi.fn(() => calls.push("committed"));
    const runSigninCacheInvalidation = vi.fn(async (invalidate: () => Promise<void>) => {
      calls.push("cache-start");
      await invalidate();
      calls.push("cache-end");
    });

    await updateOwnerDataRetentionPolicyFactory(firestoreDB)(
      "owner-1",
      {
        dataRetentionPlan: "premium",
        dataRetentionPlanChangedAt: 123,
        updatedAt: 123,
        updatedByUserId: "owner-1",
      },
      { onCommitted, runSigninCacheInvalidation },
    );

    expect(calls).toEqual(["firestore", "committed", "cache-start", "cache-end"]);
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(runSigninCacheInvalidation).toHaveBeenCalledOnce();
    expect(cacheDeleteMock).toHaveBeenCalledWith("auth:signin-user:owner-1");
  });

  it("does not let an observability callback failure change persistence behavior", async () => {
    const { firestoreDB, setUserDocument } = createFirestoreWithOwner();

    await expect(
      updateOwnerDataRetentionPolicyFactory(firestoreDB)(
        "owner-1",
        {
          dataRetentionPlan: "standard",
          dataRetentionPlanChangedAt: 123,
          dataRetentionStandardEligibleAt: 456,
          updatedAt: 123,
          updatedByUserId: "owner-1",
        },
        {
          onCommitted: () => {
            throw new Error("telemetry unavailable");
          },
        },
      ),
    ).resolves.toBeUndefined();

    expect(setUserDocument).toHaveBeenCalledOnce();
    expect(cacheDeleteMock).toHaveBeenCalledOnce();
  });
});
