import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { getStoreIdFromUrlPath } from "../../../helpers/request-store-id.js";
import { isManager, isOwner } from "../../../helpers/role-access.js";
import { can } from "../../../helpers/permissions.js";
import { firebaseAuthRepository } from "../../../repository/firebase-auth/index.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { toEmployeeListItem } from "./employee-response.js";
import {
  normalizeEmployeeCompensationPayload,
  resolveEmployeeCompensationModel,
  updateEmployeeProfileSchema,
} from "./employee-shared.js";
import type { UserUpdateInput } from "../../../repository/firestore/user/user-factory.js";
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

export const updateEmployeeBasicInformation = async (req: Request, res: Response) => {
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

  // Owner sửa được mọi nhân viên; manager chỉ nhân viên cùng store.
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

  const basicInformationParseResult = updateEmployeeProfileSchema.safeParse(req.body);

  if (!basicInformationParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: basicInformationParseResult.error.flatten().fieldErrors,
    });
  }

  const normalizedCompensation = normalizeEmployeeCompensationPayload(
    basicInformationParseResult.data,
    existingEmployee,
  );
  const nextCompensationModel =
    normalizedCompensation.compensationModel ?? resolveEmployeeCompensationModel(existingEmployee);
  const timestamp = Date.now();

  // Fields chỉ đổi khi có trong request — áp cho cả bản persist lẫn bản in-memory (response + audit).
  const changedFields: {
    name?: string;
    displayName?: string;
    gender?: EmployeeUserType["gender"];
    fixedSalary?: number;
    hourlyRate?: number;
    ownerCommissionRate?: number;
    workerType?: EmployeeUserType["workerType"];
  } = {};

  if (normalizedCompensation.hourlyRate !== undefined) {
    changedFields.hourlyRate = normalizedCompensation.hourlyRate;
  }

  if (normalizedCompensation.fixedSalary !== undefined) {
    changedFields.fixedSalary = normalizedCompensation.fixedSalary;
  }

  if (normalizedCompensation.ownerCommissionRate !== undefined) {
    changedFields.ownerCommissionRate = normalizedCompensation.ownerCommissionRate;
  }

  if (basicInformationParseResult.data.name !== undefined) {
    changedFields.name = basicInformationParseResult.data.name;
    changedFields.displayName = basicInformationParseResult.data.name;
  }

  if (basicInformationParseResult.data.gender !== undefined) {
    changedFields.gender = basicInformationParseResult.data.gender;
  }

  if (basicInformationParseResult.data.workerType !== undefined) {
    changedFields.workerType = basicInformationParseResult.data.workerType;
  }

  // Firebase Auth profile chỉ đổi displayName (khi đổi name). Khoá/mở đăng nhập (disabled) nay do
  // endpoint .../employment-status lo.
  if (basicInformationParseResult.data.name !== undefined) {
    await firebaseAuthRepository.auth.updateUserProfile(existingEmployee.uid, {
      displayName: basicInformationParseResult.data.name,
    });
  }

  const userUpdate: UserUpdateInput = {
    ownerId: authContext.ownerId,
    compensationModel: nextCompensationModel,
    updatedAt: timestamp,
    updatedByUserId: authContext.uid,
    ...changedFields,
  };

  await firestoreRepository.user.updateUser(existingEmployee.uid, userUpdate);

  const updatedEmployee: EmployeeUserType = {
    ...existingEmployee,
    compensationModel: nextCompensationModel,
    updatedAt: timestamp,
    updatedByUserId: authContext.uid,
    ...changedFields,
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
      name: updatedEmployee.name,
      updatedFields: Object.keys(basicInformationParseResult.data),
      previousCompensationModel: existingEmployee.compensationModel,
      nextCompensationModel: updatedEmployee.compensationModel,
      previousOwnerCommissionRate: existingEmployee.ownerCommissionRate,
      nextOwnerCommissionRate: updatedEmployee.ownerCommissionRate,
      fixedSalary: updatedEmployee.fixedSalary,
      hourlyRate: updatedEmployee.hourlyRate,
    },
  });

  return res.status(StatusCodes.OK).json({
    item: toEmployeeListItem(updatedEmployee),
    meta: {
      storeId: existingEmployee.storeId,
      updatedFields: Object.keys(basicInformationParseResult.data),
    },
  });
};
