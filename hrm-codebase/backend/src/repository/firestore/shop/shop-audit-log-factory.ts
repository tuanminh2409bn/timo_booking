import type { Firestore } from "@google-cloud/firestore";
import { z } from "zod";
import { FirestoreDataValidationError } from "../../../constants/firestore-error.js";
import type { ShopAuditLogType } from "./shop.types.js";
import { toStoreScopedWritePayload } from "../store-document-mapper.js";

const AUDIT_LOGS_COLLECTION = "audit_logs";

// eventType/entityType chỉ validate non-empty string thay vì enum: document ghi
// bởi bản deploy mới hơn có thể mang event type mà build này chưa biết; mapper
// notification sẽ bỏ qua event lạ thay vì làm hỏng cả feed.
const auditLogDocumentSchema = z
  .object({
    ownerId: z.string().min(1),
    eventType: z.string().min(1),
    entityType: z.string().min(1),
    entityId: z.string().min(1).optional(),
    storeId: z.string().min(1).optional(),
    workDate: z.string().min(1).optional(),
    actorUserId: z.string().min(1).optional(),
    actorRole: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.number().int().nonnegative(),
  })
  .passthrough();

const getAuditLogCollection = (firestoreDB: Firestore) =>
  firestoreDB.collection(AUDIT_LOGS_COLLECTION);

export const createShopAuditLogFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    data: Omit<ShopAuditLogType, "id" | "ownerId" | "createdAt">,
  ): Promise<string> => {
    const auditLogDocument = getAuditLogCollection(firestoreDB).doc();
    const auditLog: ShopAuditLogType = {
      id: auditLogDocument.id,
      ownerId,
      ...data,
      createdAt: Date.now(),
    };

    await auditLogDocument.set(toStoreScopedWritePayload(ownerId, auditLog));

    return auditLogDocument.id;
  };
};

export const listShopAuditLogsFactory = (firestoreDB: Firestore) => {
  return async (ownerId: string, limit: number): Promise<ShopAuditLogType[]> => {
    const snapshot = await getAuditLogCollection(firestoreDB)
      .where("ownerId", "==", ownerId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((document) => {
      const auditLogParseResult = auditLogDocumentSchema.safeParse(document.data());

      if (!auditLogParseResult.success || auditLogParseResult.data.ownerId !== ownerId) {
        throw new FirestoreDataValidationError("Stored audit log data is invalid");
      }

      const auditLogData = auditLogParseResult.data;

      return {
        id: document.id,
        ownerId,
        eventType: auditLogData.eventType as ShopAuditLogType["eventType"],
        entityType: auditLogData.entityType as ShopAuditLogType["entityType"],
        ...(auditLogData.entityId !== undefined && { entityId: auditLogData.entityId }),
        ...(auditLogData.storeId !== undefined && { storeId: auditLogData.storeId }),
        ...(auditLogData.workDate !== undefined && { workDate: auditLogData.workDate }),
        ...(auditLogData.actorUserId !== undefined && { actorUserId: auditLogData.actorUserId }),
        ...(auditLogData.actorRole !== undefined && {
          actorRole: auditLogData.actorRole as NonNullable<ShopAuditLogType["actorRole"]>,
        }),
        ...(auditLogData.metadata !== undefined && { metadata: auditLogData.metadata }),
        createdAt: auditLogData.createdAt,
      };
    });
  };
};
