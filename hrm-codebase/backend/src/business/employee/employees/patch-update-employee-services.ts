import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { isManager, isOwner } from "../../../helpers/role-access.js";
import { can } from "../../../helpers/permissions.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { toEmployeeListItem } from "./employee-response.js";
import { areEmployeeServiceIdsValid, updateEmployeeServicesSchema } from "./employee-shared.js";
import type { EmployeeUserType } from "../../../repository/firestore/user/user.types.js";

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
  employeeNotFound: {
    statusCode: StatusCodes.NOT_FOUND,
    type: "/stores/employees/not-found",
    message: "Employee not found",
  },
};

export const updateEmployeeServices = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);
  const employeeUserId = req.params["employeeUserId"];

  if (!can(authContext.role, "employee:manage")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  if (typeof employeeUserId !== "string" || !employeeUserId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "missing employeeUserId",
    });
  }

  const existingEmployee = await firestoreRepository.user
    .getUser(employeeUserId)
    .catch((error: unknown) => {
      if (error instanceof FirestoreDataNotFoundError) {
        return undefined;
      }

      throw error;
    });

  if (
    !existingEmployee ||
    existingEmployee.ownerId !== authContext.ownerId ||
    existingEmployee.role !== "employee"
  ) {
    return createErrorResponse(res, SERVICE_ERRORS.employeeNotFound, { employeeUserId });
  }

  const canManage =
    isOwner(authContext.role) ||
    (isManager(authContext.role) && authContext.storeId === existingEmployee.storeId);

  if (!canManage) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, {
      role: authContext.role,
      actorStoreId: authContext.storeId,
      employeeStoreId: existingEmployee.storeId,
    });
  }

  const storeIdFromUrl = getStoreIdFromUrlPath(req);

  if (storeIdFromUrl !== undefined && storeIdFromUrl !== existingEmployee.storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      routeStoreId: storeIdFromUrl,
      employeeStoreId: existingEmployee.storeId,
    });
  }

  const servicesParseResult = updateEmployeeServicesSchema.safeParse(req.body);

  if (!servicesParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: servicesParseResult.error.flatten().fieldErrors,
    });
  }

  if (!existingEmployee.storeId) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "employee has no store",
      employeeUserId,
    });
  }

  const serviceCatalog = await firestoreRepository.shop.service.getShopServiceFactory(
    authContext.ownerId,
    existingEmployee.storeId,
  );

  if (!areEmployeeServiceIdsValid(servicesParseResult.data.serviceIds, serviceCatalog)) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "serviceIds not in store catalog",
      serviceIds: servicesParseResult.data.serviceIds,
      storeId: existingEmployee.storeId,
    });
  }

  const timestamp = Date.now();

  await firestoreRepository.user.updateUser(existingEmployee.uid, {
    serviceIds: servicesParseResult.data.serviceIds,
    updatedAt: timestamp,
    updatedByUserId: authContext.uid,
  });

  const updatedEmployee: EmployeeUserType = {
    ...existingEmployee,
    serviceIds: servicesParseResult.data.serviceIds,
    updatedAt: timestamp,
    updatedByUserId: authContext.uid,
  };

  await writeShopAuditLog({
    ownerId: authContext.ownerId,
    eventType: "employee_updated",
    entityType: "employee",
    entityId: updatedEmployee.uid,
    storeId: existingEmployee.storeId,
    actor: {
      uid: authContext.uid,
      role: authContext.role,
    },
    metadata: {
      targetUserId: updatedEmployee.uid,
      updatedFields: ["serviceIds"],
      previousServiceIds: existingEmployee.serviceIds,
      nextServiceIds: updatedEmployee.serviceIds,
    },
  });

  return res.status(StatusCodes.OK).json({
    item: toEmployeeListItem(updatedEmployee),
    meta: {
      storeId: existingEmployee.storeId,
      updatedFields: ["serviceIds"],
    },
  });
};
