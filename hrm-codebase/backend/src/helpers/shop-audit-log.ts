import { firestoreRepository } from "../repository/firestore/index.js";
import type {
  ShopAuditLogEntityType,
  ShopAuditLogEventType,
} from "../repository/firestore/shop/shop.types.js";
import type { UserType } from "../repository/firestore/user/user.types.js";

type AuditActor = {
  uid?: string | undefined;
  role?: UserType["role"] | "system" | undefined;
};

type ShopAuditLogInput = {
  ownerId: string;
  eventType: ShopAuditLogEventType;
  entityType: ShopAuditLogEntityType;
  entityId?: string | undefined;
  storeId?: string | undefined;
  workDate?: string | undefined;
  actor?: AuditActor | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export const compactAuditMetadata = (
  metadata: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );

export const writeShopAuditLog = async ({
  ownerId,
  eventType,
  entityType,
  entityId,
  storeId,
  workDate,
  actor,
  metadata,
}: ShopAuditLogInput) => {
  await firestoreRepository.shop.audit.createShopAuditLog(ownerId, {
    eventType,
    entityType,
    ...(entityId !== undefined && { entityId }),
    ...(storeId !== undefined && { storeId }),
    ...(workDate !== undefined && { workDate }),
    ...(actor?.uid !== undefined && { actorUserId: actor.uid }),
    ...(actor?.role !== undefined && { actorRole: actor.role }),
    ...(metadata !== undefined && { metadata: compactAuditMetadata(metadata) }),
  });
};
