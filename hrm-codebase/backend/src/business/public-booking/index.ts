import { randomUUID } from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { firestoreAuth, firestoreRepository } from "../../repository/firestore/index.js";
import {
  buildIpRateLimitFingerprint,
  createRequestRateLimit,
} from "../../modules/request-rate-limit.js";
import { createStoreWorkDateKey } from "../../helpers/work-date-utils.js";
import {
  normalizeBusinessTimeZone,
  normalizeSettlementCutoffTime,
  resolveZonedDateTimeEpoch,
} from "../../helpers/business-day.js";
import { formatStoreAddress } from "../shop/stores/store-response.js";
import { sumMoney } from "../../helpers/money.js";
import { logger } from "../../modules/logger.js";
import type {
  ShopAttendanceBookingStatus,
  ShopAttendanceType,
  ShopBookingAddonType,
  ShopBookingType,
  StoreType,
} from "../../repository/firestore/shop/shop.types.js";
import { mapStoreDocumentToStore } from "../../repository/firestore/store-document-mapper.js";
import { getStoreIdFromUrlPath } from "../../helpers/request-store-id.js";
import { synchronizeWorkDaySettlement } from "../employee/work-days/work-day-settlement-sync.js";
import { normalizeCustomerPhone } from "../../helpers/customer-phone.js";
import {
  acquireBookingSlotReservations,
  BookingSlotConflictError,
  releaseBookingSlotReservations,
} from "../booking/slot-reservations.js";

// ---------------------------------------------------------------------------
// Rate Limits
// ---------------------------------------------------------------------------

const publicBookingRateLimit = createRequestRateLimit({
  keyPrefix: "ratelimit:public-booking",
  limit: 10,
  windowMs: 60_000,
  message: "Too many booking requests",
  fingerprintBuilder: buildIpRateLimitFingerprint,
});

const publicReadRateLimit = createRequestRateLimit({
  keyPrefix: "ratelimit:public-read",
  limit: 60,
  windowMs: 60_000,
  message: "Too many requests",
  fingerprintBuilder: buildIpRateLimitFingerprint,
});

// ---------------------------------------------------------------------------
// Direct Firestore store lookup (no ownerId required)
// ---------------------------------------------------------------------------

const getStoreById = async (storeId: string): Promise<StoreType | undefined> => {
  const normalizedIdentifier = storeId.trim();
  const stores = firestoreAuth.collection("stores");
  const directStore = await stores.doc(normalizedIdentifier).get();
  const slugStore = directStore.exists
    ? undefined
    : (
        await stores
          .where("bookingSlug", "==", normalizedIdentifier.toLowerCase())
          .limit(1)
          .get()
      ).docs[0];
  const storeDoc = directStore.exists ? directStore : slugStore;

  if (!storeDoc?.exists) {
    return undefined;
  }

  const data = storeDoc.data() as Record<string, unknown>;
  const ownerId =
    typeof data["ownerId"] === "string" && data["ownerId"].trim().length > 0
      ? data["ownerId"].trim()
      : undefined;

  if (ownerId === undefined) {
    return undefined;
  }

  const store = mapStoreDocumentToStore<StoreType>(storeDoc, ownerId);
  return store.status === "active" ? store : undefined;
};

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const bookingServiceSchema = z.object({
  sourceServiceId: z.string().trim().min(1),
  staffSelectionType: z.enum(["specific", "any"]).optional(),
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(50).optional().default("nail"),
  durationMinutes: z.number().int().positive(),
  price: z.number().min(0),
  employeeUserId: z.string().trim().min(1).optional(),
  employeeName: z.string().trim().min(1).max(100).optional(),
});

const bookingAddonSchema = z.object({
  sourceServiceId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(100),
  price: z.number().min(0),
});

const createBookingSchema = z
  .object({
    storeId: z.string().trim().min(1),
    customerName: z.string().trim().min(1).max(100),
    customerPhone: z.string().trim().min(1).max(30),
    customerEmail: z.string().trim().max(100).optional(),
    appointmentDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "appointmentDate must be in YYYY-MM-DD format"),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "startTime must be in HH:mm format"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "endTime must be in HH:mm format"),
    services: z.array(bookingServiceSchema).min(1).max(2),
    addOns: z.array(bookingAddonSchema).max(20).optional().default([]),
    staffSelectionType: z.enum(["specific", "any"]),
    bookingMode: z.enum(["instant", "request"]).optional(),
    notes: z.string().trim().max(500).optional(),
    source: z.string().trim().max(50).optional().default("online_booking"),
  })
  .superRefine((data, ctx) => {
    const [startH, startM] = data.startTime.split(":").map(Number);
    const [endH, endM] = data.endTime.split(":").map(Number);
    const startMinutes = (startH ?? 0) * 60 + (startM ?? 0);
    const endMinutes = (endH ?? 0) * 60 + (endM ?? 0);

    if (endMinutes <= startMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "endTime must be after startTime",
      });
    }

    if (data.services.some(
      (service) =>
        (service.staffSelectionType ?? data.staffSelectionType) === "specific" &&
        service.employeeUserId === undefined,
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["services"],
        message: "Every service must select an employee when staffSelectionType is specific",
      });
    }
  });

const getRequestBodyObject = (body: unknown): Record<string, unknown> =>
  typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

const getBodyStoreId = (body: Record<string, unknown>) => {
  const storeId = body["storeId"];

  return typeof storeId === "string" && storeId.trim() ? storeId.trim() : undefined;
};

const buildCreateBookingInput = (req: Request) => {
  const body = getRequestBodyObject(req.body);
  const pathStoreId = getStoreIdFromUrlPath(req);
  const bodyStoreId = getBodyStoreId(body);

  if (pathStoreId !== undefined && bodyStoreId !== undefined && pathStoreId !== bodyStoreId) {
    return {
      success: false as const,
      route: "POST /api/v1/public/stores/:storeId/bookings",
    };
  }

  return {
    success: true as const,
    route:
      pathStoreId !== undefined
        ? "POST /api/v1/public/stores/:storeId/bookings"
        : "POST /api/v1/public/bookings",
    input: pathStoreId !== undefined ? { ...body, storeId: pathStoreId } : body,
  };
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = express.Router();

// ---- GET /api/v1/public/stores/:storeId ----

router.get(
  "/api/v1/public/stores/:storeId",
  publicReadRateLimit,
  async (req: Request, res: Response) => {
    try {
      const storeId = getStoreIdFromUrlPath(req);

      if (storeId === undefined) {
        return res.status(400).json({
          type: "/public/stores/invalid-request",
          message: "storeId is required",
        });
      }

      const store = await getStoreById(storeId);

      if (!store) {
        return res.status(404).json({
          type: "/public/stores/store-not-found",
          message: "Store not found",
        });
      }

      return res.status(200).json({
        store: {
          id: store.id,
          name: store.name,
          phone: store.phone,
          email: store.email,
          openTime: store.openTime,
          closeTime: store.closeTime,
          address: store.address,
          addressText:
            formatStoreAddress(store) || (store as Record<string, unknown>)["addressText"] || "",
          timezone: normalizeBusinessTimeZone(store.timezone),
          bookingWindowDays: store.bookingWindowDays ?? 30,
          minimumNoticeHours: store.minimumNoticeHours ?? 2,
          cancellationNoticeHours: store.cancellationNoticeHours ?? 12,
          slotIntervalMinutes: store.slotIntervalMinutes ?? 15,
          publicStaffSelection: store.publicStaffSelection ?? true,
        },
      });
    } catch (error) {
      logger.error(
        { error, route: "GET /api/v1/public/stores/:storeId" },
        "public store lookup failed",
      );
      return res.status(500).json({
        type: "/internal-server-error",
        message: "Internal Server Error",
      });
    }
  },
);

// ---- GET /api/v1/public/stores/:storeId/staff ----

router.get(
  "/api/v1/public/stores/:storeId/staff",
  publicReadRateLimit,
  async (req: Request, res: Response) => {
    try {
      const storeId = getStoreIdFromUrlPath(req);

      if (storeId === undefined) {
        return res.status(400).json({
          type: "/public/stores/invalid-request",
          message: "storeId is required",
        });
      }

      const store = await getStoreById(storeId);

      if (!store) {
        return res.status(404).json({
          type: "/public/stores/store-not-found",
          message: "Store not found",
        });
      }

      const employees = await firestoreRepository.user.listShopEmployees(store.ownerId, {
        storeId: store.id,
        active: true,
      });

      const items = employees.map((employee) => ({
        uid: employee.uid,
        name:
          employee.name?.trim() ||
          employee.displayName?.trim() ||
          employee.email?.split("@")[0] ||
          employee.uid,
        serviceIds: employee.serviceIds,
        workerType:
          employee.workerType ??
          (employee.compensationModel === "fixed" ? "assistant" : "main"),
      }));

      return res.status(200).json({ items });
    } catch (error) {
      logger.error(
        { error, route: "GET /api/v1/public/stores/:storeId/staff" },
        "public staff list failed",
      );
      return res.status(500).json({
        type: "/internal-server-error",
        message: "Internal Server Error",
      });
    }
  },
);

// ---- GET /api/v1/public/stores/:storeId/services ----

router.get(
  "/api/v1/public/stores/:storeId/services",
  publicReadRateLimit,
  async (req: Request, res: Response) => {
    try {
      const storeId = getStoreIdFromUrlPath(req);

      if (storeId === undefined) {
        return res.status(400).json({
          type: "/public/stores/invalid-request",
          message: "storeId is required",
        });
      }

      const store = await getStoreById(storeId);

      if (!store) {
        return res.status(404).json({
          type: "/public/stores/store-not-found",
          message: "Store not found",
        });
      }

      const services = await firestoreRepository.shop.service.getShopServiceFactory(
        store.ownerId,
        store.id,
      );

      const items = services.map((service) => ({
        id: service.id,
        name: service.name,
        category: service.category,
        price: service.price,
        durationMin: service.durationMin,
        durationMax: service.durationMax,
        groupService: service.groupService,
        preferredWorkerType: service.preferredWorkerType ?? "main",
        bookingKind: service.bookingKind ?? "main",
      }));

      return res.status(200).json({ items });
    } catch (error) {
      logger.error(
        { error, route: "GET /api/v1/public/stores/:storeId/services" },
        "public service list failed",
      );
      return res.status(500).json({
        type: "/internal-server-error",
        message: "Internal Server Error",
      });
    }
  },
);

// ---- GET /api/v1/public/stores/:storeId/availability?date=YYYY-MM-DD ----

router.get(
  "/api/v1/public/stores/:storeId/availability",
  publicReadRateLimit,
  async (req: Request, res: Response) => {
    try {
      const storeId = getStoreIdFromUrlPath(req);
      const date = typeof req.query["date"] === "string" ? req.query["date"] : "";

      if (!storeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          type: "/public/stores/invalid-request",
          message: "storeId and date are required",
        });
      }

      const store = await getStoreById(storeId);
      if (!store) {
        return res.status(404).json({
          type: "/public/stores/store-not-found",
          message: "Store not found",
        });
      }

      const [attendanceSnapshot, leaveSnapshot] = await Promise.all([
        firestoreAuth
          .collection("stores")
          .doc(store.id)
          .collection("attendances")
          .where("workDate", "==", date)
          .get(),
        firestoreAuth
          .collection("stores")
          .doc(store.id)
          .collection("employee_leave_requests")
          .where("startDate", "<=", date)
          .get(),
      ]);

      const busy = attendanceSnapshot.docs.flatMap((document) => {
        const attendance = document.data();
        const bookingStatus = attendance["bookingStatus"];
        if (
          attendance["ownerId"] !== store.ownerId ||
          bookingStatus === "cancelled" ||
          bookingStatus === "no_show"
        ) {
          return [];
        }

        const employeeUserId =
          typeof attendance["mainAssigneeUserId"] === "string"
            ? attendance["mainAssigneeUserId"]
            : typeof attendance["employeeUserId"] === "string"
              ? attendance["employeeUserId"]
              : undefined;
        if (!employeeUserId) return [];

        return [{
          attendanceId: document.id,
          bookingId:
            typeof attendance["bookingId"] === "string" ? attendance["bookingId"] : undefined,
          employeeUserId,
          startTime: Number(attendance["startTime"] ?? 0),
          endTime: Number(attendance["endTime"] ?? 0),
          status: typeof bookingStatus === "string" ? bookingStatus : "confirmed",
        }];
      });

      const absences = leaveSnapshot.docs.flatMap((document) => {
        const leave = document.data();
        if (
          leave["ownerId"] !== store.ownerId ||
          typeof leave["endDate"] !== "string" ||
          leave["endDate"] < date ||
          typeof leave["employeeUserId"] !== "string"
        ) {
          return [];
        }

        return [{
          id: document.id,
          employeeUserId: leave["employeeUserId"],
          startDate: String(leave["startDate"]),
          endDate: leave["endDate"],
          allDay: leave["allDay"] !== false,
        }];
      });

      return res.status(200).json({ date, storeId: store.id, busy, absences });
    } catch (error) {
      logger.error(
        { error, route: "GET /api/v1/public/stores/:storeId/availability" },
        "public availability lookup failed",
      );
      return res.status(500).json({
        type: "/internal-server-error",
        message: "Internal Server Error",
      });
    }
  },
);

// ---- POST /api/v1/public/stores/:storeId/bookings ----
// ---- POST /api/v1/public/bookings ----

router.post(
  ["/api/v1/public/stores/:storeId/bookings", "/api/v1/public/bookings"],
  publicBookingRateLimit,
  async (req: Request, res: Response) => {
    let acquiredReservationStoreId: string | undefined;
    let acquiredReservationIds: string[] = [];
    let bookingPersisted = false;
    try {
      const bookingInput = buildCreateBookingInput(req);

      if (!bookingInput.success) {
        return res.status(400).json({
          type: "/public/stores/invalid-request",
          message: "storeId path parameter must match body storeId",
        });
      }

      const parseResult = createBookingSchema.safeParse(bookingInput.input);

      if (!parseResult.success) {
        return res.status(400).json({
          type: "/public/stores/invalid-request",
          message: "Invalid booking request",
          errors: parseResult.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }

      const payload = parseResult.data;

      // 1. Resolve store
      const store = await getStoreById(payload.storeId);

      if (!store) {
        return res.status(404).json({
          type: "/public/stores/store-not-found",
          message: "Store not found",
        });
      }

      const ownerId = store.ownerId;
      const storeName = store.name;
      const storeTimezone = normalizeBusinessTimeZone(store.timezone);
      const settlementCutoffTime = normalizeSettlementCutoffTime(store.settlementCutoffTime);

      // 2. Parse time strings to minutes-of-day
      const [startH, startM] = payload.startTime.split(":").map(Number);
      const startMinutes = (startH ?? 0) * 60 + (startM ?? 0);

      const [endH, endM] = payload.endTime.split(":").map(Number);
      const endMinutes = (endH ?? 0) * 60 + (endM ?? 0);

      const [catalogServices, storeEmployees] = await Promise.all([
        firestoreRepository.shop.service.getShopServiceFactory(ownerId, store.id),
        firestoreRepository.user.listShopEmployees(ownerId, {
          storeId: store.id,
          active: true,
        }),
      ]);
      const catalogServiceMap = new Map(catalogServices.map((service) => [service.id, service]));
      const storeEmployeeMap = new Map(storeEmployees.map((employee) => [employee.uid, employee]));

      const invalidService = payload.services.find(
        (service) => {
          const catalogService = catalogServiceMap.get(service.sourceServiceId);
          return catalogService?.storeId !== store.id || catalogService.bookingKind === "add_on";
        },
      );

      const invalidAddOn = payload.addOns.find((addOn) => {
        const catalogService = catalogServiceMap.get(addOn.sourceServiceId);
        return catalogService?.storeId !== store.id || catalogService.bookingKind !== "add_on";
      });

      if (invalidService || invalidAddOn) {
        return res.status(400).json({
          type: invalidService
            ? "/public/stores/invalid-service"
            : "/public/stores/invalid-addon",
          message: invalidService
            ? "A selected service is unavailable for this store"
            : "A selected add-on is unavailable for this store",
        });
      }

      const invalidEmployee = payload.services.find((service) => {
        if (
          (service.staffSelectionType ?? payload.staffSelectionType) === "any" ||
          service.employeeUserId === undefined
        ) {
          return false;
        }

        const employee = storeEmployeeMap.get(service.employeeUserId);
        return (
          employee === undefined ||
          (employee.serviceIds !== undefined && employee.serviceIds.length > 0 &&
            !employee.serviceIds.includes(service.sourceServiceId))
        );
      });

      if (invalidEmployee) {
        return res.status(400).json({
          type: "/public/stores/invalid-employee",
          message: "A selected employee cannot perform the requested service",
        });
      }

      const [existingAttendanceSnapshot, leaveSnapshot] = await Promise.all([
        firestoreAuth
          .collection("stores")
          .doc(store.id)
          .collection("attendances")
          .where("workDate", "==", payload.appointmentDate)
          .get(),
        firestoreAuth
          .collection("stores")
          .doc(store.id)
          .collection("employee_leave_requests")
          .where("startDate", "<=", payload.appointmentDate)
          .get(),
      ]);
      const activeAttendances = existingAttendanceSnapshot.docs
        .map((document) => document.data())
        .filter(
          (attendance) =>
            attendance["ownerId"] === ownerId &&
            attendance["bookingStatus"] !== "cancelled" &&
            attendance["bookingStatus"] !== "no_show",
        );
      const activeLeave = leaveSnapshot.docs
        .map((document) => document.data())
        .filter(
          (leave) =>
            leave["ownerId"] === ownerId &&
            typeof leave["endDate"] === "string" &&
            leave["endDate"] >= payload.appointmentDate,
        );

      // Client-provided labels and prices are display hints only; persist canonical catalog data.
      const attendanceServices = payload.services.map((service) => {
        const catalogService = catalogServiceMap.get(service.sourceServiceId);

        if (!catalogService) {
          throw new TypeError("Validated booking service is missing from the catalog");
        }

        const employee =
          (service.staffSelectionType ?? payload.staffSelectionType) === "specific" &&
          service.employeeUserId !== undefined
            ? storeEmployeeMap.get(service.employeeUserId)
            : undefined;

        return {
          id: randomUUID(),
          sourceServiceId: catalogService.id,
          ownerId,
          storeId: store.id,
          type: catalogService.type,
          name: catalogService.name,
          category: catalogService.category,
          price: catalogService.price,
          ...(catalogService.description !== undefined && {
            description: catalogService.description,
          }),
          ...(catalogService.imageUrls !== undefined && {
            imageUrls: catalogService.imageUrls,
          }),
          ...(catalogService.durationMin !== undefined && {
            durationMin: catalogService.durationMin,
          }),
          ...(catalogService.durationMax !== undefined && {
            durationMax: catalogService.durationMax,
          }),
          employees:
            employee !== undefined
              ? [
                  {
                    employeeUserId: employee.uid,
                    employeeName:
                      employee.name?.trim() || employee.displayName?.trim() || employee.email,
                    percentage: 100,
                    shareAmount: catalogService.price,
                    workerType:
                      employee.workerType ??
                      (employee.compensationModel === "fixed" ? "assistant" : "main"),
                  },
                ]
              : [],
        };
      });

      const normalizedCustomerPhone = normalizeCustomerPhone(payload.customerPhone);
      if (normalizedCustomerPhone === undefined) {
        return res.status(400).json({
          type: "/public/stores/invalid-request",
          message: "Invalid booking request",
        });
      }
      const customer = await firestoreRepository.shop.customer.createShopCustomer(ownerId, {
        storeId: store.id,
        phone: normalizedCustomerPhone,
        name: payload.customerName,
      });
      if (customer?.blocked === true) {
        return res.status(403).json({
          type: "/public/stores/booking-unavailable",
          message:
            "Không thể đặt lịch tại tiệm này. Vui lòng liên hệ trực tiếp với tiệm để được hỗ trợ.",
        });
      }

      const serviceSegments: Array<{
        service: (typeof attendanceServices)[number];
        staffSelectionType: "specific" | "any";
        startTime: number;
        endTime: number;
      }> = [];
      let serviceCursor = startMinutes;
      for (const [serviceIndex, service] of attendanceServices.entries()) {
        const duration = Math.max(service.durationMax ?? service.durationMin ?? 1, 1);
        serviceSegments.push({
          service,
          staffSelectionType:
            payload.services[serviceIndex]?.staffSelectionType ?? payload.staffSelectionType,
          startTime: serviceCursor,
          endTime: serviceCursor + duration,
        });
        serviceCursor += duration;
      }

      const appointmentEpoch = resolveZonedDateTimeEpoch(
        payload.appointmentDate,
        startMinutes,
        storeTimezone,
      );
      const minimumNoticeMilliseconds = (store.minimumNoticeHours ?? 2) * 60 * 60 * 1000;
      const bookingWindowMilliseconds = (store.bookingWindowDays ?? 30) * 24 * 60 * 60 * 1000;
      const openMinutes = (() => {
        const [hours, minutes] = (store.openTime ?? "09:00").split(":").map(Number);
        return (hours ?? 9) * 60 + (minutes ?? 0);
      })();
      const closeMinutes = (() => {
        const [hours, minutes] = (store.closeTime ?? "18:00").split(":").map(Number);
        return (hours ?? 18) * 60 + (minutes ?? 0);
      })();
      const slotInterval = store.slotIntervalMinutes ?? 15;
      if (process.env["PUBLIC_BOOKING_POLICY_ENFORCEMENT"] !== "off" && (
        appointmentEpoch < Date.now() + minimumNoticeMilliseconds ||
        appointmentEpoch > Date.now() + bookingWindowMilliseconds ||
        startMinutes < openMinutes ||
        serviceCursor > closeMinutes ||
        (startMinutes - openMinutes) % slotInterval !== 0
      )) {
        return res.status(400).json({
          type: "/public/stores/booking-outside-policy",
          message: "The selected appointment is outside this store's booking policy",
        });
      }

      if (serviceCursor !== endMinutes) {
        logger.debug(
          {
            clientEndTime: endMinutes,
            canonicalEndTime: serviceCursor,
            storeId: store.id,
          },
          "public booking end time normalized to canonical service duration",
        );
      }

      if (serviceSegments.some((segment) => segment.staffSelectionType === "any")) {
        const loadByEmployee = new Map<string, number>();
        for (const attendance of activeAttendances) {
          const employeeUserId = attendance["mainAssigneeUserId"] ?? attendance["employeeUserId"];
          if (typeof employeeUserId === "string") {
            loadByEmployee.set(employeeUserId, (loadByEmployee.get(employeeUserId) ?? 0) + 1);
          }
        }

        for (const segment of serviceSegments.filter(
          (candidate) => candidate.staffSelectionType === "any",
        )) {
          const sourceServiceId = segment.service.sourceServiceId;
          const catalogService = catalogServiceMap.get(sourceServiceId);
          const preferredWorkerType = catalogService?.preferredWorkerType ?? "main";
          const eligibleEmployees = storeEmployees
            .filter((employee) => {
              if (
                employee.serviceIds !== undefined &&
                employee.serviceIds.length > 0 &&
                !employee.serviceIds.includes(sourceServiceId)
              ) {
                return false;
              }
              if (activeLeave.some((leave) => leave["employeeUserId"] === employee.uid)) {
                return false;
              }
              const overlapsExisting = activeAttendances.some((attendance) => {
                const assignedEmployeeId = attendance["mainAssigneeUserId"] ?? attendance["employeeUserId"];
                return assignedEmployeeId === employee.uid &&
                  Number(attendance["startTime"] ?? 0) < segment.endTime &&
                  Number(attendance["endTime"] ?? 0) > segment.startTime;
              });
              const overlapsThisBooking = serviceSegments.some((otherSegment) =>
                otherSegment !== segment &&
                otherSegment.service.employees[0]?.employeeUserId === employee.uid &&
                otherSegment.startTime < segment.endTime &&
                otherSegment.endTime > segment.startTime,
              );
              return !overlapsExisting && !overlapsThisBooking;
            })
            .sort((left, right) => {
              const leftType = left.workerType ?? (left.compensationModel === "fixed" ? "assistant" : "main");
              const rightType = right.workerType ?? (right.compensationModel === "fixed" ? "assistant" : "main");
              const typeDifference = Number(rightType === preferredWorkerType) - Number(leftType === preferredWorkerType);
              if (typeDifference !== 0) return typeDifference;
              const loadDifference = (loadByEmployee.get(left.uid) ?? 0) - (loadByEmployee.get(right.uid) ?? 0);
              return loadDifference !== 0 ? loadDifference : left.uid.localeCompare(right.uid);
            });
          const employee = eligibleEmployees[0];
          if (employee) {
            const employeeName = employee.name?.trim() || employee.displayName?.trim() || employee.email;
            const workerType = employee.workerType ?? (employee.compensationModel === "fixed" ? "assistant" : "main");
            segment.service.employees = [{
              employeeUserId: employee.uid,
              employeeName,
              percentage: 100,
              shareAmount: segment.service.price,
              workerType,
            }];
            loadByEmployee.set(employee.uid, (loadByEmployee.get(employee.uid) ?? 0) + 1);
          }
        }
      }

      const conflictedSegments = serviceSegments.filter((segment) => {
        const employeeUserId = segment.service.employees[0]?.employeeUserId;
        if (!employeeUserId) return false;
        const isAbsent = activeLeave.some(
          (leave) => leave["employeeUserId"] === employeeUserId,
        );
        const hasOverlap = activeAttendances.some((attendance) => {
          const assignedEmployeeId =
            attendance["mainAssigneeUserId"] ?? attendance["employeeUserId"];
          return (
            assignedEmployeeId === employeeUserId &&
            Number(attendance["startTime"] ?? 0) < segment.endTime &&
            Number(attendance["endTime"] ?? 0) > segment.startTime
          );
        });
        return isAbsent || hasOverlap;
      });

      const hasUnassignedAnySegment =
        serviceSegments.some(
          (segment) =>
            segment.staffSelectionType === "any" && segment.service.employees.length === 0,
        );

      if ((conflictedSegments.length > 0 || hasUnassignedAnySegment) && payload.bookingMode !== "request") {
        return res.status(409).json({
          type: "/public/stores/booking-conflict",
          message: "The selected time is no longer available",
        });
      }

      if (payload.bookingMode === "request") {
        for (const segment of conflictedSegments) {
          segment.service.employees = [];
        }
      }

      // Services performed by different main employees become separate attendance
      // records while keeping the same booking id.
      const storeWorkDateKey = createStoreWorkDateKey(store.id, payload.appointmentDate);
      const bookingId = randomUUID();
      const bookingCode = `BK-${bookingId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
      acquiredReservationStoreId = store.id;
      acquiredReservationIds = await acquireBookingSlotReservations({
        ownerId,
        storeId: store.id,
        bookingId,
        workDate: payload.appointmentDate,
        segments: serviceSegments.flatMap((segment) => {
          const employeeUserId = segment.service.employees[0]?.employeeUserId;
          return employeeUserId
            ? [{ employeeUserId, startTime: segment.startTime, endTime: segment.endTime }]
            : [];
        }),
      });
      const serviceGroups = new Map<string, typeof serviceSegments>();
      for (const segment of serviceSegments) {
        const groupKey = segment.service.employees[0]?.employeeUserId ?? "__unassigned__";
        serviceGroups.set(groupKey, [...(serviceGroups.get(groupKey) ?? []), segment]);
      }

      const createdAttendances: ShopAttendanceType[] = [];
      for (const groupedSegments of serviceGroups.values()) {
        const firstSegment = groupedSegments[0];
        const lastSegment = groupedSegments.at(-1);
        if (!firstSegment || !lastSegment) continue;
        const groupedServices = groupedSegments.map((segment) => segment.service);
        const mainEmployee = firstSegment.service.employees[0];
        const subtotalAmount = sumMoney(groupedServices.map((service) => service.price));
        const bookingStatus: ShopAttendanceBookingStatus =
          payload.bookingMode === "request"
            ? "requested"
            : mainEmployee
              ? "confirmed"
              : "processing";
        const assignees = mainEmployee
          ? [
              {
                employeeUserId: mainEmployee.employeeUserId,
                employeeName: mainEmployee.employeeName,
                workerType: mainEmployee.workerType,
                percentage: 100,
                shareAmount: subtotalAmount,
              },
            ]
          : [];
        const services = groupedServices.map((service) => ({
          ...service,
          employees: service.employees.map((employee) => ({
            ...employee,
            workerType: employee.workerType,
          })),
        }));
        const attendanceDocumentData: Omit<
          ShopAttendanceType,
          "id" | "attendanceCode" | "ownerId" | "createdAt" | "updatedAt"
        > = {
          bookingId,
          storeId: store.id,
          storeName,
          storeWorkDateKey,
          workDate: payload.appointmentDate,
          storeTimezone,
          settlementCutoffTime,
          startTime: firstSegment.startTime,
          endTime: lastSegment.endTime,
          customerName: payload.customerName,
          customerPhone: normalizedCustomerPhone,
          ...(customer !== undefined && { customerId: customer.id }),
          ...(payload.notes !== undefined && { note: payload.notes }),
          bookingSource: payload.source,
          assignees,
          services,
          subtotalAmount,
          totalAmount: subtotalAmount,
          status: "open",
          bookingStatus,
          source: "online_booking",
          createdBy: "booking_system",
          updatedBy: "booking_system",
          createdByType: "customer",
          ...(customer !== undefined && { createdByUserId: customer.id }),
          createdByRole: "customer",
          ...(customer !== undefined && { updatedByUserId: customer.id }),
          updatedByRole: "customer",
          ...(mainEmployee !== undefined && {
            employeeUserId: mainEmployee.employeeUserId,
            mainAssigneeUserId: mainEmployee.employeeUserId,
          }),
        };

        createdAttendances.push(
          await firestoreRepository.shop.attendance.createShopAttendance(
            ownerId,
            attendanceDocumentData,
          ),
        );
      }

      const addOns: ShopBookingAddonType[] = payload.addOns.map((addOn) => {
        const catalogService = addOn.sourceServiceId
          ? catalogServiceMap.get(addOn.sourceServiceId)
          : undefined;
        return {
          id: randomUUID(),
          ...(catalogService !== undefined
            ? { sourceServiceId: catalogService.id, name: catalogService.name, price: catalogService.price }
            : {
                ...(addOn.sourceServiceId !== undefined && {
                  sourceServiceId: addOn.sourceServiceId,
                }),
                name: addOn.name,
                price: addOn.price,
              }),
        };
      });
      const attendanceSubtotal = sumMoney(
        createdAttendances.map((attendance) => attendance.subtotalAmount),
      );
      const bookingSubtotal = sumMoney([
        attendanceSubtotal,
        ...addOns.map((addOn) => addOn.price),
      ]);
      const bookingStatus: ShopAttendanceBookingStatus =
        payload.bookingMode === "request"
          ? "requested"
          : createdAttendances.every((attendance) => attendance.bookingStatus === "confirmed")
            ? "confirmed"
            : "processing";
      const timestamp = Date.now();
      const actorId = customer?.id ?? "booking_system";
      const booking: ShopBookingType = {
        id: bookingId,
        bookingCode,
        ownerId,
        storeId: store.id,
        ...(customer !== undefined && { customerId: customer.id }),
        customerName: payload.customerName,
        customerPhone: normalizedCustomerPhone,
        ...(payload.customerEmail !== undefined && { customerEmail: payload.customerEmail }),
        workDate: payload.appointmentDate,
        attendanceIds: createdAttendances.map((attendance) => attendance.id),
        slotReservationIds: acquiredReservationIds,
        addOns,
        subtotalAmount: bookingSubtotal,
        totalAmount: bookingSubtotal,
        bookingStatus,
        source: "online_booking",
        ...(payload.notes !== undefined && { notes: payload.notes }),
        createdByType: "customer",
        createdById: actorId,
        createdByRole: "customer",
        createdAt: timestamp,
        updatedByType: "customer",
        updatedById: actorId,
        updatedByRole: "customer",
        updatedAt: timestamp,
      };
      await firestoreAuth
        .collection("stores")
        .doc(store.id)
        .collection("bookings")
        .doc(bookingId)
        .set(booking);
      bookingPersisted = true;
      await synchronizeWorkDaySettlement(ownerId, store.id, payload.appointmentDate);

      const createdAttendance = createdAttendances[0];
      if (!createdAttendance) {
        throw new TypeError("Public booking did not create an attendance");
      }

      logger.info(
        {
          attendanceIds: createdAttendances.map((attendance) => attendance.id),
          bookingId,
          storeId: store.id,
          appointmentDate: payload.appointmentDate,
          source: payload.source,
          serviceCount: payload.services.length,
        },
        "public booking created",
      );

      // 9. Return response
      return res.status(201).json({
        item: {
          id: createdAttendance.id,
          bookingId,
          bookingCode,
          attendanceCode: createdAttendance.attendanceCode ?? bookingCode,
          workDate: createdAttendance.workDate,
          startTime: createdAttendance.startTime,
          endTime: createdAttendance.endTime,
          customerName: createdAttendance.customerName,
          status: bookingStatus,
        },
        items: createdAttendances.map((attendance) => ({
          id: attendance.id,
          workDate: attendance.workDate,
          startTime: attendance.startTime,
          endTime: attendance.endTime,
          customerName: attendance.customerName,
          status: attendance.bookingStatus ?? attendance.status,
          attendanceCode: attendance.attendanceCode,
        })),
        meta: {
          storeId: store.id,
          storeName,
          bookingId,
          bookingCode,
          addOns,
        },
      });
    } catch (error) {
      if (!bookingPersisted && acquiredReservationStoreId && acquiredReservationIds.length > 0) {
        await releaseBookingSlotReservations(
          acquiredReservationStoreId,
          acquiredReservationIds,
        ).catch(() => undefined);
      }
      if (error instanceof BookingSlotConflictError) {
        return res.status(409).json({
          type: "/public/stores/booking-conflict",
          message: error.message,
        });
      }
      logger.error(
        { error, route: buildCreateBookingInput(req).route },
        "public booking creation failed",
      );
      return res.status(500).json({
        type: "/internal-server-error",
        message: "Internal Server Error",
      });
    }
  },
);

export default router;
