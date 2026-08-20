export const USER_ROLE = {
  ADMIN: "admin",
  OWNER: "owner",
  MANAGER: "manager",
  EMPLOYEE: "employee",
} as const;
export const USER_ROLE_VALUES = [
  USER_ROLE.ADMIN,
  USER_ROLE.OWNER,
  USER_ROLE.MANAGER,
  USER_ROLE.EMPLOYEE,
] as const;
export type UserRole = (typeof USER_ROLE_VALUES)[number];

export const USER_GENDER = {
  MALE: "male",
  FEMALE: "female",
  OTHER: "other",
} as const;
export const USER_GENDER_VALUES = [
  USER_GENDER.MALE,
  USER_GENDER.FEMALE,
  USER_GENDER.OTHER,
] as const;
export type UserGender = (typeof USER_GENDER_VALUES)[number];

export const OWNER_DATA_RETENTION_PLAN_VALUES = ["standard", "premium"] as const;
export type OwnerDataRetentionPlan = (typeof OWNER_DATA_RETENTION_PLAN_VALUES)[number];

export const EMPLOYEE_STATUS = {
  ACTIVE: "active",
  PENDING: "pending",
  INACTIVE: "inactive",
} as const;
export const EMPLOYEE_STATUS_VALUES = [
  EMPLOYEE_STATUS.ACTIVE,
  EMPLOYEE_STATUS.PENDING,
  EMPLOYEE_STATUS.INACTIVE,
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUS_VALUES)[number];

export const EMPLOYEE_COMPENSATION_MODEL = {
  COMMISSION: "commission",
  FIXED: "fixed",
  HOURLY: "hourly",
} as const;
export const EMPLOYEE_COMPENSATION_MODEL_VALUES = [
  EMPLOYEE_COMPENSATION_MODEL.COMMISSION,
  EMPLOYEE_COMPENSATION_MODEL.FIXED,
  EMPLOYEE_COMPENSATION_MODEL.HOURLY,
] as const;
export type EmployeeCompensationModel = (typeof EMPLOYEE_COMPENSATION_MODEL_VALUES)[number];

export const EMPLOYEE_WORK_DAY = {
  MONDAY: "monday",
  TUESDAY: "tuesday",
  WEDNESDAY: "wednesday",
  THURSDAY: "thursday",
  FRIDAY: "friday",
  SATURDAY: "saturday",
  SUNDAY: "sunday",
} as const;
export const EMPLOYEE_WORK_DAY_VALUES = [
  EMPLOYEE_WORK_DAY.MONDAY,
  EMPLOYEE_WORK_DAY.TUESDAY,
  EMPLOYEE_WORK_DAY.WEDNESDAY,
  EMPLOYEE_WORK_DAY.THURSDAY,
  EMPLOYEE_WORK_DAY.FRIDAY,
  EMPLOYEE_WORK_DAY.SATURDAY,
  EMPLOYEE_WORK_DAY.SUNDAY,
] as const;
export type EmployeeWorkDay = (typeof EMPLOYEE_WORK_DAY_VALUES)[number];

export type EmployeeWorkDaySchedule = {
  enabled: boolean;
  startTime: string;
  endTime: string;
};

export type EmployeeWeeklyWorkingHours = Partial<
  Record<EmployeeWorkDay, EmployeeWorkDaySchedule | undefined>
>;

export type BaseUserType = {
  uid: string;
  email: string;
  ownerId: string;
  active: boolean;
  name?: string | undefined;
  displayName?: string | undefined;
  lastLoginAt?: number | undefined;
  passwordUpdatedAt?: number | undefined;
  accountDeletionRequestedAt?: number | undefined;
  accountDeletionRequestedByUserId?: string | undefined;
  accountDeletionRequestedByRole?: UserRole | undefined;
  createdAt?: number | undefined;
  updatedAt?: number | undefined;
  createdByUserId?: string | undefined;
  updatedByUserId?: string | undefined;
};

export type AdminUserType = BaseUserType & {
  role: "admin";
};

export type OwnerUserType = BaseUserType & {
  role: "owner";
  phone?: string | undefined;
  gender?: UserGender | undefined;
  bankAccount?: string | undefined;
  dataRetentionPlan?: OwnerDataRetentionPlan | undefined;
  dataRetentionPlanChangedAt?: number | undefined;
  dataRetentionStandardEligibleAt?: number | undefined;
};

export type StoreScopedUserFields = {
  storeId: string;
  workerType?: "main" | "assistant" | undefined;
  position?: string | undefined;
  gender?: UserGender | undefined;
  employeeStatus?: EmployeeStatus | undefined;
  compensationModel?: EmployeeCompensationModel | undefined;
  ownerCommissionRate?: number | undefined;
  fixedSalary?: number | undefined;
  hourlyRate?: number | undefined;
  weeklyWorkingHours?: EmployeeWeeklyWorkingHours | undefined;
  serviceIds?: string[] | undefined;
  /** Whether this employee may be shown and auto-assigned on public Booking. */
  publicBookingVisible?: boolean | undefined;
};

export type ManagerUserType = BaseUserType &
  StoreScopedUserFields & {
    role: "manager";
  };

export type EmployeeUserType = BaseUserType &
  StoreScopedUserFields & {
    role: "employee";
  };

export type UserType = AdminUserType | OwnerUserType | ManagerUserType | EmployeeUserType;

// Manager và Employee dùng chung field-set (store-scoped), chỉ khác literal `role`.
export type StoreScopedUserType = ManagerUserType | EmployeeUserType;
