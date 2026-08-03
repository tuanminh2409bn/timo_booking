import type { Request, Response } from "express";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { can } from "../../../helpers/permissions.js";
import { firestoreAuth, firestoreRepository } from "../../../repository/firestore/index.js";
import { updateStoreSchema } from "./store-shared.js";
import { toStoreResponse } from "./store-response.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";

const SERVICE_ERRORS = {
  forbiddenStore: {
    statusCode: 403,
    type: "/stores/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenRole: {
    statusCode: 403,
    type: "/stores/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: 400,
    type: "/stores/invalid-request",
    message: "Invalid request",
  },
  bookingSlugInUse: {
    statusCode: 409,
    type: "/stores/booking-slug-in-use",
    message: "Booking URL is already used by another store",
  },
};

export const updateStore = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const storeId = req.params["storeId"];

  if (!can(authContext.role, "store:update")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  if (typeof storeId !== "string" || !storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, { reason: "missing storeId" });
  }

  if (!canAccessStore(authContext, storeId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      storeId,
      role: authContext.role,
    });
  }

  const updateStoreParseResult = updateStoreSchema.safeParse(req.body);

  if (!updateStoreParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: updateStoreParseResult.error.flatten().fieldErrors,
    });
  }

  if (updateStoreParseResult.data.bookingSlug) {
    const existingSlug = await firestoreAuth
      .collection("stores")
      .where("bookingSlug", "==", updateStoreParseResult.data.bookingSlug)
      .limit(2)
      .get();
    if (existingSlug.docs.some((document) => document.id !== storeId)) {
      return createErrorResponse(res, SERVICE_ERRORS.bookingSlugInUse);
    }
  }

  const normalizedAddress = updateStoreParseResult.data.address
    ? {
        ...(updateStoreParseResult.data.address.line1 !== undefined && {
          line1: updateStoreParseResult.data.address.line1,
        }),
        ...(updateStoreParseResult.data.address.city !== undefined && { city: updateStoreParseResult.data.address.city }),
        ...(updateStoreParseResult.data.address.state !== undefined && {
          state: updateStoreParseResult.data.address.state,
        }),
        ...(updateStoreParseResult.data.address.zipCode !== undefined && {
          zipCode: updateStoreParseResult.data.address.zipCode,
        }),
        ...(updateStoreParseResult.data.address.country !== undefined && {
          country: updateStoreParseResult.data.address.country,
        }),
      }
    : undefined;

  await firestoreRepository.shop.store.updateStore(authContext.ownerId, storeId, {
    ...(updateStoreParseResult.data.name !== undefined && { name: updateStoreParseResult.data.name }),
    ...(updateStoreParseResult.data.bookingSlug !== undefined && {
      bookingSlug: updateStoreParseResult.data.bookingSlug,
    }),
    ...(updateStoreParseResult.data.phone !== undefined && { phone: updateStoreParseResult.data.phone }),
    ...(updateStoreParseResult.data.email !== undefined && { email: updateStoreParseResult.data.email }),
    ...(updateStoreParseResult.data.manager !== undefined && { manager: updateStoreParseResult.data.manager }),
    ...(updateStoreParseResult.data.website !== undefined && { website: updateStoreParseResult.data.website }),
    ...(updateStoreParseResult.data.openTime !== undefined && { openTime: updateStoreParseResult.data.openTime }),
    ...(updateStoreParseResult.data.closeTime !== undefined && { closeTime: updateStoreParseResult.data.closeTime }),
    ...(updateStoreParseResult.data.settlementCutoffTime !== undefined && {
      settlementCutoffTime: updateStoreParseResult.data.settlementCutoffTime,
    }),
    ...(updateStoreParseResult.data.timezone !== undefined && {
      timezone: updateStoreParseResult.data.timezone,
    }),
    ...(updateStoreParseResult.data.bookingWindowDays !== undefined && {
      bookingWindowDays: updateStoreParseResult.data.bookingWindowDays,
    }),
    ...(updateStoreParseResult.data.minimumNoticeHours !== undefined && {
      minimumNoticeHours: updateStoreParseResult.data.minimumNoticeHours,
    }),
    ...(updateStoreParseResult.data.cancellationNoticeHours !== undefined && {
      cancellationNoticeHours: updateStoreParseResult.data.cancellationNoticeHours,
    }),
    ...(updateStoreParseResult.data.slotIntervalMinutes !== undefined && {
      slotIntervalMinutes: updateStoreParseResult.data.slotIntervalMinutes,
    }),
    ...(updateStoreParseResult.data.publicStaffSelection !== undefined && {
      publicStaffSelection: updateStoreParseResult.data.publicStaffSelection,
    }),
    ...(updateStoreParseResult.data.foundedDate !== undefined && {
      foundedDate: updateStoreParseResult.data.foundedDate,
    }),
    ...(normalizedAddress !== undefined && { address: normalizedAddress }),
    ...(updateStoreParseResult.data.status !== undefined && { status: updateStoreParseResult.data.status }),
    updatedByUserId: authContext.uid,
  });

  const updatedStore = await firestoreRepository.shop.store.getStore(authContext.ownerId, storeId);

  await writeShopAuditLog({
    ownerId: authContext.ownerId,
    eventType: "store_updated",
    entityType: "store",
    entityId: storeId,
    storeId,
    actor: {
      uid: authContext.uid,
      role: authContext.role,
    },
    metadata: {
      updatedFields: Object.keys(updateStoreParseResult.data),
      name: updatedStore.name,
      status: updatedStore.status,
      settlementCutoffTime: updatedStore.settlementCutoffTime,
    },
  });

  return res.status(200).json({
    id: storeId,
    store: toStoreResponse(updatedStore),
  });
};
