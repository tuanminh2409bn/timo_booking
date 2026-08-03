import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  normalizeBusinessTimeZone,
  normalizeSettlementCutoffTime,
  resolveBusinessWorkDate,
} from "../../helpers/business-day.js";
import { canAccessStore } from "../../helpers/role-access.js";
import { createStoreWorkDateKey } from "../../helpers/work-date-utils.js";
import { sumMoney } from "../../helpers/money.js";
import { normalizeCustomerPhone } from "../../helpers/customer-phone.js";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firestoreAuth, firestoreRepository } from "../../repository/firestore/index.js";
import type {
  ShopAttendanceType,
  ShopBookingAddonType,
  ShopBookingType,
} from "../../repository/firestore/shop/shop.types.js";
import { synchronizeWorkDaySettlement } from "../employee/work-days/work-day-settlement-sync.js";
import {
  acquireBookingSlotReservations,
  BookingSlotConflictError,
  releaseBookingSlotReservations,
} from "./slot-reservations.js";

const serviceSchema = z.object({
  sourceServiceId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(50).optional(),
  durationMinutes: z.number().int().positive().max(720),
  price: z.number().min(0),
  employeeUserId: z.string().trim().min(1),
});
const addOnSchema = z.object({
  sourceServiceId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(100),
  price: z.number().min(0),
});
const payloadSchema = z.object({
  customerName: z.string().trim().max(100).optional().default(""),
  customerPhone: z.string().trim().max(30).optional().default(""),
  customerEmail: z.string().trim().email().max(100).optional(),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  services: z.array(serviceSchema).min(1).max(2),
  addOns: z.array(addOnSchema).max(20).optional().default([]),
  source: z.enum(["manual_booking", "walk_in"]),
  notes: z.string().trim().max(500).optional(),
});

export const createAuthenticatedBooking = async (request: Request, response: Response) => {
  let acquiredReservationIds: string[] = [];
  let acquiredReservationStoreId: string | undefined;
  let bookingPersisted = false;
  try {
  const authContext = await verifyAuthorizationHeader(request.headers["authorization"]);
  const storeId = String(request.params["storeId"] ?? "");
  const parsed = payloadSchema.safeParse(request.body);
  if (!storeId || !parsed.success) {
    return response.status(400).json({
      type: "/booking/invalid-request",
      message: "Invalid booking request",
      ...(!parsed.success && { errors: parsed.error.flatten().fieldErrors }),
    });
  }
  if (!canAccessStore(authContext, storeId)) {
    return response.status(403).json({
      type: "/booking/forbidden-store",
      message: "Forbidden: store access denied",
    });
  }

  const payload = parsed.data;
  if (authContext.role === "employee") {
    if (
      payload.source !== "walk_in" ||
      payload.services.some((service) => service.employeeUserId !== authContext.uid)
    ) {
      return response.status(403).json({
        type: "/booking/forbidden-employee-booking",
        message: "Employees may only record their own walk-in work",
      });
    }
  } else if (authContext.role !== "owner" && authContext.role !== "manager") {
    return response.status(403).json({
      type: "/booking/forbidden",
      message: "Forbidden: insufficient permissions",
    });
  }

  const store = await firestoreRepository.shop.store.getStore(authContext.ownerId, storeId);
  const storeTimezone = normalizeBusinessTimeZone(store.timezone);
  const settlementCutoffTime = normalizeSettlementCutoffTime(store.settlementCutoffTime);
  const today = resolveBusinessWorkDate(Date.now(), {
    timeZone: storeTimezone,
    settlementCutoffTime,
  });
  if (authContext.role === "employee" && payload.appointmentDate > today) {
    return response.status(403).json({
      type: "/booking/forbidden-employee-booking",
      message: "Employees cannot create a future booking",
    });
  }
  if (authContext.role === "employee") {
    const closing = await firestoreRepository.shop.settlement.getWorkDaySettlement(
      authContext.ownerId,
      storeId,
      payload.appointmentDate,
    );
    if (closing?.status === "closed") {
      return response.status(409).json({
        type: "/booking/work-day-closed",
        message: "Walk-in cannot be recorded after the work day is closed",
      });
    }
  }

  const [catalogServices, employees] = await Promise.all([
    firestoreRepository.shop.service.getShopServiceFactory(authContext.ownerId, storeId),
    firestoreRepository.user.listShopEmployees(authContext.ownerId, { storeId, active: true }),
  ]);
  const serviceMap = new Map(catalogServices.map((service) => [service.id, service]));
  const employeeMap = new Map(employees.map((employee) => [employee.uid, employee]));
  const invalidService = payload.services.find((service) => {
    const catalogService = serviceMap.get(service.sourceServiceId);
    return !catalogService || catalogService.bookingKind === "add_on";
  });
  const invalidAddOn = payload.addOns.find(
    (addOn) => serviceMap.get(addOn.sourceServiceId)?.bookingKind !== "add_on",
  );
  const invalidEmployee = payload.services.find((service) => {
    const employee = employeeMap.get(service.employeeUserId);
    return !employee || (employee.serviceIds !== undefined && !employee.serviceIds.includes(service.sourceServiceId));
  });
  if (invalidService || invalidAddOn || invalidEmployee) {
    return response.status(400).json({
      type: invalidService
        ? "/booking/invalid-service"
        : invalidAddOn
          ? "/booking/invalid-addon"
          : "/booking/invalid-staff",
      message: invalidService
        ? "A selected service is unavailable for this store"
        : invalidAddOn
          ? "A selected add-on is unavailable for this store"
          : "A selected employee cannot perform the requested service",
    });
  }

  const customerName = payload.customerName.trim() || "Walk-in";
  const normalizedCustomerPhone = payload.customerPhone.trim()
    ? normalizeCustomerPhone(payload.customerPhone)
    : undefined;
  if (payload.customerPhone.trim() && normalizedCustomerPhone === undefined) {
    return response.status(400).json({
      type: "/booking/invalid-customer-phone",
      message: "Customer phone number is invalid",
    });
  }
  const customer = await firestoreRepository.shop.customer.createShopCustomer(authContext.ownerId, {
    storeId,
    ...(normalizedCustomerPhone && { phone: normalizedCustomerPhone }),
    ...(payload.customerName.trim() && { name: payload.customerName }),
  });
  if (customer?.blocked) {
    return response.status(403).json({
      type: "/booking/customer-blocked",
      message: "Không thể đặt lịch tại tiệm này. Vui lòng liên hệ trực tiếp với tiệm để được hỗ trợ.",
    });
  }

  const [startHour, startMinute] = payload.startTime.split(":").map(Number);
  let cursor = (startHour ?? 0) * 60 + (startMinute ?? 0);
  const segments = payload.services.map((input) => {
    const catalogService = serviceMap.get(input.sourceServiceId);
    if (!catalogService) throw new TypeError("Validated service is missing from the catalog");
    const duration = Math.max(catalogService.durationMax ?? catalogService.durationMin ?? input.durationMinutes, 1);
    const segment = { input, catalogService, startTime: cursor, endTime: cursor + duration };
    cursor = segment.endTime;
    return segment;
  });
  const [existingAttendanceSnapshot, leaveSnapshot] = await Promise.all([
    firestoreAuth
      .collection("stores")
      .doc(storeId)
      .collection("attendances")
      .where("workDate", "==", payload.appointmentDate)
      .get(),
    firestoreAuth
      .collection("stores")
      .doc(storeId)
      .collection("employee_leave_requests")
      .where("startDate", "<=", payload.appointmentDate)
      .get(),
  ]);
  const hasConflict = segments.some((segment) => {
    const employeeUserId = segment.input.employeeUserId;
    const isOnLeave = leaveSnapshot.docs.some((document) => {
      const leave = document.data();
      return leave["ownerId"] === authContext.ownerId &&
        leave["employeeUserId"] === employeeUserId &&
        typeof leave["endDate"] === "string" &&
        leave["endDate"] >= payload.appointmentDate;
    });
    const hasOverlap = existingAttendanceSnapshot.docs.some((document) => {
      const attendance = document.data();
      const assignedEmployeeId = attendance["mainAssigneeUserId"] ?? attendance["employeeUserId"];
      return attendance["ownerId"] === authContext.ownerId &&
        attendance["bookingStatus"] !== "cancelled" &&
        attendance["bookingStatus"] !== "no_show" &&
        assignedEmployeeId === employeeUserId &&
        Number(attendance["startTime"] ?? 0) < segment.endTime &&
        Number(attendance["endTime"] ?? 0) > segment.startTime;
    });
    return isOnLeave || hasOverlap;
  });
  if (hasConflict) {
    return response.status(409).json({
      type: "/booking/booking-conflict",
      message: "The selected employee is unavailable at this time",
    });
  }
  const grouped = new Map<string, typeof segments>();
  for (const segment of segments) {
    grouped.set(segment.input.employeeUserId, [
      ...(grouped.get(segment.input.employeeUserId) ?? []),
      segment,
    ]);
  }

  const bookingId = randomUUID();
  const bookingCode = `BK-${bookingId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  acquiredReservationStoreId = storeId;
  acquiredReservationIds = await acquireBookingSlotReservations({
    ownerId: authContext.ownerId,
    storeId,
    bookingId,
    workDate: payload.appointmentDate,
    segments: segments.map((segment) => ({
      employeeUserId: segment.input.employeeUserId,
      startTime: segment.startTime,
      endTime: segment.endTime,
    })),
  });
  const attendanceItems: ShopAttendanceType[] = [];
  for (const [employeeUserId, employeeSegments] of grouped.entries()) {
    const employee = employeeMap.get(employeeUserId);
    const first = employeeSegments[0];
    const last = employeeSegments.at(-1);
    if (!employee || !first || !last) continue;
    const employeeName = employee.name?.trim() || employee.displayName?.trim() || employee.email;
    const workerType = employee.workerType ??
      (employee.compensationModel === "fixed" ? "assistant" : "main");
    const services = employeeSegments.map(({ catalogService }) => ({
      ...catalogService,
      id: randomUUID(),
      sourceServiceId: catalogService.id,
      employees: [{
        employeeUserId,
        employeeName,
        workerType,
        percentage: 100,
        shareAmount: catalogService.price,
      }],
    }));
    const subtotalAmount = sumMoney(services.map((service) => service.price));
    const attendanceData: Omit<
      ShopAttendanceType,
      "id" | "attendanceCode" | "ownerId" | "createdAt" | "updatedAt"
    > = {
      bookingId,
      employeeUserId,
      mainAssigneeUserId: employeeUserId,
      storeId,
      storeName: store.name,
      storeWorkDateKey: createStoreWorkDateKey(storeId, payload.appointmentDate),
      workDate: payload.appointmentDate,
      storeTimezone,
      settlementCutoffTime,
      startTime: first.startTime,
      endTime: last.endTime,
      ...(customer !== undefined && { customerId: customer.id }),
      customerName,
      ...(normalizedCustomerPhone && { customerPhone: normalizedCustomerPhone }),
      ...(payload.notes !== undefined && { note: payload.notes }),
      bookingSource: payload.source,
      assignees: [{
        employeeUserId,
        employeeName,
        workerType,
        percentage: 100,
        shareAmount: subtotalAmount,
      }],
      services,
      subtotalAmount,
      totalAmount: subtotalAmount,
      status: payload.source === "walk_in" ? "closed" : "open",
      bookingStatus: "confirmed",
      source: payload.source,
      createdBy: authContext.uid,
      updatedBy: authContext.uid,
      createdByType: authContext.role === "employee" ? "employee" : authContext.role,
      createdByUserId: authContext.uid,
      createdByRole: authContext.role === "employee" ? "employee" : authContext.role,
      updatedByUserId: authContext.uid,
      updatedByRole: authContext.role === "employee" ? "employee" : authContext.role,
    };
    attendanceItems.push(
      await firestoreRepository.shop.attendance.createShopAttendance(
        authContext.ownerId,
        attendanceData,
      ),
    );
  }

  const addOns: ShopBookingAddonType[] = payload.addOns.map((addOn) => {
    const catalogService = serviceMap.get(addOn.sourceServiceId);
    if (!catalogService) throw new TypeError("Validated add-on is missing from the catalog");
    return {
      id: randomUUID(),
      sourceServiceId: catalogService.id,
      name: catalogService.name,
      price: catalogService.price,
    };
  });
  const subtotalAmount = sumMoney([
    ...attendanceItems.map((attendance) => attendance.subtotalAmount),
    ...addOns.map((addOn) => addOn.price),
  ]);
  const timestamp = Date.now();
  const booking: ShopBookingType = {
    id: bookingId,
    bookingCode,
    ownerId: authContext.ownerId,
    storeId,
    ...(customer !== undefined && { customerId: customer.id }),
    customerName,
    customerPhone: normalizedCustomerPhone ?? "",
    ...(payload.customerEmail !== undefined && { customerEmail: payload.customerEmail }),
    workDate: payload.appointmentDate,
    attendanceIds: attendanceItems.map((attendance) => attendance.id),
    slotReservationIds: acquiredReservationIds,
    addOns,
    subtotalAmount,
    totalAmount: subtotalAmount,
    bookingStatus: "confirmed",
    source: payload.source,
    ...(payload.notes !== undefined && { notes: payload.notes }),
    createdByType: "user",
    createdById: authContext.uid,
    createdByRole: authContext.role === "employee" ? "employee" : authContext.role,
    createdAt: timestamp,
    updatedByType: "user",
    updatedById: authContext.uid,
    updatedByRole: authContext.role === "employee" ? "employee" : authContext.role,
    updatedAt: timestamp,
  };
  await firestoreAuth.collection("stores").doc(storeId).collection("bookings").doc(bookingId).set(booking);
  bookingPersisted = true;
  await synchronizeWorkDaySettlement(authContext.ownerId, storeId, payload.appointmentDate);

  return response.status(201).json({
    item: {
      bookingId,
      bookingCode,
      status: booking.bookingStatus,
      attendances: attendanceItems.map((attendance) => ({
        id: attendance.id,
        attendanceCode: attendance.attendanceCode,
        employeeUserId: attendance.employeeUserId,
        startTime: attendance.startTime,
        endTime: attendance.endTime,
      })),
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
      return response.status(409).json({
        type: "/booking/booking-conflict",
        message: error.message,
      });
    }
    throw error;
  }
};
