import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { FirestoreDataNotFoundError } from "../../constants/firestore-error.js";
import { canAccessStore } from "../../helpers/role-access.js";
import { writeShopAuditLog } from "../../helpers/shop-audit-log.js";
import { createErrorResponse } from "../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firestoreAuth, firestoreRepository } from "../../repository/firestore/index.js";
import type { ShopAttendanceType } from "../../repository/firestore/shop/shop.types.js";

const CONFIRMATION_TOKEN = "DELETE_ALL_BOOKING_DATA";
const FIRESTORE_IN_QUERY_LIMIT = 30;
const DELETE_CONCURRENCY = 25;

const deleteRequestSchema = z.object({
  confirmation: z.literal(CONFIRMATION_TOKEN),
});

const SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/bookings/delete-all/invalid-request",
    message: "Explicit confirmation is required",
  },
  forbidden: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/bookings/delete-all/forbidden",
    message: "Only the store owner can delete all Booking data",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/bookings/delete-all/forbidden-store",
    message: "Forbidden: store access denied",
  },
};

type BookingDocument = {
  id: string;
  data: Record<string, unknown>;
};

type BookingPurgeTargets = {
  bookingDocuments: BookingDocument[];
  attendances: ShopAttendanceType[];
  reservationIds: string[];
  workDates: string[];
};

const chunk = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size));
  }
  return chunks;
};

const runWithConcurrency = async <T>(
  values: T[],
  operation: (value: T) => Promise<void>,
): Promise<void> => {
  for (const valuesChunk of chunk(values, DELETE_CONCURRENCY)) {
    await Promise.all(valuesChunk.map(operation));
  }
};

const validateOwnerStore = async (
  authorizationHeader: string | undefined,
  storeId: string,
) => {
  const authContext = await verifyAuthorizationHeader(authorizationHeader);

  if (authContext.role !== "owner") {
    return { authContext, error: SERVICE_ERRORS.forbidden } as const;
  }

  if (!canAccessStore(authContext, storeId)) {
    return { authContext, error: SERVICE_ERRORS.forbiddenStore } as const;
  }

  const store = await firestoreRepository.shop.store
    .getStore(authContext.ownerId, storeId)
    .catch((error: unknown) => {
      if (error instanceof FirestoreDataNotFoundError) return null;
      throw error;
    });

  if (!store) {
    return { authContext, error: SERVICE_ERRORS.forbiddenStore } as const;
  }

  return { authContext, store } as const;
};

const loadBookingPurgeTargets = async (
  ownerId: string,
  storeId: string,
): Promise<BookingPurgeTargets> => {
  const storeDocument = firestoreAuth.collection("stores").doc(storeId);
  const bookingCollection = storeDocument.collection("bookings");
  const bookingSnapshot = await bookingCollection.get();
  const bookingDocuments = bookingSnapshot.docs.flatMap((document) => {
    const data = document.data();
    return data["ownerId"] === ownerId && data["storeId"] === storeId
      ? [{ id: document.id, data }]
      : [];
  });
  const bookingIds = bookingDocuments.map((document) => document.id);
  const bookingIdSet = new Set(bookingIds);

  const attendanceById = new Map<string, ShopAttendanceType>();
  const reservationIds = new Set<string>();
  const workDates = new Set<string>();

  for (const bookingDocument of bookingDocuments) {
    const workDate = bookingDocument.data["workDate"];
    if (typeof workDate === "string" && workDate.trim()) workDates.add(workDate);
  }

  for (const bookingIdChunk of chunk(bookingIds, FIRESTORE_IN_QUERY_LIMIT)) {
    if (bookingIdChunk.length === 0) continue;
    const [attendanceSnapshot, reservationSnapshot] = await Promise.all([
      storeDocument
        .collection("attendances")
        .where("bookingId", "in", bookingIdChunk)
        .get(),
      storeDocument
        .collection("booking_slot_reservations")
        .where("bookingId", "in", bookingIdChunk)
        .get(),
    ]);

    for (const document of attendanceSnapshot.docs) {
      const data = document.data() as ShopAttendanceType;
      if (
        data.ownerId === ownerId &&
        data.storeId === storeId &&
        typeof data.bookingId === "string" &&
        bookingIdSet.has(data.bookingId)
      ) {
        attendanceById.set(document.id, { ...data, id: document.id });
        if (typeof data.workDate === "string" && data.workDate.trim()) {
          workDates.add(data.workDate);
        }
      }
    }

    for (const document of reservationSnapshot.docs) {
      const data = document.data();
      if (
        data["ownerId"] === ownerId &&
        data["storeId"] === storeId &&
        typeof data["bookingId"] === "string" &&
        bookingIdSet.has(data["bookingId"])
      ) {
        reservationIds.add(document.id);
      }
    }
  }

  return {
    bookingDocuments,
    attendances: [...attendanceById.values()],
    reservationIds: [...reservationIds],
    workDates: [...workDates].sort(),
  };
};

const toPreviewPayload = (storeId: string, targets: BookingPurgeTargets) => ({
  storeId,
  bookingCount: targets.bookingDocuments.length,
  attendanceSegmentCount: targets.attendances.length,
  slotReservationCount: targets.reservationIds.length,
  workDateCount: targets.workDates.length,
  workDates: targets.workDates,
  preservedData: [
    "hrm_attendances_without_booking_document",
    "employees",
    "services",
    "leave_requests",
    "work_day_closings",
    "work_day_settlements",
    "customers",
  ],
});

export const getBookingPurgePreview = async (request: Request, response: Response) => {
  const storeId = String(request.params["storeId"] ?? "").trim();
  if (!storeId) return createErrorResponse(response, SERVICE_ERRORS.invalidRequest);

  const validation = await validateOwnerStore(request.headers["authorization"], storeId);
  if ("error" in validation) {
    return createErrorResponse(response, validation.error, { storeId });
  }

  const targets = await loadBookingPurgeTargets(validation.authContext.ownerId, storeId);
  return response.status(StatusCodes.OK).json(toPreviewPayload(storeId, targets));
};

export const deleteAllBookingData = async (request: Request, response: Response) => {
  const storeId = String(request.params["storeId"] ?? "").trim();
  const parsedRequest = deleteRequestSchema.safeParse(request.body);
  if (!storeId || !parsedRequest.success) {
    return createErrorResponse(response, SERVICE_ERRORS.invalidRequest, { storeId });
  }

  const validation = await validateOwnerStore(request.headers["authorization"], storeId);
  if ("error" in validation) {
    return createErrorResponse(response, validation.error, { storeId });
  }

  const { authContext } = validation;
  const targets = await loadBookingPurgeTargets(authContext.ownerId, storeId);
  const storeDocument = firestoreAuth.collection("stores").doc(storeId);

  // Release Booking slot locks first, then remove only attendance segments that
  // are linked to a real Booking document. HRM-created attendance without such
  // a document is deliberately outside this operation.
  await runWithConcurrency(targets.reservationIds, async (reservationId) => {
    await storeDocument.collection("booking_slot_reservations").doc(reservationId).delete();
  });
  await runWithConcurrency(targets.attendances, (attendance) =>
    firestoreRepository.shop.attendance.deleteShopAttendance(
      authContext.ownerId,
      storeId,
      attendance.id,
      attendance,
    ),
  );

  // Delete the source Booking documents last. If a transient failure occurs,
  // retrying the endpoint can still discover the remaining linked records.
  await runWithConcurrency(targets.bookingDocuments, async (bookingDocument) => {
    await storeDocument.collection("bookings").doc(bookingDocument.id).delete();
  });

  await writeShopAuditLog({
    ownerId: authContext.ownerId,
    eventType: "attendance_deleted",
    entityType: "store",
    entityId: storeId,
    storeId,
    actor: { uid: authContext.uid, role: authContext.role },
    metadata: {
      bookingBulkPurge: true,
      bookingCount: targets.bookingDocuments.length,
      attendanceSegmentCount: targets.attendances.length,
      slotReservationCount: targets.reservationIds.length,
      workDateCount: targets.workDates.length,
      hrmStandaloneAttendancePreserved: true,
    },
  });

  return response.status(StatusCodes.OK).json({
    ...toPreviewPayload(storeId, targets),
    deleted: true,
  });
};
