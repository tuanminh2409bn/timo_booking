import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { normalizeCustomerPhone } from "../../helpers/customer-phone.js";
import {
  getBookingSlotReservationIds,
  releaseBookingSlotReservations,
} from "../booking/slot-reservations.js";
import { normalizeBusinessTimeZone } from "../../helpers/business-day.js";
import { logger } from "../../modules/logger.js";
import {
  buildIpRateLimitFingerprint,
  createRequestRateLimit,
} from "../../modules/request-rate-limit.js";
import { firestoreAuth } from "../../repository/firestore/index.js";
import { canCustomerCancelBooking } from "./cancellation-policy.js";

const COOKIE_NAME = "timmo_customer_session";
const OTP_TTL_MS = 5 * 60_000;
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const requestSchema = z.object({ phone: z.string().trim().min(1).max(30) });
const verifySchema = requestSchema.extend({ otp: z.string().regex(/^\d{6}$/) });

const otpRateLimit = createRequestRateLimit({
  keyPrefix: "ratelimit:customer-otp",
  limit: 5,
  windowMs: 10 * 60_000,
  message: "Too many OTP requests",
  fingerprintBuilder: buildIpRateLimitFingerprint,
});
const portalRateLimit = createRequestRateLimit({
  keyPrefix: "ratelimit:customer-portal",
  limit: 60,
  windowMs: 60_000,
  message: "Too many customer portal requests",
  fingerprintBuilder: buildIpRateLimitFingerprint,
});

const getJwtSecret = (): string => {
  const value = process.env["JWT_SECRET"];
  if (!value) throw new TypeError("JWT_SECRET is required for the customer portal");
  return value;
};
const phoneKey = (phone: string): string =>
  createHash("sha256").update(phone).digest("hex");
const otpHash = (phone: string, otp: string): string =>
  createHash("sha256").update(`${phone}:${otp}:${getJwtSecret()}`).digest("hex");
const sessionRef = (phone: string) =>
  firestoreAuth.collection("customer_otp_sessions").doc(phoneKey(phone));

const sendSms = async (phone: string, otp: string): Promise<boolean> => {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  const from = process.env["TWILIO_FROM_NUMBER"];
  if (!accountSid || !authToken || !from) return false;

  const body = new URLSearchParams({
    To: phone,
    From: from,
    Body: `Timmo verification code: ${otp}. It expires in 5 minutes.`,
  });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );
  return response.ok;
};

type CustomerSession = { purpose: "customer_session"; phone: string };

const parseCookies = (header: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((item) => item.trim().split("="))
      .filter((parts) => parts.length === 2)
      .map(([key, value]) => [key ?? "", decodeURIComponent(value ?? "")]),
  );

const getCustomerSession = (request: express.Request): CustomerSession | undefined => {
  const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
  if (!token) return undefined;
  try {
    const payload: unknown = jwt.verify(token, getJwtSecret());
    if (
      typeof payload === "object" &&
      payload !== null &&
      (payload as Record<string, unknown>)["purpose"] === "customer_session" &&
      typeof (payload as Record<string, unknown>)["phone"] === "string"
    ) {
      return payload as CustomerSession;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const zonedAppointmentEpoch = (
  workDate: string,
  startMinutes: number,
  timeZone: string,
): number => {
  const [year, month, day] = workDate.split("-").map(Number);
  const hour = Math.floor(startMinutes / 60);
  const minute = startMinutes % 60;
  const wallClock = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour, minute);
  let epoch = wallClock;

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(epoch));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(values["year"]),
      Number(values["month"]) - 1,
      Number(values["day"]),
      Number(values["hour"]),
      Number(values["minute"]),
      Number(values["second"]),
    );
    epoch = wallClock - (represented - epoch);
  }
  return epoch;
};

const router = express.Router();

router.post("/api/v1/customer/auth/request-otp", otpRateLimit, async (request, response) => {
  const parsed = requestSchema.safeParse(request.body);
  const phone = parsed.success ? normalizeCustomerPhone(parsed.data.phone) : undefined;
  if (!phone) {
    return response.status(400).json({ type: "/customer/invalid-phone", message: "Invalid phone" });
  }

  const reference = sessionRef(phone);
  const existing = await reference.get();
  const existingData = existing.data();
  if (
    existing.exists &&
    typeof existingData?.["resendAt"] === "number" &&
    existingData["resendAt"] > Date.now()
  ) {
    return response.status(429).json({
      type: "/customer/otp-resend-too-soon",
      message: "Please wait before requesting another code",
    });
  }

  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const delivered = await sendSms(phone, otp);
  if (!delivered && process.env["NODE_ENV"] === "production") {
    return response.status(503).json({
      type: "/customer/sms-unavailable",
      message: "SMS delivery is not configured",
    });
  }

  await reference.set({
    phone,
    hash: otpHash(phone, otp),
    expiresAt: Date.now() + OTP_TTL_MS,
    resendAt: Date.now() + 60_000,
    failedAttempts: 0,
    createdAt: Date.now(),
  });
  logger.info({ event: "customer.otp.requested", delivered }, "customer OTP requested");
  return response.status(200).json({
    success: true,
    expiresInMs: OTP_TTL_MS,
    ...(!delivered && process.env["NODE_ENV"] !== "production" && { debugOtp: otp }),
  });
});

router.post("/api/v1/customer/auth/verify-otp", otpRateLimit, async (request, response) => {
  const parsed = verifySchema.safeParse(request.body);
  const phone = parsed.success ? normalizeCustomerPhone(parsed.data.phone) : undefined;
  if (!parsed.success || !phone) {
    return response.status(400).json({ type: "/customer/invalid-otp", message: "Invalid OTP" });
  }

  const reference = sessionRef(phone);
  const document = await reference.get();
  const data = document.data();
  if (!document.exists || typeof data?.["expiresAt"] !== "number" || data["expiresAt"] < Date.now()) {
    return response.status(410).json({ type: "/customer/otp-expired", message: "OTP expired" });
  }

  const expected = Buffer.from(String(data["hash"] ?? ""));
  const actual = Buffer.from(otpHash(phone, parsed.data.otp));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    const failedAttempts = Number(data["failedAttempts"] ?? 0) + 1;
    if (failedAttempts >= 5) await reference.delete();
    else await reference.update({ failedAttempts });
    return response.status(400).json({ type: "/customer/invalid-otp", message: "Invalid OTP" });
  }

  await reference.delete();
  const token = jwt.sign({ purpose: "customer_session", phone }, getJwtSecret(), {
    expiresIn: SESSION_TTL_SECONDS,
  });
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
  await firestoreAuth.collection("customer_audit_logs").add({
    eventType: "customer_login",
    phoneKey: phoneKey(phone),
    createdAt: Date.now(),
  });
  return response.status(200).json({ success: true });
});

router.post("/api/v1/customer/auth/logout", portalRateLimit, async (_request, response) => {
  response.clearCookie(COOKIE_NAME, { path: "/" });
  return response.status(200).json({ success: true });
});

router.get("/api/v1/customer/bookings", portalRateLimit, async (request, response) => {
  const session = getCustomerSession(request);
  if (!session) return response.status(401).json({ message: "Customer session required" });

  const snapshot = await firestoreAuth
    .collectionGroup("bookings")
    .where("customerPhone", "==", session.phone)
    .get();
  const items = await Promise.all(snapshot.docs.map(async (document) => {
    const booking = document.data();
    const storeId = String(booking["storeId"] ?? "");
    const attendanceIds = Array.isArray(booking["attendanceIds"])
      ? booking["attendanceIds"].filter((id): id is string => typeof id === "string")
      : [];
    const [storeDocument, ...attendanceDocuments] = await Promise.all([
      firestoreAuth.collection("stores").doc(storeId).get(),
      ...attendanceIds.map((id) =>
        firestoreAuth.collection("stores").doc(storeId).collection("attendances").doc(id).get(),
      ),
    ]);
    const attendances = attendanceDocuments
      .filter((item) => item.exists)
      .map((item) => item.data() as Record<string, unknown>);
    const startTime = attendances.length > 0
      ? Math.min(...attendances.map((attendance) => Number(attendance["startTime"] ?? 0)))
      : 0;
    const workDate = String(booking["workDate"] ?? "");
    const storeData = storeDocument.data();
    const timeZone = normalizeBusinessTimeZone(
      typeof storeData?.["timezone"] === "string" ? storeData["timezone"] : undefined,
    );
    const appointmentEpoch = zonedAppointmentEpoch(workDate, startTime, timeZone);
    const bookingStatus = String(booking["bookingStatus"] ?? "confirmed");
    const status =
      attendances.length > 0 && attendances.every((attendance) => attendance["status"] === "closed")
        ? "completed"
        : bookingStatus;
    const cancellationNoticeHours =
      typeof storeData?.["cancellationNoticeHours"] === "number"
        ? storeData["cancellationNoticeHours"]
        : 12;

    return {
      id: document.id,
      bookingCode: booking["bookingCode"],
      storeId,
      salonName: storeData?.["name"] ?? storeId,
      address: storeData?.["address"],
      workDate,
      status,
      services: attendances.flatMap((attendance) =>
        Array.isArray(attendance["services"])
          ? attendance["services"].map((service) => {
              const value = service as Record<string, unknown>;
              return { name: value["name"], price: value["price"] };
            })
          : [],
      ),
      addOns: Array.isArray(booking["addOns"]) ? booking["addOns"] : [],
      startTime,
      canCancel: canCustomerCancelBooking({
        bookingStatus,
        appointmentEpoch,
        cancellationNoticeHours,
      }),
    };
  }));
  items.sort((left, right) => String(right.workDate).localeCompare(String(left.workDate)));
  return response.status(200).json({ items });
});

router.post(
  "/api/v1/customer/bookings/:bookingId/cancel",
  portalRateLimit,
  async (request, response) => {
    const session = getCustomerSession(request);
    if (!session) return response.status(401).json({ message: "Customer session required" });

    const bookingId = String(request.params["bookingId"] ?? "");
    const snapshot = await firestoreAuth
      .collectionGroup("bookings")
      .where("customerPhone", "==", session.phone)
      .where("id", "==", bookingId)
      .limit(1)
      .get();
    const bookingDocument = snapshot.docs[0];
    if (!bookingDocument) return response.status(404).json({ message: "Booking not found" });

    const booking = bookingDocument.data();
    const bookingStatus = String(booking["bookingStatus"] ?? "confirmed");
    if (!["confirmed", "requested", "processing"].includes(bookingStatus)) {
      return response.status(409).json({
        type: "/customer/booking-not-cancellable",
        message: "This booking cannot be cancelled",
      });
    }

    const storeId = String(booking["storeId"] ?? "");
    const attendanceIds = Array.isArray(booking["attendanceIds"])
      ? booking["attendanceIds"].filter((id): id is string => typeof id === "string")
      : [];
    const [storeDocument, firstAttendanceDocument] = await Promise.all([
      firestoreAuth.collection("stores").doc(storeId).get(),
      attendanceIds[0]
        ? firestoreAuth.collection("stores").doc(storeId).collection("attendances").doc(attendanceIds[0]).get()
        : Promise.resolve(undefined),
    ]);
    const storeData = storeDocument.data();
    const cancellationNoticeHours =
      typeof storeData?.["cancellationNoticeHours"] === "number"
        ? storeData["cancellationNoticeHours"]
        : 12;
    const appointmentEpoch = zonedAppointmentEpoch(
      String(booking["workDate"] ?? ""),
      Number(firstAttendanceDocument?.data()?.["startTime"] ?? 0),
      normalizeBusinessTimeZone(
        typeof storeData?.["timezone"] === "string" ? storeData["timezone"] : undefined,
      ),
    );
    if (!canCustomerCancelBooking({
      bookingStatus,
      appointmentEpoch,
      cancellationNoticeHours,
    })) {
      return response.status(409).json({
        type: "/customer/cancellation-window-closed",
        message: `Bookings may only be cancelled at least ${cancellationNoticeHours} hours before the appointment`,
      });
    }

    const batch = firestoreAuth.batch();
    const timestamp = Date.now();
    for (const attendanceId of attendanceIds) {
      batch.update(
        firestoreAuth.collection("stores").doc(storeId).collection("attendances").doc(attendanceId),
        {
          bookingStatus: "cancelled",
          updatedBy: phoneKey(session.phone),
          updatedByUserId: phoneKey(session.phone),
          updatedByRole: "customer",
          updatedAt: timestamp,
        },
      );
    }
    batch.update(bookingDocument.ref, {
      bookingStatus: "cancelled",
      updatedByType: "customer",
      updatedById: phoneKey(session.phone),
      updatedByRole: "customer",
      updatedAt: timestamp,
    });
    batch.set(firestoreAuth.collection("customer_audit_logs").doc(), {
      eventType: "customer_booking_cancelled",
      bookingId,
      storeId,
      phoneKey: phoneKey(session.phone),
      createdAt: timestamp,
    });
    await batch.commit();
    await releaseBookingSlotReservations(
      storeId,
      getBookingSlotReservationIds(booking),
    );
    return response.status(200).json({ success: true });
  },
);

export default router;
