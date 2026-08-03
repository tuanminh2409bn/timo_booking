import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
  normalizeBusinessTimeZone,
  normalizeSettlementCutoffTime,
} from "../../../helpers/business-day.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { resolveAttendanceStoreScope } from "../domain/attendance-store-scope.js";
import { toEmployeePresentationItem } from "../domain/attendance-employees.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import {
  setAttendanceResponseCacheStatus,
  withAttendanceSpan,
} from "./attendance-observability.js";
import { ATTENDANCE_TRACE_CHILD_SPANS } from "./attendance-tracing-contract.js";

const SERVICE_ERRORS = {
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/attendances/form-options/invalid-request",
    message: "Invalid request",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/attendances/form-options/forbidden-store",
    message: "Forbidden: store access denied",
  },
};

const resolveFormOptionsWorkDate = (query: Request["query"]) => {
  const rawWorkDate = query["workDate"];

  if (typeof rawWorkDate !== "string" || !isValidWorkDate(rawWorkDate)) {
    return undefined;
  }

  return rawWorkDate;
};

export const getAttendanceFormOptions = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const requestedStoreId = getStoreIdFromUrlPath(req);
  const workDate = resolveFormOptionsWorkDate(req.query);

  if (!workDate) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "missing or invalid workDate",
    });
  }

  const storeScope = await resolveAttendanceStoreScope(authContext, requestedStoreId);

  // Không resolve được store = không có quyền vào store đó → 403 (đồng bộ các endpoint attendance).
  if (!storeScope) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      requestedStoreId,
    });
  }

  const storeId = storeScope.storeId;
  const [store, employees, services, workDaySettlement] = await withAttendanceSpan(
    ATTENDANCE_TRACE_CHILD_SPANS.readSource,
    {
      "app.store_id": storeId,
      "attendance.work_date": workDate,
    },
    () =>
      Promise.all([
        storeScope.store ?? firestoreRepository.shop.store.getStore(authContext.ownerId, storeId),
        firestoreRepository.user.listShopEmployees(authContext.ownerId, { storeId, active: true }),
        firestoreRepository.shop.service.getShopServiceFactory(authContext.ownerId, storeId),
        firestoreRepository.shop.settlement.getWorkDaySettlement(
          authContext.ownerId,
          storeId,
          workDate,
        ),
      ]),
  );

  const response = sendCacheableJson(
    req,
    res,
    {
      store: {
        id: store.id,
        name: store.name,
        settlementCutoffTime: normalizeSettlementCutoffTime(store.settlementCutoffTime),
        timezone: normalizeBusinessTimeZone(store.timezone),
      },
      employees: employees.map((employee) => {
        const presentationEmployee = toEmployeePresentationItem(employee);

        return {
          id: presentationEmployee.uid,
          name: presentationEmployee.name,
          serviceIds: employee.serviceIds ?? services.map((service) => service.id),
          ...(presentationEmployee.compensationModel !== undefined && {
            compensationModel: presentationEmployee.compensationModel,
          }),
          ...(presentationEmployee.ownerCommissionRate !== undefined && {
            ownerCommissionRate: presentationEmployee.ownerCommissionRate,
          }),
          ...(presentationEmployee.fixedSalary !== undefined && {
            fixedSalary: presentationEmployee.fixedSalary,
          }),
          ...(presentationEmployee.hourlyRate !== undefined && {
            hourlyRate: presentationEmployee.hourlyRate,
          }),
        };
      }),
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        price: service.price,
        durationMinutes: Math.max(service.durationMax ?? service.durationMin ?? 0, 0),
        ...(service.groupService !== undefined && { groupService: service.groupService }),
      })),
      day: {
        workDate,
        isClosed: workDaySettlement?.status === "closed",
      },
      meta: {
        storeId,
        workDate,
      },
    },
    {
      cacheControl: "private, max-age=30, stale-while-revalidate=30",
    },
  );
  setAttendanceResponseCacheStatus(res);
  return response;
};
