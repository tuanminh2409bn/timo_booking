import {
  FieldPath,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from "@google-cloud/firestore";
import { z } from "zod";
import {
  DB_NOT_FOUND,
  FirestoreDataNotFoundError,
  FirestoreDataValidationError,
} from "../../../constants/firestore-error.js";
import {
  canMergeCustomerByName,
  getCustomerDocumentId,
  getCustomerNameDocumentId,
  normalizeCustomerName,
  normalizeCustomerPhone,
} from "../../../helpers/customer-phone.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { getStoreSubcollection } from "../collection-paths.js";
import { reservePublicCode } from "../public-code.js";
import { isStoreScopedDocumentData } from "../store-document-mapper.js";
import { DEFAULT_BOOKING_STATUS, SHOP_ATTENDANCE_BOOKING_STATUSES } from "./shop.types.js";
import type {
  ShopCustomerAttendanceCursor,
  ShopCustomerAttendanceDateRange,
  ShopCustomerAttendanceHistoryItemType,
  ShopCustomerAttendanceSummaryType,
  ShopCustomerBlockInput,
  ShopCustomerListCursor,
  ShopCustomerType,
  ShopCustomerUnblockInput,
  ShopCustomerUpsertInput,
} from "./shop-customer.types.js";

const CUSTOMERS_SUBCOLLECTION = "customers";
const ATTENDANCES_SUBCOLLECTION = "attendances";

const customerDocumentSchema = z
  .object({
    ownerId: z.string().min(1),
    storeId: z.string().min(1),
    phone: z.string().trim().min(1).optional(),
    normalizedPhone: z.string().trim().min(1).optional(),
    normalizedName: z.string().trim().min(1).optional(),
    customerCode: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    blocked: z.boolean().optional(),
    blockedReason: z.string().trim().min(1).optional(),
    blockedByUserId: z.string().trim().min(1).optional(),
    blockedByRole: z.enum(["owner", "manager"]).optional(),
    blockedAt: z.number().int().nonnegative().optional(),
    unblockedByUserId: z.string().trim().min(1).optional(),
    unblockedByRole: z.enum(["owner", "manager"]).optional(),
    unblockedAt: z.number().int().nonnegative().optional(),
    archivedAttendanceCounters: z
      .object({
        totalAppointments: z.number().int().nonnegative(),
        requestedAppointments: z.number().int().nonnegative(),
        confirmedAppointments: z.number().int().nonnegative(),
        processingAppointments: z.number().int().nonnegative(),
        cancelledAppointments: z.number().int().nonnegative(),
        noShowAppointments: z.number().int().nonnegative(),
        completedAppointments: z.number().int().nonnegative().optional(),
      })
      .optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .passthrough();

const customerAttendanceHistoryProjectionSchema = z
  .object({
    ownerId: z.string().min(1),
    storeId: z.string().min(1),
    customerId: z.string().min(1),
    attendanceCode: z.string().trim().min(1).optional(),
    workDate: z.string().refine(isValidWorkDate),
    startTime: z.number().finite(),
    endTime: z.number().finite(),
    status: z.enum(["open", "closed"]),
    bookingStatus: z.enum(SHOP_ATTENDANCE_BOOKING_STATUSES).optional(),
    services: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const getStoreCustomers = (firestoreDB: Firestore, storeId: string) =>
  getStoreSubcollection(firestoreDB, storeId, CUSTOMERS_SUBCOLLECTION);

const getStoreAttendances = (firestoreDB: Firestore, storeId: string) =>
  getStoreSubcollection(firestoreDB, storeId, ATTENDANCES_SUBCOLLECTION);

const mapArchivedAttendanceCounters = (
  counters: NonNullable<z.infer<typeof customerDocumentSchema>["archivedAttendanceCounters"]>,
): ShopCustomerAttendanceSummaryType => ({
  totalAppointments: counters.totalAppointments,
  requestedAppointments: counters.requestedAppointments,
  confirmedAppointments: counters.confirmedAppointments,
  processingAppointments: counters.processingAppointments,
  cancelledAppointments: counters.cancelledAppointments,
  noShowAppointments: counters.noShowAppointments,
  ...(counters.completedAppointments !== undefined && {
    completedAppointments: counters.completedAppointments,
  }),
});

const mapCustomer = (
  data: z.infer<typeof customerDocumentSchema>,
  id: string,
): ShopCustomerType => ({
  id,
  ownerId: data.ownerId,
  storeId: data.storeId,
  ...(data.phone !== undefined && { phone: data.phone }),
  ...(data.customerCode !== undefined && { customerCode: data.customerCode }),
  ...(data.name !== undefined && { name: data.name }),
  blocked: data.blocked ?? false,
  ...(data.blockedReason !== undefined && { blockedReason: data.blockedReason }),
  ...(data.blockedByUserId !== undefined && { blockedByUserId: data.blockedByUserId }),
  ...(data.blockedByRole !== undefined && { blockedByRole: data.blockedByRole }),
  ...(data.blockedAt !== undefined && { blockedAt: data.blockedAt }),
  ...(data.unblockedByUserId !== undefined && { unblockedByUserId: data.unblockedByUserId }),
  ...(data.unblockedByRole !== undefined && { unblockedByRole: data.unblockedByRole }),
  ...(data.unblockedAt !== undefined && { unblockedAt: data.unblockedAt }),
  ...(data.archivedAttendanceCounters !== undefined && {
    archivedAttendanceCounters: mapArchivedAttendanceCounters(data.archivedAttendanceCounters),
  }),
  createdAt: data.createdAt,
  updatedAt: data.updatedAt,
});

export const createShopCustomerFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    input: ShopCustomerUpsertInput,
  ): Promise<ShopCustomerType | undefined> => {
    const normalizedPhone = normalizeCustomerPhone(input.phone);
    const normalizedName = normalizeCustomerName(input.name);

    if (normalizedPhone === undefined && normalizedName === undefined) {
      return undefined;
    }

    const customers = getStoreCustomers(firestoreDB, input.storeId);
    let existingCustomerSnapshot: DocumentSnapshot<DocumentData> | undefined;

    if (normalizedPhone !== undefined) {
      const phoneIdSnapshot = await customers.doc(getCustomerDocumentId(normalizedPhone)).get();

      if (phoneIdSnapshot.exists) {
        existingCustomerSnapshot = phoneIdSnapshot;
      } else {
        const phoneLookup = await customers
          .where("normalizedPhone", "==", normalizedPhone)
          .limit(1)
          .get();
        existingCustomerSnapshot = phoneLookup.docs[0];
      }
    }

    if (existingCustomerSnapshot === undefined && normalizedName !== undefined) {
      const nameIdSnapshot = await customers.doc(getCustomerNameDocumentId(normalizedName)).get();

      const canUseNameMatchedSnapshot = (snapshot: DocumentSnapshot<DocumentData>) => {
        const parsedCustomer = customerDocumentSchema.safeParse(snapshot.data());

        if (!parsedCustomer.success) {
          return true;
        }

        return canMergeCustomerByName(
          parsedCustomer.data.normalizedPhone ?? parsedCustomer.data.phone,
          normalizedPhone,
        );
      };

      if (nameIdSnapshot.exists && canUseNameMatchedSnapshot(nameIdSnapshot)) {
        existingCustomerSnapshot = nameIdSnapshot;
      } else {
        const nameLookup = await customers
          .where("normalizedName", "==", normalizedName)
          .get();
        existingCustomerSnapshot = nameLookup.docs.find(canUseNameMatchedSnapshot);
      }
    }

    const id =
      existingCustomerSnapshot?.id ??
      (normalizedPhone !== undefined
        ? getCustomerDocumentId(normalizedPhone)
        : getCustomerNameDocumentId(normalizedName as string));
    const customerRef = customers.doc(id);
    const timestamp = Date.now();
    const trimmedInputName = input.name?.trim();
    const name = trimmedInputName && trimmedInputName.length > 0 ? trimmedInputName : undefined;
    const initialSnapshot = await customerRef.get();
    const initialData = initialSnapshot.exists ? initialSnapshot.data() : undefined;
    const initialCustomerParseResult = initialSnapshot.exists
      ? customerDocumentSchema.safeParse(initialData)
      : undefined;

    if (
      initialSnapshot.exists &&
      (!isStoreScopedDocumentData(initialData, ownerId, input.storeId) ||
        initialCustomerParseResult?.success !== true)
    ) {
      throw new FirestoreDataValidationError("Stored customer data is invalid");
    }

    const reservedCustomerCode =
      initialCustomerParseResult?.success === true &&
      initialCustomerParseResult.data.customerCode !== undefined
        ? initialCustomerParseResult.data.customerCode
        : await reservePublicCode(firestoreDB, "customer", ownerId);
    let createdAt = timestamp;
    let resolvedName = name;
    let customerCode = reservedCustomerCode;
    let resolvedBlocked =
      initialCustomerParseResult?.success === true
        ? (initialCustomerParseResult.data.blocked ?? false)
        : false;

    await firestoreDB.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(customerRef);
      const existingData = existingSnapshot.exists ? existingSnapshot.data() : undefined;
      const existingCustomerParseResult = existingSnapshot.exists
        ? customerDocumentSchema.safeParse(existingData)
        : undefined;

      if (
        existingSnapshot.exists &&
        (!isStoreScopedDocumentData(existingData, ownerId, input.storeId) ||
          existingCustomerParseResult?.success !== true)
      ) {
        throw new FirestoreDataValidationError("Stored customer data is invalid");
      }

      createdAt =
        existingCustomerParseResult?.success === true
          ? existingCustomerParseResult.data.createdAt
          : timestamp;
      customerCode =
        existingCustomerParseResult?.success === true &&
        existingCustomerParseResult.data.customerCode !== undefined
          ? existingCustomerParseResult.data.customerCode
          : reservedCustomerCode;
      resolvedBlocked =
        existingCustomerParseResult?.success === true
          ? (existingCustomerParseResult.data.blocked ?? false)
          : false;
      const existingName =
        existingCustomerParseResult?.success === true &&
        existingCustomerParseResult.data.name !== undefined
          ? existingCustomerParseResult.data.name
          : "";
      resolvedName = name ?? (existingName.length > 0 ? existingName : undefined);

      // A rejected booking must not mutate an already-blocked customer profile.
      if (resolvedBlocked) {
        return;
      }

      transaction.set(
        customerRef,
        {
          ownerId,
          storeId: input.storeId,
          ...(normalizedPhone !== undefined && { phone: normalizedPhone }),
          ...(normalizedPhone !== undefined && { normalizedPhone }),
          ...(normalizedName !== undefined && { normalizedName }),
          customerCode,
          blocked: resolvedBlocked,
          ...(resolvedName !== undefined && { name: resolvedName }),
          createdAt,
          updatedAt: timestamp,
        },
        { merge: true },
      );
    });

    const savedSnapshot = await customerRef.get();
    const savedParseResult = customerDocumentSchema.safeParse(savedSnapshot.data());

    if (!savedSnapshot.exists || !savedParseResult.success) {
      throw new FirestoreDataValidationError("Stored customer data is invalid");
    }

    return mapCustomer(savedParseResult.data, id);
  };
};

export const getShopCustomerFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    customerId: string,
  ): Promise<ShopCustomerType> => {
    const customerSnapshot = await getStoreCustomers(firestoreDB, storeId).doc(customerId).get();
    const customerData = customerSnapshot.data();

    if (!customerSnapshot.exists || !isStoreScopedDocumentData(customerData, ownerId, storeId)) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.store);
    }

    const customerParseResult = customerDocumentSchema.safeParse(customerData);

    if (!customerParseResult.success) {
      throw new FirestoreDataValidationError("Stored customer data is invalid");
    }

    return mapCustomer(customerParseResult.data, customerId);
  };
};

export const blockShopCustomerFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    customerId: string,
    input: ShopCustomerBlockInput,
  ): Promise<ShopCustomerType> => {
    const customerRef = getStoreCustomers(firestoreDB, storeId).doc(customerId);
    const timestamp = Date.now();
    await firestoreDB.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(customerRef);
      const data = snapshot.data();
      const parsed = snapshot.exists ? customerDocumentSchema.safeParse(data) : undefined;

      if (
        !snapshot.exists ||
        parsed?.success !== true ||
        !isStoreScopedDocumentData(data, ownerId, storeId)
      ) {
        throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.store);
      }

      transaction.set(
        customerRef,
        {
          blocked: true,
          blockedReason: input.reason.trim(),
          blockedByUserId: input.userId,
          blockedByRole: input.role,
          blockedAt: timestamp,
          updatedAt: timestamp,
        },
        { merge: true },
      );
    });

    return getShopCustomerFactory(firestoreDB)(ownerId, storeId, customerId);
  };
};

export const unblockShopCustomerFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    customerId: string,
    input: ShopCustomerUnblockInput,
  ): Promise<ShopCustomerType> => {
    const customerRef = getStoreCustomers(firestoreDB, storeId).doc(customerId);
    const timestamp = Date.now();
    await firestoreDB.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(customerRef);
      const data = snapshot.data();
      const parsed = snapshot.exists ? customerDocumentSchema.safeParse(data) : undefined;

      if (
        !snapshot.exists ||
        parsed?.success !== true ||
        !isStoreScopedDocumentData(data, ownerId, storeId)
      ) {
        throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.store);
      }

      transaction.set(
        customerRef,
        {
          blocked: false,
          unblockedByUserId: input.userId,
          unblockedByRole: input.role,
          unblockedAt: timestamp,
          updatedAt: timestamp,
        },
        { merge: true },
      );
    });

    return getShopCustomerFactory(firestoreDB)(ownerId, storeId, customerId);
  };
};

export const listShopCustomersFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    options: { limit: number; cursor?: ShopCustomerListCursor },
  ): Promise<{
    customers: ShopCustomerType[];
    nextCursor: ShopCustomerListCursor | null;
    hasMore: boolean;
  }> => {
    let query: Query = getStoreCustomers(firestoreDB, storeId)
      .select(
        "ownerId",
        "storeId",
        "phone",
        "customerCode",
        "name",
        "blocked",
        "blockedReason",
        "blockedByUserId",
        "blockedByRole",
        "blockedAt",
        "unblockedByUserId",
        "unblockedByRole",
        "unblockedAt",
        "archivedAttendanceCounters",
        "createdAt",
        "updatedAt",
      )
      .orderBy("createdAt", "desc")
      .orderBy(FieldPath.documentId(), "desc");

    if (options.cursor !== undefined) {
      query = query.startAfter(options.cursor.createdAt, options.cursor.id);
    }

    const snapshot = await query.limit(options.limit + 1).get();
    const customers: ShopCustomerType[] = [];

    for (const document of snapshot.docs) {
      const customerData = document.data();

      if (!isStoreScopedDocumentData(customerData, ownerId, storeId)) {
        continue;
      }

      const customerParseResult = customerDocumentSchema.safeParse(customerData);

      if (!customerParseResult.success) {
        throw new FirestoreDataValidationError("Stored customer data is invalid");
      }

      customers.push(mapCustomer(customerParseResult.data, document.id));
    }

    const hasMore = customers.length > options.limit;
    const page = hasMore ? customers.slice(0, options.limit) : customers;
    const last = page[page.length - 1];

    return {
      customers: page,
      nextCursor: hasMore && last !== undefined ? { createdAt: last.createdAt, id: last.id } : null,
      hasMore,
    };
  };
};

export const listShopCustomerAttendancesFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    customerId: string,
    options: {
      limit: number;
      cursor?: ShopCustomerAttendanceCursor;
      dateRange?: ShopCustomerAttendanceDateRange;
    },
  ): Promise<{
    attendances: ShopCustomerAttendanceHistoryItemType[];
    nextCursor: ShopCustomerAttendanceCursor | null;
    hasMore: boolean;
  }> => {
    let query: Query = getStoreAttendances(firestoreDB, storeId)
      .select(
        "ownerId",
        "storeId",
        "customerId",
        "attendanceCode",
        "workDate",
        "startTime",
        "endTime",
        "status",
        "bookingStatus",
        "services",
      )
      .where("customerId", "==", customerId);

    if (options.dateRange) {
      query = query
        .where("workDate", ">=", options.dateRange.startDate)
        .where("workDate", "<=", options.dateRange.endDate);
    }

    query = query
      .orderBy("workDate", "desc")
      .orderBy("startTime", "desc")
      .orderBy(FieldPath.documentId(), "desc");

    if (options.cursor !== undefined) {
      query = query.startAfter(
        options.cursor.workDate,
        options.cursor.startTime,
        options.cursor.id,
      );
    }

    const snapshot = await query.limit(options.limit + 1).get();
    const attendances: ShopCustomerAttendanceHistoryItemType[] = [];

    for (const document of snapshot.docs) {
      const attendanceData = document.data();

      if (!isStoreScopedDocumentData(attendanceData, ownerId, storeId)) {
        continue;
      }

      const attendanceParseResult =
        customerAttendanceHistoryProjectionSchema.safeParse(attendanceData);

      if (!attendanceParseResult.success) {
        throw new FirestoreDataValidationError("Stored customer attendance data is invalid");
      }

      attendances.push({
        id: document.id,
        ...(attendanceParseResult.data.attendanceCode !== undefined && {
          attendanceCode: attendanceParseResult.data.attendanceCode,
        }),
        workDate: attendanceParseResult.data.workDate,
        startTime: attendanceParseResult.data.startTime,
        endTime: attendanceParseResult.data.endTime,
        status: attendanceParseResult.data.status,
        bookingStatus: attendanceParseResult.data.bookingStatus ?? DEFAULT_BOOKING_STATUS,
        services: attendanceParseResult.data.services.map((service) => ({
          id: service.id,
          name: service.name,
        })),
      });
    }

    const hasMore = attendances.length > options.limit;
    const page = hasMore ? attendances.slice(0, options.limit) : attendances;
    const last = page[page.length - 1];

    return {
      attendances: page,
      nextCursor:
        hasMore && last !== undefined
          ? { workDate: last.workDate, startTime: last.startTime, id: last.id }
          : null,
      hasMore,
    };
  };
};

export const getShopCustomerAttendanceSummaryFactory = (firestoreDB: Firestore) => {
  return async (
    ownerId: string,
    storeId: string,
    customerId: string,
    dateRange?: ShopCustomerAttendanceDateRange,
  ): Promise<ShopCustomerAttendanceSummaryType> => {
    let customerAttendanceQuery: Query = getStoreAttendances(firestoreDB, storeId)
      .where("ownerId", "==", ownerId)
      .where("customerId", "==", customerId);

    if (dateRange) {
      customerAttendanceQuery = customerAttendanceQuery
        .where("workDate", ">=", dateRange.startDate)
        .where("workDate", "<=", dateRange.endDate);
    }

    const [
      customerSnapshot,
      totalSnapshot,
      requestedSnapshot,
      processingSnapshot,
      completedSnapshot,
      cancelledSnapshot,
      noShowSnapshot,
    ] = await Promise.all([
      getStoreCustomers(firestoreDB, storeId).doc(customerId).get(),
      customerAttendanceQuery.count().get(),
      customerAttendanceQuery.where("bookingStatus", "==", "requested").count().get(),
      customerAttendanceQuery.where("bookingStatus", "==", "processing").count().get(),
      customerAttendanceQuery.where("status", "==", "closed").count().get(),
      customerAttendanceQuery.where("bookingStatus", "==", "cancelled").count().get(),
      customerAttendanceQuery.where("bookingStatus", "==", "no_show").count().get(),
    ]);
    const customerData = customerSnapshot.data();

    if (!customerSnapshot.exists || !isStoreScopedDocumentData(customerData, ownerId, storeId)) {
      throw new FirestoreDataNotFoundError(...DB_NOT_FOUND.store);
    }

    const customerParseResult = customerDocumentSchema.safeParse(customerData);

    if (!customerParseResult.success) {
      throw new FirestoreDataValidationError("Stored customer data is invalid");
    }

    const summaryCountParseResult = z
      .object({
        totalAppointments: z.number().int().nonnegative(),
        requestedAppointments: z.number().int().nonnegative(),
        processingAppointments: z.number().int().nonnegative(),
        cancelledAppointments: z.number().int().nonnegative(),
        noShowAppointments: z.number().int().nonnegative(),
      })
      .safeParse({
        totalAppointments: totalSnapshot.data().count,
        requestedAppointments: requestedSnapshot.data().count,
        processingAppointments: processingSnapshot.data().count,
        cancelledAppointments: cancelledSnapshot.data().count,
        noShowAppointments: noShowSnapshot.data().count,
      });

    if (!summaryCountParseResult.success) {
      throw new FirestoreDataValidationError("Stored customer attendance summary is invalid");
    }

    const totalAppointments = summaryCountParseResult.data.totalAppointments;
    const requestedAppointments = summaryCountParseResult.data.requestedAppointments;
    const processingAppointments = summaryCountParseResult.data.processingAppointments;
    const cancelledAppointments = summaryCountParseResult.data.cancelledAppointments;
    const noShowAppointments = summaryCountParseResult.data.noShowAppointments;
    const confirmedAppointments = Math.max(
      totalAppointments -
        requestedAppointments -
        processingAppointments -
        cancelledAppointments -
        noShowAppointments,
      0,
    );
    const completedAppointments = completedSnapshot.data().count;

    const archivedAttendanceCounters = dateRange
      ? undefined
      : customerParseResult.data.archivedAttendanceCounters;

    const archived = archivedAttendanceCounters;
    const archivedTotal = archived?.totalAppointments ?? 0;
    const archivedPending =
      (archived?.requestedAppointments ?? 0) + (archived?.processingAppointments ?? 0);
    const archivedCompleted = archived?.completedAppointments ?? 0;
    const archivedConfirmed = Math.max(
      (archived?.confirmedAppointments ?? 0) - archivedCompleted,
      0,
    );
    const archivedCancelled = archived?.cancelledAppointments ?? 0;
    const archivedNoShow = archived?.noShowAppointments ?? 0;
    const livePending = requestedAppointments + processingAppointments;
    const liveCancelled = cancelledAppointments;
    const liveNoShow = noShowAppointments;
    const liveCompleted = completedAppointments;
    const liveConfirmed = Math.max(confirmedAppointments - liveCompleted, 0);

    return {
      totalAppointments: totalAppointments + (archivedAttendanceCounters?.totalAppointments ?? 0),
      requestedAppointments:
        requestedAppointments + (archivedAttendanceCounters?.requestedAppointments ?? 0),
      confirmedAppointments:
        confirmedAppointments + (archivedAttendanceCounters?.confirmedAppointments ?? 0),
      processingAppointments:
        processingAppointments + (archivedAttendanceCounters?.processingAppointments ?? 0),
      cancelledAppointments:
        cancelledAppointments + (archivedAttendanceCounters?.cancelledAppointments ?? 0),
      noShowAppointments:
        noShowAppointments + (archivedAttendanceCounters?.noShowAppointments ?? 0),
      total: totalAppointments + archivedTotal,
      pending_approval: dateRange ? livePending : livePending + archivedPending,
      confirmed: dateRange ? liveConfirmed : liveConfirmed + archivedConfirmed,
      completed: dateRange ? liveCompleted : liveCompleted + archivedCompleted,
      cancelled: dateRange ? liveCancelled : liveCancelled + archivedCancelled,
      no_show: dateRange ? liveNoShow : liveNoShow + archivedNoShow,
    };
  };
};
