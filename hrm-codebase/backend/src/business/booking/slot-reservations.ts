import { createHash } from "node:crypto";
import { firestoreAuth } from "../../repository/firestore/index.js";

const RESERVATION_GRANULARITY_MINUTES = 5;

export type SlotReservationSegment = {
  employeeUserId: string;
  startTime: number;
  endTime: number;
};

export class BookingSlotConflictError extends Error {
  constructor() {
    super("The selected time is no longer available");
    this.name = "BookingSlotConflictError";
  }
}

const employeeKey = (employeeUserId: string) =>
  createHash("sha256").update(employeeUserId).digest("hex").slice(0, 20);

const reservationIdsForSegment = (workDate: string, segment: SlotReservationSegment) => {
  const firstMinute = Math.floor(segment.startTime / RESERVATION_GRANULARITY_MINUTES) * RESERVATION_GRANULARITY_MINUTES;
  const ids: string[] = [];
  for (
    let minute = firstMinute;
    minute < segment.endTime;
    minute += RESERVATION_GRANULARITY_MINUTES
  ) {
    ids.push(`${workDate.replaceAll("-", "")}_${employeeKey(segment.employeeUserId)}_${minute}`);
  }
  return ids;
};

export const acquireBookingSlotReservations = async (input: {
  ownerId: string;
  storeId: string;
  bookingId: string;
  workDate: string;
  segments: SlotReservationSegment[];
}): Promise<string[]> => {
  const reservationIds = [
    ...new Set(input.segments.flatMap((segment) => reservationIdsForSegment(input.workDate, segment))),
  ];
  if (reservationIds.length === 0) return [];

  const collection = firestoreAuth
    .collection("stores")
    .doc(input.storeId)
    .collection("booking_slot_reservations");
  await firestoreAuth.runTransaction(async (transaction) => {
    const documents = [];
    for (const reservationId of reservationIds) {
      documents.push(await transaction.get(collection.doc(reservationId)));
    }
    if (documents.some((document) => document.exists && document.data()?.["bookingId"] !== input.bookingId)) {
      throw new BookingSlotConflictError();
    }

    const timestamp = Date.now();
    for (const reservationId of reservationIds) {
      transaction.set(collection.doc(reservationId), {
        id: reservationId,
        ownerId: input.ownerId,
        storeId: input.storeId,
        bookingId: input.bookingId,
        workDate: input.workDate,
        createdAt: timestamp,
      });
    }
  });
  return reservationIds;
};

export const releaseBookingSlotReservations = async (
  storeId: string,
  reservationIds: string[],
): Promise<void> => {
  if (reservationIds.length === 0) return;
  const collection = firestoreAuth
    .collection("stores")
    .doc(storeId)
    .collection("booking_slot_reservations");
  for (let offset = 0; offset < reservationIds.length; offset += 450) {
    const batch = firestoreAuth.batch();
    for (const reservationId of reservationIds.slice(offset, offset + 450)) {
      batch.delete(collection.doc(reservationId));
    }
    await batch.commit();
  }
};

export const replaceBookingSlotReservations = async (input: {
  ownerId: string;
  storeId: string;
  bookingId: string;
  workDate: string;
  currentReservationIds: string[];
  segments: SlotReservationSegment[];
}): Promise<string[]> => {
  const nextReservationIds = [
    ...new Set(input.segments.flatMap((segment) => reservationIdsForSegment(input.workDate, segment))),
  ];
  const collection = firestoreAuth
    .collection("stores")
    .doc(input.storeId)
    .collection("booking_slot_reservations");
  await firestoreAuth.runTransaction(async (transaction) => {
    const nextDocuments = [];
    for (const reservationId of nextReservationIds) {
      nextDocuments.push(await transaction.get(collection.doc(reservationId)));
    }
    if (nextDocuments.some((document) =>
      document.exists && document.data()?.["bookingId"] !== input.bookingId
    )) {
      throw new BookingSlotConflictError();
    }

    const nextIdSet = new Set(nextReservationIds);
    for (const reservationId of input.currentReservationIds) {
      if (!nextIdSet.has(reservationId)) transaction.delete(collection.doc(reservationId));
    }
    const timestamp = Date.now();
    for (const reservationId of nextReservationIds) {
      transaction.set(collection.doc(reservationId), {
        id: reservationId,
        ownerId: input.ownerId,
        storeId: input.storeId,
        bookingId: input.bookingId,
        workDate: input.workDate,
        createdAt: timestamp,
      });
    }
  });
  return nextReservationIds;
};

export const getBookingSlotReservationIds = (booking: Record<string, unknown>): string[] =>
  Array.isArray(booking["slotReservationIds"])
    ? booking["slotReservationIds"].filter((value): value is string => typeof value === "string")
    : [];
