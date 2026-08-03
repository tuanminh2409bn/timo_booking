import type { Request, Response } from "express";
import { performance } from "node:perf_hooks";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { canAccessStore } from "../../../helpers/role-access.js";
import { can } from "../../../helpers/permissions.js";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { buildWorkDaySettlementPreview } from "../../../helpers/work-day-settlement.js";
import { normalizeAttendanceForResponse } from "../domain/attendance-presentation.js";
import { runSingleFlight } from "../../../repository/cache/cache-client.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import {
  toSettlementPreviewResponse,
  toStoredSettlementPreviewResponse,
} from "./settlement-response.js";
import { ServerTiming } from "../../../modules/server-timing.js";

const SETTLEMENT_PREVIEW_SERVICE_ERRORS = {
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/work-days/settlement-preview/forbidden-store",
    message: "Forbidden: store access denied",
  },
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/work-days/settlement-preview/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/work-days/settlement-preview/invalid-request",
    message: "Invalid settlement preview request",
  },
};

export const getSettlementPreview = async (req: Request, res: Response) => {
  const timing = new ServerTiming();
  const requestStartedAt = performance.now();
  const authContext = await timing.measure("auth", () =>
    verifyAuthorizationHeader(req.headers["authorization"]),
  );

  const sendSettlementPreviewResponse = (payload: unknown, storeId: string) => {
    timing.add("total", performance.now() - requestStartedAt);
    res.setHeader("Server-Timing", timing.header());
    res.setHeader("X-Cache", "BYPASS");
    res.locals["serverTiming"] = timing.toObject();
    res.locals["businessEvent"] = "settlement.preview";
    res.locals["settlementPreview"] = { storeId };

    return sendCacheableJson(req, res, payload, {
      cacheControl: "private, no-cache, max-age=0, must-revalidate",
    });
  };

  if (!can(authContext.role, "settlement:view")) {
    return createErrorResponse(res, SETTLEMENT_PREVIEW_SERVICE_ERRORS.forbiddenRole, {
      role: authContext.role,
    });
  }

  const requestedStoreId = getStoreIdFromUrlPath(req);
  const queryParseResult = z
    .object({
      workDate: z.string().refine(isValidWorkDate, {
        message: "workDate must use YYYY-MM-DD",
      }),
      ownerDiscountCoverageRate: z.coerce
        .number()
        .pipe(z.union([z.literal(0), z.literal(50), z.literal(100)]))
        .default(50),
      includeItems: z
        .enum(["true", "false"])
        .default("true")
        .transform((value) => value === "true"),
    })
    .safeParse({
      workDate: req.query["workDate"] ?? req.query["date"],
      ownerDiscountCoverageRate:
        req.query["ownerDiscountCoverageRate"] ?? req.query["ownerDiscountSharePercent"],
      includeItems: req.query["includeItems"],
    });

  if (!requestedStoreId || !queryParseResult.success) {
    return createErrorResponse(res, SETTLEMENT_PREVIEW_SERVICE_ERRORS.invalidRequest, {
      requestedStoreId,
      ...(!queryParseResult.success && {
        validation: queryParseResult.error.flatten().fieldErrors,
      }),
    });
  }

  const { workDate, ownerDiscountCoverageRate, includeItems } = queryParseResult.data;

  if (!canAccessStore(authContext, requestedStoreId)) {
    return createErrorResponse(res, SETTLEMENT_PREVIEW_SERVICE_ERRORS.forbiddenStore, {
      requestedStoreId,
      role: authContext.role,
    });
  }

  const storeId = requestedStoreId;

  const responseKey = [
    "settlement-preview",
    authContext.ownerId,
    storeId,
    workDate,
    ownerDiscountCoverageRate,
    includeItems,
  ].join(":");
  const responsePayload = await runSingleFlight(responseKey, async () => {
    const firestoreStartedAt = performance.now();
    const storedSettlement = await firestoreRepository.shop.settlement.getWorkDaySettlement(
      authContext.ownerId,
      storeId,
      workDate,
    );
    const canUseStoredSettlement =
      storedSettlement !== null &&
      (storedSettlement.status === "closed" ||
        storedSettlement.previewOwnerDiscountCoverageRate === ownerDiscountCoverageRate) &&
      (!includeItems || storedSettlement.attendanceItems !== undefined);

    if (canUseStoredSettlement) {
      timing.add("firestore", performance.now() - firestoreStartedAt);
      return timing.measureSync("mapping", () =>
        toStoredSettlementPreviewResponse({
          settlement: storedSettlement,
          includeItems,
        }),
      );
    }

    const [attendances, employeeWorkDayClosings, storeEmployees] = await Promise.all([
      firestoreRepository.shop.attendance.listShopAttendanceByStoreDateRange(
        authContext.ownerId,
        storeId,
        workDate,
        workDate,
        { skipCache: true },
      ),
      firestoreRepository.shop.session.listEmployeeWorkDayClosingsByStoreDateRange(
        authContext.ownerId,
        storeId,
        workDate,
        workDate,
        { skipCache: true },
      ),
      firestoreRepository.user.listShopEmployees(authContext.ownerId, {
        storeId,
        skipCache: true,
      }),
    ]);
    timing.add("firestore", performance.now() - firestoreStartedAt);
    const closing =
      storedSettlement?.status === "closed" ? (storedSettlement.closing ?? null) : null;

    return timing.measureSync("mapping", () => {
      const normalizedAttendances = attendances.map(normalizeAttendanceForResponse);
      const resolvedOwnerDiscountCoverageRate =
        closing?.ownerDiscountCoverageRate ?? ownerDiscountCoverageRate;
      const settlementPreview = buildWorkDaySettlementPreview(normalizedAttendances, {
        ownerDiscountCoverageRate: resolvedOwnerDiscountCoverageRate,
        employeeConfigs: storeEmployees.map((employee) => ({
          uid: employee.uid,
          name: employee.name ?? employee.displayName ?? employee.email,
          compensationModel: employee.compensationModel,
          ownerCommissionRate: employee.ownerCommissionRate,
          fixedSalary: employee.fixedSalary,
          hourlyRate: employee.hourlyRate,
        })),
        employeeWorkDayClosings,
      });

      const response = toSettlementPreviewResponse({
        workDate,
        storeId,
        attendances: normalizedAttendances,
        employees: storeEmployees,
        closing: closing ?? null,
        preview: settlementPreview,
        ownerDiscountCoverageRate: resolvedOwnerDiscountCoverageRate,
      });

      return includeItems ? response : { ...response, items: [] };
    });
  });

  return sendSettlementPreviewResponse(responsePayload, storeId);
};
