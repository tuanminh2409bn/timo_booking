import type { ShopEmployeeListItem } from "../../../repository/firestore/user/user-factory.js";
import {
  getEmployeeDisplayName,
  getResolvedEmployeeStatus,
  resolveOwnerCommissionRate,
  resolveEmployeeCompensationModel,
} from "./employee-shared.js";

/**
 * Minimal projection for the owner employee LIST (cards). Only the fields the list UI
 * actually renders or keys on — name, status, pay type, store, identity. The full
 * {@link toEmployeeResponse} is reserved for detail / dropdown / portal consumers.
 */
export const toEmployeeListItem = (employee: ShopEmployeeListItem) => {
  const name = getEmployeeDisplayName(employee);
  const status = getResolvedEmployeeStatus(employee);
  const compensationModel = resolveEmployeeCompensationModel(employee);

  const listItem: {
    id: string;
    name: string;
    active: boolean;
    status: typeof status;
    storeId?: string;
    workerType?: "main" | "assistant";
    serviceIds?: string[];
    publicBookingVisible: boolean;
    weeklyWorkingHours?: ShopEmployeeListItem["weeklyWorkingHours"];
    compensationModel: typeof compensationModel;
    ownerCommissionRate?: number | undefined;
    fixedSalary?: number;
    hourlyRate?: number;
    createdAt?: number;
    updatedAt?: number;
  } = {
    id: employee.uid,
    name,
    active: employee.active,
    status,
    compensationModel,
    publicBookingVisible: employee.publicBookingVisible ?? true,
  };

  if (employee.storeId !== undefined) {
    listItem.storeId = employee.storeId;
  }

  listItem.workerType =
    employee.workerType ?? (compensationModel === "fixed" ? "assistant" : "main");

  if (employee.serviceIds !== undefined) {
    listItem.serviceIds = employee.serviceIds;
  }

  if (compensationModel === "hourly" && employee.weeklyWorkingHours !== undefined) {
    listItem.weeklyWorkingHours = employee.weeklyWorkingHours;
  }

  if (compensationModel === "commission") {
    listItem.ownerCommissionRate = resolveOwnerCommissionRate({
      compensationModel,
      ownerCommissionRate: employee.ownerCommissionRate,
    });
  }

  if (compensationModel === "hourly" && employee.hourlyRate !== undefined) {
    listItem.hourlyRate = employee.hourlyRate;
  }

  if (compensationModel === "fixed" && employee.fixedSalary !== undefined) {
    listItem.fixedSalary = employee.fixedSalary;
  }

  if (employee.createdAt !== undefined) {
    listItem.createdAt = employee.createdAt;
  }

  if (employee.updatedAt !== undefined) {
    listItem.updatedAt = employee.updatedAt;
  }

  return listItem;
};

export const toEmployeeResponse = (employee: ShopEmployeeListItem) => {
  const name = getEmployeeDisplayName(employee);
  const status = getResolvedEmployeeStatus(employee);
  const compensationModel = resolveEmployeeCompensationModel(employee);

  const response: {
    id: string;
    uid: string;
    email: string;
    name: string;
    displayName: string;
    role: ShopEmployeeListItem["role"];
    active: boolean;
    status: typeof status;
    storeId?: string;
    workerType?: "main" | "assistant";
    serviceIds?: string[];
    publicBookingVisible: boolean;
    weeklyWorkingHours?: ShopEmployeeListItem["weeklyWorkingHours"];
    gender?: ShopEmployeeListItem["gender"];
    compensationModel: typeof compensationModel;
    ownerCommissionRate?: number | undefined;
    fixedSalary?: number;
    hourlyRate?: number;
    lastLoginAt?: number;
    label: string;
    value: string;
    kpi: number;
    shiftsCompleted: number;
    salary: string;
    absent: number;
  } = {
    id: employee.uid,
    uid: employee.uid,
    email: employee.email,
    name,
    displayName: name,
    role: employee.role,
    active: employee.active,
    status,
    compensationModel,
    publicBookingVisible: employee.publicBookingVisible ?? true,
    label: name,
    value: employee.uid,
    // TODO: kpi/shiftsCompleted/salary/absent are hardcoded placeholders for FE compatibility.
    // Wire them to real data or drop them once the FE stops reading them.
    kpi: 0,
    shiftsCompleted: 0,
    salary: "0",
    absent: 0,
  };

  if (employee.storeId !== undefined) {
    response.storeId = employee.storeId;
  }

  response.workerType =
    employee.workerType ?? (compensationModel === "fixed" ? "assistant" : "main");

  if (employee.serviceIds !== undefined) {
    response.serviceIds = employee.serviceIds;
  }

  if (compensationModel === "hourly" && employee.weeklyWorkingHours !== undefined) {
    response.weeklyWorkingHours = employee.weeklyWorkingHours;
  }

  if (employee.gender !== undefined) {
    response.gender = employee.gender;
  }

  if (compensationModel === "commission") {
    response.ownerCommissionRate = resolveOwnerCommissionRate({
      compensationModel,
      ownerCommissionRate: employee.ownerCommissionRate,
    });
  }

  if (compensationModel === "hourly" && employee.hourlyRate !== undefined) {
    response.hourlyRate = employee.hourlyRate;
  }

  if (compensationModel === "fixed" && employee.fixedSalary !== undefined) {
    response.fixedSalary = employee.fixedSalary;
  }

  if (employee.lastLoginAt !== undefined) {
    response.lastLoginAt = employee.lastLoginAt;
  }

  return response;
};
