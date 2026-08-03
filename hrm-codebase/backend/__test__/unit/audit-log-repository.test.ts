import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it, vi } from "vitest";
import { FirestoreDataValidationError } from "../../src/constants/firestore-error.js";
import {
  createShopAuditLogFactory,
  listShopAuditLogsFactory,
} from "../../src/repository/firestore/shop/shop-audit-log-factory.js";

const createFirestoreForAuditLogList = (documents: Array<Record<string, unknown>>) => {
  const getAuditLogDocuments = vi.fn().mockResolvedValue({
    docs: documents.map((data, index) => ({
      id: (data["id"] as string | undefined) ?? `audit-log-${index + 1}`,
      ref: { path: `audit_logs/audit-log-${index + 1}` },
      data: () => data,
    })),
  });
  const auditLogQuery = {
    get: getAuditLogDocuments,
    limit: vi.fn(),
    orderBy: vi.fn(),
    where: vi.fn(),
  };
  auditLogQuery.limit.mockReturnValue(auditLogQuery);
  auditLogQuery.orderBy.mockReturnValue(auditLogQuery);
  auditLogQuery.where.mockReturnValue(auditLogQuery);
  const firestoreDB = new Firestore({ projectId: "test-project" });

  Reflect.set(
    firestoreDB,
    "collection",
    vi.fn(() => auditLogQuery),
  );

  return { firestoreDB, getAuditLogDocuments, auditLogQuery };
};

const validAuditLogDocument = {
  id: "audit-log-1",
  ownerId: "owner-1",
  eventType: "attendance_created",
  entityType: "attendance",
  entityId: "attendance-1",
  storeId: "store-1",
  actorUserId: "employee-1",
  actorRole: "employee",
  createdAt: 100,
};

describe("audit log repository", () => {
  it("lists audit logs ordered by createdAt with the requested limit", async () => {
    const { firestoreDB, auditLogQuery } = createFirestoreForAuditLogList([
      validAuditLogDocument,
    ]);
    const listShopAuditLogs = listShopAuditLogsFactory(firestoreDB);

    const auditLogs = await listShopAuditLogs("owner-1", 10);

    expect(auditLogQuery.where).toHaveBeenCalledWith("ownerId", "==", "owner-1");
    expect(auditLogQuery.orderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(auditLogQuery.limit).toHaveBeenCalledWith(10);
    expect(auditLogs).toEqual([
      {
        id: "audit-log-1",
        ownerId: "owner-1",
        eventType: "attendance_created",
        entityType: "attendance",
        entityId: "attendance-1",
        storeId: "store-1",
        actorUserId: "employee-1",
        actorRole: "employee",
        createdAt: 100,
      },
    ]);
  });

  it("rejects stored documents that fail schema validation", async () => {
    const { firestoreDB } = createFirestoreForAuditLogList([
      { ...validAuditLogDocument, createdAt: "not-a-number" },
    ]);
    const listShopAuditLogs = listShopAuditLogsFactory(firestoreDB);

    await expect(listShopAuditLogs("owner-1", 10)).rejects.toThrow(
      FirestoreDataValidationError,
    );
  });

  it("rejects stored documents whose ownerId does not match the query owner", async () => {
    const { firestoreDB } = createFirestoreForAuditLogList([
      { ...validAuditLogDocument, ownerId: "owner-2" },
    ]);
    const listShopAuditLogs = listShopAuditLogsFactory(firestoreDB);

    await expect(listShopAuditLogs("owner-1", 10)).rejects.toThrow(
      FirestoreDataValidationError,
    );
  });

  it("keeps unknown event types so the notification mapper can skip them", async () => {
    const { firestoreDB } = createFirestoreForAuditLogList([
      { ...validAuditLogDocument, eventType: "future_event_type" },
    ]);
    const listShopAuditLogs = listShopAuditLogsFactory(firestoreDB);

    const auditLogs = await listShopAuditLogs("owner-1", 10);

    expect(auditLogs[0]?.eventType).toBe("future_event_type");
  });

  it("writes audit logs with a server-side timestamp and returns the new id", async () => {
    const auditLogDocumentSet = vi.fn().mockResolvedValue(undefined);
    const firestoreDB = new Firestore({ projectId: "test-project" });

    Reflect.set(
      firestoreDB,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          id: "audit-log-2",
          set: auditLogDocumentSet,
        })),
      })),
    );

    const createShopAuditLog = createShopAuditLogFactory(firestoreDB);

    const auditLogId = await createShopAuditLog("owner-1", {
      eventType: "attendance_created",
      entityType: "attendance",
      entityId: "attendance-2",
      storeId: "store-1",
      actorUserId: "employee-1",
      actorRole: "employee",
    });

    expect(auditLogId).toBe("audit-log-2");
    expect(auditLogDocumentSet).toHaveBeenCalledOnce();
    expect(auditLogDocumentSet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-log-2",
        ownerId: "owner-1",
        eventType: "attendance_created",
        entityType: "attendance",
        storeId: "store-1",
        createdAt: expect.any(Number),
      }),
    );
  });
});
