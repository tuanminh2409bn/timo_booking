import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { FirestoreDataNotFoundError } from "../../../constants/firestore-error.js";
import { createErrorResponse } from "../../../modules/create-error-response.js";
import { verifyAuthorizationHeader } from "../../../modules/verify-auth-header.js";
import { mergeUrlPathStoreId } from "../../../helpers/request-store-id.js";
import { canAccessStore, isEmployee } from "../../../helpers/role-access.js";
import { can } from "../../../helpers/permissions.js";
import { firebaseAuthRepository } from "../../../repository/firebase-auth/index.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import { writeShopAuditLog } from "../../../helpers/shop-audit-log.js";
import { buildFirestoreAuthClaims } from "../../../helpers/firebase-auth-claims.js";

import type { EmployeeUserType, UserType } from "../../../repository/firestore/user/user.types.js";
import type { StoreType } from "../../../repository/firestore/shop/shop.types.js";
import {
  createShopEmployeeSchema,
  areEmployeeServiceIdsValid,
  normalizeEmployeeCompensationPayload,
} from "./employee-shared.js";
import { toEmployeeListItem } from "./employee-response.js";

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
  emailAlreadyInUse: {
    statusCode: StatusCodes.CONFLICT,
    type: "/stores/employees/email-already-in-use",
    message: "Email is already in use",
  },
};

const isFirebaseAuthError = (error: unknown): error is { code: string } =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof (error as { code?: unknown }).code === "string";

export const createEmployee = async (req: Request, res: Response) => {
  const authContext = await verifyAuthorizationHeader(req.headers["authorization"]);

  if (!can(authContext.role, "employee:manage")) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  const createEmployeeParseResult = createShopEmployeeSchema.safeParse(mergeUrlPathStoreId(req, req.body));

  if (!createEmployeeParseResult.success) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      validation: createEmployeeParseResult.error.flatten().fieldErrors,
    });
  }

  if (!(can(authContext.role, "employee:manage") && isEmployee(createEmployeeParseResult.data.role))) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenRole, { role: authContext.role });
  }

  if (!canAccessStore(authContext, createEmployeeParseResult.data.storeId)) {
    return createErrorResponse(res, SERVICE_ERRORS.forbiddenStore, {
      role: authContext.role,
      storeId: createEmployeeParseResult.data.storeId,
    });
  }

  let store: StoreType;

  try {
    store = await firestoreRepository.shop.store.getStore(
      authContext.ownerId,
      createEmployeeParseResult.data.storeId,
    );
  } catch (error) {
    if (error instanceof FirestoreDataNotFoundError) {
      return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
        reason: "store not found",
        storeId: createEmployeeParseResult.data.storeId,
      });
    }

    throw error;
  }
  const serviceCatalog = await firestoreRepository.shop.service.getShopServiceFactory(
    authContext.ownerId,
    store.id,
  );
  const assignedServiceIds =
    createEmployeeParseResult.data.serviceIds ?? serviceCatalog.map((service) => service.id);

  if (!areEmployeeServiceIdsValid(assignedServiceIds, serviceCatalog)) {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "serviceIds not in store catalog",
      serviceIds: assignedServiceIds,
      storeId: store.id,
    });
  }

  const normalizedCompensation = normalizeEmployeeCompensationPayload(createEmployeeParseResult.data);
  const role = createEmployeeParseResult.data.role;
  const active = true;
  const timestamp = Date.now();
  const normalizedEmail = createEmployeeParseResult.data.email.trim().toLowerCase();

  let createdUserUid: string | undefined;
  let createdEmployee: UserType | undefined;

  try {
    const createdUser = await firebaseAuthRepository.auth.createUser({
      email: normalizedEmail,
      password: createEmployeeParseResult.data.password,
      displayName: createEmployeeParseResult.data.name,
      disabled: !active,
    });
    createdUserUid = createdUser.uid;
    const claims = buildFirestoreAuthClaims({
      ownerId: authContext.ownerId,
      role,
      storeId: store.id,
    });

    if (claims) {
      await firebaseAuthRepository.auth.setCustomUserClaims(createdUser.uid, claims);
    }

    const newEmployee: EmployeeUserType = {
      uid: createdUser.uid,
      email: normalizedEmail,
      ownerId: authContext.ownerId,
      role,
      active,
      name: createEmployeeParseResult.data.name,
      displayName: createEmployeeParseResult.data.name,
      storeId: store.id,
      workerType:
        createEmployeeParseResult.data.workerType ??
        (normalizedCompensation.compensationModel === "fixed" ? "assistant" : "main"),
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUserId: authContext.uid,
      updatedByUserId: authContext.uid,
      serviceIds: assignedServiceIds,
      publicBookingVisible: createEmployeeParseResult.data.publicBookingVisible,
    };

    if (normalizedCompensation.compensationModel !== undefined) {
      newEmployee.compensationModel = normalizedCompensation.compensationModel;
    }

    if (normalizedCompensation.hourlyRate !== undefined) {
      newEmployee.hourlyRate = normalizedCompensation.hourlyRate;
    }

    if (normalizedCompensation.fixedSalary !== undefined) {
      newEmployee.fixedSalary = normalizedCompensation.fixedSalary;
    }

    if (normalizedCompensation.ownerCommissionRate !== undefined) {
      newEmployee.ownerCommissionRate = normalizedCompensation.ownerCommissionRate;
    }

    if (createEmployeeParseResult.data.gender !== undefined) {
      newEmployee.gender = createEmployeeParseResult.data.gender;
    }

    if (createEmployeeParseResult.data.weeklyWorkingHours !== undefined) {
      newEmployee.weeklyWorkingHours = createEmployeeParseResult.data.weeklyWorkingHours;
    }

    createdEmployee = await firestoreRepository.user.insertUser(newEmployee);

    await firestoreRepository.shop.store.adjustEmployeeCounts(authContext.ownerId, store.id, {
      employeeCount: 1,
      activeEmployeeCount: 1,
    });
  } catch (error) {
    if (createdUserUid) {
      await firebaseAuthRepository.auth.deleteUser(createdUserUid);
    }

    if (isFirebaseAuthError(error) && error.code === "auth/email-already-exists") {
      return createErrorResponse(res, SERVICE_ERRORS.emailAlreadyInUse);
    }

    throw error;
  }

  if (!createdEmployee || createdEmployee.role !== "employee") {
    return createErrorResponse(res, SERVICE_ERRORS.invalidRequest, {
      reason: "created user is not an employee",
    });
  }

  await writeShopAuditLog({
    ownerId: authContext.ownerId,
    eventType: "employee_created",
    entityType: "employee",
    entityId: createdEmployee.uid,
    storeId: store.id,
    actor: {
      uid: authContext.uid,
      role: authContext.role,
    },
    metadata: {
      targetUserId: createdEmployee.uid,
      name: createdEmployee.name,
      employeeName: createdEmployee.name,
      role: createdEmployee.role,
      storeId: store.id,
      storeName: store.name,
      compensationModel: createdEmployee.compensationModel,
      ownerCommissionRate: createdEmployee.ownerCommissionRate,
      fixedSalary: createdEmployee.fixedSalary,
      hourlyRate: createdEmployee.hourlyRate,
      weeklyWorkingHours: createdEmployee.weeklyWorkingHours,
      serviceIds: createdEmployee.serviceIds,
      publicBookingVisible: createdEmployee.publicBookingVisible ?? true,
      workerType: createdEmployee.workerType,
      active: createdEmployee.active,
    },
  });

  return res.status(StatusCodes.CREATED).json({
    item: toEmployeeListItem(createdEmployee),
    meta: {
      storeId: store.id,
    },
  });
};
