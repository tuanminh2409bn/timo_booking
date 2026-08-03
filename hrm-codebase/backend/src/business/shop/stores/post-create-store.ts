import type { Request, Response } from "express";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreAuth, firestoreRepository } from "../../../repository/firestore/index.js";
import { createStoreSchema } from "./store-shared.js";
import { toStoreResponse } from "./store-response.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { normalizeSettlementCutoffTime } from "../../../helpers/business-day.js";

const SERVICE_ERRORS = {
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

export const createStore = async (req: Request, res: Response) => {
  const { ownerId, uid, role } = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (role !== "owner") {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role });
  }

  const createStoreParseResult = createStoreSchema.safeParse(req.body);

  if (!createStoreParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: createStoreParseResult.error.flatten().fieldErrors,
    });
  }

  if (createStoreParseResult.data.bookingSlug) {
    const existingSlug = await firestoreAuth
      .collection("stores")
      .where("bookingSlug", "==", createStoreParseResult.data.bookingSlug)
      .limit(1)
      .get();
    if (!existingSlug.empty) {
      return createErrorResponse(res, SERVICE_ERRORS.bookingSlugInUse);
    }
  }

  const normalizedAddress = createStoreParseResult.data.address
    ? {
        ...(createStoreParseResult.data.address.line1 !== undefined && {
          line1: createStoreParseResult.data.address.line1,
        }),
        ...(createStoreParseResult.data.address.city !== undefined && { city: createStoreParseResult.data.address.city }),
        ...(createStoreParseResult.data.address.state !== undefined && {
          state: createStoreParseResult.data.address.state,
        }),
        ...(createStoreParseResult.data.address.zipCode !== undefined && {
          zipCode: createStoreParseResult.data.address.zipCode,
        }),
        ...(createStoreParseResult.data.address.country !== undefined && {
          country: createStoreParseResult.data.address.country,
        }),
      }
    : undefined;

  const storeId = await firestoreRepository.shop.store.createStore(ownerId, {
    name: createStoreParseResult.data.name,
    ...(createStoreParseResult.data.bookingSlug !== undefined && {
      bookingSlug: createStoreParseResult.data.bookingSlug,
    }),
    ...(createStoreParseResult.data.phone !== undefined && { phone: createStoreParseResult.data.phone }),
    ...(createStoreParseResult.data.email !== undefined && { email: createStoreParseResult.data.email }),
    ...(createStoreParseResult.data.manager !== undefined && { manager: createStoreParseResult.data.manager }),
    ...(createStoreParseResult.data.website !== undefined && { website: createStoreParseResult.data.website }),
    ...(createStoreParseResult.data.openTime !== undefined && { openTime: createStoreParseResult.data.openTime }),
    ...(createStoreParseResult.data.closeTime !== undefined && { closeTime: createStoreParseResult.data.closeTime }),
    settlementCutoffTime: normalizeSettlementCutoffTime(createStoreParseResult.data.settlementCutoffTime),
    timezone: createStoreParseResult.data.timezone,
    bookingWindowDays: createStoreParseResult.data.bookingWindowDays,
    minimumNoticeHours: createStoreParseResult.data.minimumNoticeHours,
    cancellationNoticeHours: createStoreParseResult.data.cancellationNoticeHours,
    slotIntervalMinutes: createStoreParseResult.data.slotIntervalMinutes,
    publicStaffSelection: createStoreParseResult.data.publicStaffSelection,
    ...(createStoreParseResult.data.foundedDate !== undefined && {
      foundedDate: createStoreParseResult.data.foundedDate,
    }),
    ...(normalizedAddress !== undefined && { address: normalizedAddress }),
    status: createStoreParseResult.data.status,
    createdByUserId: uid,
    updatedByUserId: uid,
  });

  const createdStore = await firestoreRepository.shop.store.getStore(ownerId, storeId);

  await writeShopAuditLog({
    ownerId,
    eventType: "store_created",
    entityType: "store",
    entityId: storeId,
    storeId,
    actor: {
      uid,
      role,
    },
    metadata: {
      name: createdStore.name,
      status: createdStore.status,
      settlementCutoffTime: createdStore.settlementCutoffTime,
      hasPhone: createdStore.phone !== undefined,
      hasAddress: createdStore.address !== undefined,
    },
  });

  return res.status(201).json({
    id: storeId,
    store: toStoreResponse(createdStore),
  });
};
