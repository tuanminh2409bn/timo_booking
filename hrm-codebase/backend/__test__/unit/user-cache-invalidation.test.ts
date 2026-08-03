import { beforeEach, describe, expect, it, vi } from "vitest";
import { Firestore } from "@google-cloud/firestore";

const cacheDeleteMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const cacheDeleteByPrefixMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/repository/cache/cache-client.js", () => ({
  cacheDelete: cacheDeleteMock,
  cacheDeleteByPrefix: cacheDeleteByPrefixMock,
  cacheGetJson: vi.fn().mockResolvedValue(undefined),
  cacheSetJson: vi.fn().mockResolvedValue(undefined),
  runSingleFlight: vi.fn((_key: string, operation: () => Promise<unknown>) => operation()),
}));

import { updateUserFactory } from "../../src/repository/firestore/user/user-factory.js";

const createFirestoreWithUser = (user: Record<string, unknown>) => {
  const setUserDocument = vi.fn().mockResolvedValue(undefined);
  const userDocument = {
    exists: true,
    data: () => user,
    ref: {
      path: "users/staff-1",
      set: setUserDocument,
    },
  };
  const firestoreDB = new Firestore({ projectId: "test-project" });

  Reflect.set(
    firestoreDB,
    "collection",
    vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue(userDocument),
      })),
    })),
  );

  return { firestoreDB, setUserDocument };
};

describe("employee cache invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not invalidate settlement responses when only serviceIds change", async () => {
    const { firestoreDB, setUserDocument } = createFirestoreWithUser({
      email: "staff@example.com",
      ownerId: "owner-1",
      active: true,
      role: "employee",
      storeId: "store-1",
      serviceIds: [],
    });

    await updateUserFactory(firestoreDB)("staff-1", {
      serviceIds: ["service-1"],
      updatedAt: 123,
      updatedByUserId: "owner-1",
    });

    expect(setUserDocument).toHaveBeenCalledOnce();
    expect(cacheDeleteMock).toHaveBeenCalledWith("store:owner-1:employee:active");
    expect(cacheDeleteByPrefixMock).toHaveBeenCalledWith("store:owner-1:employee:list");
    expect(cacheDeleteByPrefixMock).not.toHaveBeenCalledWith(
      "store:owner-1:response:settlement-list:",
    );
    expect(cacheDeleteByPrefixMock).not.toHaveBeenCalledWith(
      "store:owner-1:response:settlement-preview:",
    );
  });

  it("does not invalidate removed settlement response caches for employee changes", async () => {
    const { firestoreDB } = createFirestoreWithUser({
      email: "staff@example.com",
      ownerId: "owner-1",
      active: true,
      role: "employee",
      storeId: "store-1",
    });

    await updateUserFactory(firestoreDB)("staff-1", {
      name: "Updated Staff",
      updatedAt: 123,
      updatedByUserId: "owner-1",
    });

    expect(cacheDeleteMock).toHaveBeenCalledWith("store:owner-1:employee:active");
    expect(cacheDeleteByPrefixMock).toHaveBeenCalledWith("store:owner-1:employee:list");
    expect(cacheDeleteByPrefixMock).not.toHaveBeenCalledWith(
      "store:owner-1:response:settlement-list:",
    );
    expect(cacheDeleteByPrefixMock).not.toHaveBeenCalledWith(
      "store:owner-1:response:settlement-preview:",
    );
  });
});
