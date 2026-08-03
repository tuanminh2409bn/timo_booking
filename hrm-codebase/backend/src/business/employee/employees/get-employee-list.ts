import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";
import { canAccessStore, canReadEmployeeRecord } from "../../../helpers/role-access.js";
import { can } from "../../../helpers/permissions.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { toEmployeeListItem } from "./employee-response.js";
import { listShopEmployeesQuerySchema } from "./employee-shared.js";
import { sendCacheableJson } from "../../../modules/send-cacheable-json.js";

const SERVICE_ERRORS = {
  forbiddenRole: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/employees/forbidden-role",
    message: "Forbidden: insufficient permissions",
  },
  forbiddenStore: {
    statusCode: StatusCodes.FORBIDDEN,
    type: "/stores/employees/forbidden-store",
    message: "Forbidden: store access denied",
  },
  invalidRequest: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/employees/invalid-request",
    message: "Invalid request",
  },
  missingStore: {
    statusCode: StatusCodes.BAD_REQUEST,
    type: "/stores/employees/invalid-request",
    message: "storeId is required",
  },
};

const getLatestUpdatedAt = (
  employees: { updatedAt?: number | undefined; createdAt?: number | undefined }[],
) => {
  const timestamps = employees
    .map((employee) => employee.updatedAt ?? employee.createdAt)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
};

export const getEmployeeList = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (!can(authContext.role, "employee:manage")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  const listEmployeesQueryParseResult = listShopEmployeesQuerySchema.safeParse(mergeUrlPathStoreId(req, req.query));

  if (!listEmployeesQueryParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: listEmployeesQueryParseResult.error.flatten().fieldErrors,
    });
  }

  const requestedStoreId = listEmployeesQueryParseResult.data.storeId?.trim();

  if (!requestedStoreId) {
    return createErrorResponse(res, SERVICE_ERRORS.missingStore, { reason: "missing storeId" });
  }

  if (!canAccessStore(authContext, requestedStoreId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      role: authContext.role,
      requestedStoreId,
    });
  }

  const employees = await firestoreRepository.user.listShopEmployees(authContext.ownerId, {
    storeId: requestedStoreId,
  });

  // Tầng 1: chỉ giữ những nhân viên viewer được phép đọc (RBAC mức bản ghi).
  const employeesViewerCanRead = employees.filter((employee) =>
    canReadEmployeeRecord(authContext, employee),
  );

  // Tầng 2: trong số đó, những người khớp từ khoá tìm kiếm (name/displayName/email).
  const employeesMatchingSearch = employeesViewerCanRead.filter((employee) => {
    if (!listEmployeesQueryParseResult.data.search) {
      return true;
    }

    const keyword = listEmployeesQueryParseResult.data.search.toLowerCase();
    const searchableValues = [employee.name, employee.displayName, employee.email]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => value.toLowerCase());

    return searchableValues.some((value) => value.includes(keyword));
  });

  // Tầng 3: tập hiển thị theo tab active/inactive. CHỈ `items` dùng tập này — các con số đếm
  // bên dưới cố ý lấy từ tập TRƯỚC lọc-status (employeesMatchingSearch) để badge active/inactive
  // không đổi khi user chuyển tab.
  const employeesToDisplay = employeesMatchingSearch.filter((employee) => {
    if (listEmployeesQueryParseResult.data.status === undefined) {
      return true;
    }

    return employee.active === (listEmployeesQueryParseResult.data.status === "active");
  });

  const activeCount = employeesMatchingSearch.filter((employee) => employee.active).length;
  const inactiveCount = employeesMatchingSearch.length - activeCount;

  return sendCacheableJson(
    req,
    res,
    {
      items: employeesToDisplay.map((employee) => toEmployeeListItem(employee)),
      meta: {
        storeId: requestedStoreId,
        totalCount: employeesMatchingSearch.length,
        activeCount,
        inactiveCount,
        latestUpdatedAt: getLatestUpdatedAt(employeesMatchingSearch),
      },
    },
    {
      cacheControl: "private, max-age=15, stale-while-revalidate=30",
    },
  );
};
