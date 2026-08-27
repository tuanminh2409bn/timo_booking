import type { Request, Response } from "express";
import { z } from "zod";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { isAttendanceAssignedToUser } from "../domain/attendance-rules.js";
import { toFrontendAttendanceItem } from "../domain/attendance-presentation.js";

const querySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

const SEARCH_FROM_DATE = "0001-01-01";
const SEARCH_TO_DATE = "9999-12-31";
const SEARCH_RESULT_LIMIT = 100;

const normalizeSearchText = (value: unknown): string => String(value ?? "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase();

export const searchAttendances = async (request: Request, response: Response) => {
  const authContext = await verifyAuthorizationHeader(request.headers["authorization"]);
  const storeId = String(request.params["storeId"] ?? "").trim();
  const parsed = querySchema.safeParse(request.query);

  if (!storeId || !parsed.success) {
    return response.status(400).json({
      type: "/stores/attendances/search/invalid-request",
      message: "Search text must contain at least 2 characters",
    });
  }
  if (!canAccessStore(authContext, storeId)) {
    return response.status(403).json({
      type: "/stores/attendances/search/forbidden-store",
      message: "Forbidden: store access denied",
    });
  }

  const store = await firestoreRepository.shop.store
    .getStore(authContext.ownerId, storeId)
    .catch((error: unknown) => {
      if (error instanceof FirestoreDataNotFoundError) return null;
      throw error;
    });
  if (!store) {
    return response.status(403).json({
      type: "/stores/attendances/search/forbidden-store",
      message: "Forbidden: store access denied",
    });
  }

  const needle = normalizeSearchText(parsed.data.q);
  const compactNeedle = needle.replace(/[^a-z0-9]/g, "");
  const allAttendances = await firestoreRepository.shop.attendance.listShopAttendanceByStoreDateRange(
    authContext.ownerId,
    storeId,
    SEARCH_FROM_DATE,
    SEARCH_TO_DATE,
    { skipCache: true },
  );
  const scopedAttendances = authContext.role === "employee"
    ? allAttendances.filter((attendance) =>
        isAttendanceAssignedToUser(attendance, authContext.uid) ||
        attendance.originatedAsRequest === true ||
        (attendance.bookingStatus === "processing" && attendance.staffSelectionType !== "specific"),
      )
    : allAttendances;
  const matches = scopedAttendances.filter((attendance) => {
    const haystack = normalizeSearchText([
      attendance.attendanceCode,
      attendance.bookingId,
      attendance.customerName,
      attendance.customerPhone,
      attendance.note,
      ...attendance.services.flatMap((service) => [
        service.name,
        service.displayName,
        service.serviceCode,
        ...(service.employees ?? []).flatMap((employee) => [
          employee.employeeName,
          employee.employeeUserId,
        ]),
      ]),
    ].join(" "));
    return haystack.includes(needle) ||
      (compactNeedle.length > 0 &&
        haystack.replace(/[^a-z0-9]/g, "").includes(compactNeedle));
  });

  matches.sort((left, right) => (
    left.workDate === right.workDate
      ? right.startTime - left.startTime
      : right.workDate.localeCompare(left.workDate)
  ));

  return response.status(200).json({
    items: matches.slice(0, SEARCH_RESULT_LIMIT).map((attendance) => toFrontendAttendanceItem(
      attendance,
      { redactCustomerInfo: authContext.role === "employee" },
    )),
    meta: {
      storeId,
      query: parsed.data.q,
      totalMatches: matches.length,
      returnedCount: Math.min(matches.length, SEARCH_RESULT_LIMIT),
    },
  });
};
