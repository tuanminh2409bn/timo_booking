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
import { buildFirestoreAuthClaims } from "../../../helpers/firebase-auth-claims.js";
import { toEmployeeListItem } from "./employee-response.js";
import { updateEmployeeEmploymentStatusSchema } from "./employee-shared.js";
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

export const updateEmployeeEmploymentStatus = async (req: Request, res: Response) => {
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

  const employmentStatusParseResult = updateEmployeeEmploymentStatusSchema.safeParse(req.body);

  if (!employmentStatusParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: employmentStatusParseResult.error.flatten().fieldErrors,
    });
  }

  // `employeeStatus` là field legacy tương đương `active`.
  const nextActive = employmentStatusParseResult.data.active ?? employmentStatusParseResult.data.employeeStatus === "active";
  const timestamp = Date.now();

  if (nextActive === existingEmployee.active) {
    return res.status(StatusCodes.OK).json({
      item: toEmployeeListItem(existingEmployee),
      meta: { storeId: existingEmployee.storeId, active: existingEmployee.active },
    });
  }

  // Firebase Auth: khoá/mở đăng nhập theo active.
  await firebaseAuthRepository.auth.updateUserProfile(existingEmployee.uid, {
    disabled: !nextActive,
  });

  await firestoreRepository.user.updateUser(existingEmployee.uid, {
    ownerId: authContext.ownerId,
    active: nextActive,
    updatedAt: timestamp,
    updatedByUserId: authContext.uid,
  });

  const updatedEmployee: EmployeeUserType = {
    ...existingEmployee,
    active: nextActive,
    updatedAt: timestamp,
    updatedByUserId: authContext.uid,
  };

  // Buộc đăng nhập lại: revoke refresh tokens + set lại custom claims (tắt thì claims = null).
  const claims = nextActive
    ? (buildFirestoreAuthClaims({
        ownerId: authContext.ownerId,
        role: "employee",
        storeId: existingEmployee.storeId,
      }) ?? null)
    : null;

  await Promise.all([
    firebaseAuthRepository.auth.revokeRefreshTokens(existingEmployee.uid),
    firebaseAuthRepository.auth.setCustomUserClaims(existingEmployee.uid, claims),
  ]);

  // Cập nhật bộ đếm active/inactive của store (store không đổi).
  if (existingEmployee.storeId) {
    await firestoreRepository.shop.store.adjustEmployeeCounts(
      authContext.ownerId,
      existingEmployee.storeId,
      {
        activeEmployeeCount: nextActive ? 1 : -1,
        inactiveEmployeeCount: nextActive ? -1 : 1,
      },
    );
  }

  await writeShopAuditLog({
    ownerId: authContext.ownerId,
    eventType: "employee_status_changed",
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
      previousActive: existingEmployee.active,
      nextActive: updatedEmployee.active,
    },
  });

  return res.status(StatusCodes.OK).json({
    item: toEmployeeListItem(updatedEmployee),
    meta: { storeId: existingEmployee.storeId, active: updatedEmployee.active },
  });
};
