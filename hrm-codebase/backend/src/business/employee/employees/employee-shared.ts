import { z } from "zod";
import { EMPLOYEE_ROLE_VALUES } from "../../../helpers/user-roles.js";
import { parseMoneyInput } from "../../../helpers/money.js";
import { ShopEmployeeCompensationModelEnum } from "../../../repository/firestore/shop/shop.types.js";
import type { ShopServiceType } from "../../../repository/firestore/shop/shop.types.js";
import {
  EMPLOYEE_COMPENSATION_MODEL,
  EMPLOYEE_STATUS,
  EMPLOYEE_WORK_DAY,
  USER_GENDER_VALUES,
  type EmployeeCompensationModel,
  type UserType,
} from "../../../repository/firestore/user/user.types.js";

const employeeRoleEnum = z.enum(EMPLOYEE_ROLE_VALUES);
const genderEnum = z.enum(USER_GENDER_VALUES);
const employeeStatusEnum = z.enum([EMPLOYEE_STATUS.ACTIVE, EMPLOYEE_STATUS.INACTIVE]);
const workerTypeEnum = z.enum(["main", "assistant"]);
export const DEFAULT_OWNER_COMMISSION_RATE = 50;
const serviceIdsSchema = z
  .array(z.string().trim().min(1))
  .max(200)
  .superRefine((serviceIds, ctx) => {
    if (new Set(serviceIds).size !== serviceIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "serviceIds must be unique",
      });
    }
  });

const moneyNumberSchema = z
  .number()
  .min(0)
  .refine((value) => parseMoneyInput(value, { allowZero: true }) !== undefined, {
    message: "must use the configured money scale",
  });
const timeValueSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: "must use HH:mm format",
});
const percentNumberSchema = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() !== "") {
    return Number(value);
  }

  return value;
}, z.number().min(0).max(100));
const employeeWorkDayScheduleSchema = z
  .object({
    enabled: z.boolean(),
    startTime: timeValueSchema,
    endTime: timeValueSchema,
  })
  .strict()
  .superRefine((workDaySchedule, ctx) => {
    if (workDaySchedule.enabled && workDaySchedule.startTime >= workDaySchedule.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "endTime must be after startTime",
      });
    }
  });
const employeeWeeklyWorkingHoursSchema = z
  .object({
    [EMPLOYEE_WORK_DAY.MONDAY]: employeeWorkDayScheduleSchema.optional(),
    [EMPLOYEE_WORK_DAY.TUESDAY]: employeeWorkDayScheduleSchema.optional(),
    [EMPLOYEE_WORK_DAY.WEDNESDAY]: employeeWorkDayScheduleSchema.optional(),
    [EMPLOYEE_WORK_DAY.THURSDAY]: employeeWorkDayScheduleSchema.optional(),
    [EMPLOYEE_WORK_DAY.FRIDAY]: employeeWorkDayScheduleSchema.optional(),
    [EMPLOYEE_WORK_DAY.SATURDAY]: employeeWorkDayScheduleSchema.optional(),
    [EMPLOYEE_WORK_DAY.SUNDAY]: employeeWorkDayScheduleSchema.optional(),
  })
  .strict();

export const listShopEmployeesQuerySchema = z.object({
  storeId: z.string().trim().min(1).optional(),
  status: employeeStatusEnum.optional(),
  search: z.string().trim().max(100).optional(),
});

export const createShopEmployeeSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(6),
    name: z.string().trim().min(2).max(100),
    storeId: z.string().trim().min(1).optional(),
    role: employeeRoleEnum.optional().default("employee"),
    workerType: workerTypeEnum.optional(),
    gender: genderEnum.optional(),
    compensationModel: ShopEmployeeCompensationModelEnum.optional(),
    ownerCommissionRate: percentNumberSchema.optional(),
    fixedSalary: moneyNumberSchema.optional(),
    hourlyRate: moneyNumberSchema.optional(),
    serviceIds: serviceIdsSchema.optional(),
    publicBookingVisible: z.boolean().optional().default(true),
    weeklyWorkingHours: employeeWeeklyWorkingHoursSchema.optional(),
  })
  .superRefine((employeeInput, ctx) => {
    if (
      employeeInput.weeklyWorkingHours !== undefined &&
      employeeInput.compensationModel !== EMPLOYEE_COMPENSATION_MODEL.HOURLY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weeklyWorkingHours"],
        message: "weeklyWorkingHours is only available for hourly employees",
      });
    }
  })
  .transform((employeeInput, ctx) => {
    const storeId = employeeInput.storeId;

    if (!storeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storeId"],
        message: "storeId is required",
      });
      return z.NEVER;
    }

    return { ...employeeInput, storeId };
  });

// Employee updates are split by concern (một employee cố định 1 store, nên không endpoint nào
// đổi store). Mỗi màn FE lưu qua schema riêng.
export const updateEmployeeProfileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  workerType: workerTypeEnum.optional(),
  gender: genderEnum.optional(),
  compensationModel: ShopEmployeeCompensationModelEnum.optional(),
  ownerCommissionRate: percentNumberSchema.optional(),
  fixedSalary: moneyNumberSchema.optional(),
  hourlyRate: moneyNumberSchema.optional(),
  publicBookingVisible: z.boolean().optional(),
});

// Bật/tắt trạng thái làm việc (cho nghỉ / nhận lại) — tách riêng khỏi PATCH hồ sơ vì đây là hành
// động bảo mật (khoá đăng nhập + thu hồi phiên). Nhận `active` (bool) hoặc `employeeStatus` (legacy).
export const updateEmployeeEmploymentStatusSchema = z
  .object({
    active: z.boolean().optional(),
    employeeStatus: employeeStatusEnum.optional(),
  })
  .refine((statusUpdate) => statusUpdate.active !== undefined || statusUpdate.employeeStatus !== undefined, {
    message: "active or employeeStatus is required",
  });

export const updateEmployeeWorkingHoursSchema = z.object({
  weeklyWorkingHours: employeeWeeklyWorkingHoursSchema,
});

export const updateEmployeeServicesSchema = z.object({
  serviceIds: serviceIdsSchema,
});

export const updateEmployeePasswordSchema = z.object({
  password: z.string().min(6),
});

type EmployeeCompensationPayload = {
  compensationModel?: z.infer<typeof ShopEmployeeCompensationModelEnum> | undefined;
  ownerCommissionRate?: number | undefined;
  fixedSalary?: number | undefined;
  hourlyRate?: number | undefined;
};

export const getResolvedEmployeeStatus = (
  user: Pick<UserType, "active">,
): z.infer<typeof employeeStatusEnum> => (user.active ? "active" : "inactive");

export const getEmployeeDisplayName = (
  employee: Pick<UserType, "name" | "displayName" | "email" | "uid">,
) =>
  employee.name?.trim() ||
  employee.displayName?.trim() ||
  employee.email.split("@")[0] ||
  employee.uid;

export const resolveEmployeeCompensationModel = (employee: {
  compensationModel?: EmployeeCompensationModel | undefined;
  hourlyRate?: number | undefined;
}) => {
  if (employee.compensationModel) {
    return employee.compensationModel;
  }

  if (employee.hourlyRate !== undefined) {
    return EMPLOYEE_COMPENSATION_MODEL.HOURLY;
  }

  return EMPLOYEE_COMPENSATION_MODEL.COMMISSION;
};

export const resolveOwnerCommissionRate = (employee: {
  compensationModel?: EmployeeCompensationModel | undefined;
  ownerCommissionRate?: number | undefined;
}) => {
  if (employee.compensationModel !== EMPLOYEE_COMPENSATION_MODEL.COMMISSION) {
    return undefined;
  }

  if (employee.ownerCommissionRate !== undefined) {
    return employee.ownerCommissionRate;
  }

  return DEFAULT_OWNER_COMMISSION_RATE;
};

export const normalizeEmployeeCompensationPayload = (
  payload: EmployeeCompensationPayload,
  currentValues?: {
    compensationModel?: EmployeeCompensationModel | undefined;
    fixedSalary?: number | undefined;
    hourlyRate?: number | undefined;
    ownerCommissionRate?: number | undefined;
  },
) => {
  const requestedCompensationModel =
    payload.compensationModel ?? currentValues?.compensationModel;

  if (requestedCompensationModel === EMPLOYEE_COMPENSATION_MODEL.HOURLY) {
    return {
      compensationModel: EMPLOYEE_COMPENSATION_MODEL.HOURLY,
      hourlyRate: payload.hourlyRate ?? currentValues?.hourlyRate ?? 0,
    };
  }

  if (requestedCompensationModel === EMPLOYEE_COMPENSATION_MODEL.FIXED) {
    return {
      compensationModel: EMPLOYEE_COMPENSATION_MODEL.FIXED,
      fixedSalary: payload.fixedSalary ?? currentValues?.fixedSalary ?? 0,
    };
  }

  if (requestedCompensationModel === EMPLOYEE_COMPENSATION_MODEL.COMMISSION) {
    return {
      compensationModel: EMPLOYEE_COMPENSATION_MODEL.COMMISSION,
      ownerCommissionRate:
        payload.ownerCommissionRate ??
        currentValues?.ownerCommissionRate ??
        DEFAULT_OWNER_COMMISSION_RATE,
    };
  }

  return {};
};

export const areEmployeeServiceIdsValid = (
  serviceIds: string[] | undefined,
  serviceCatalog: Pick<ShopServiceType, "id">[],
) => {
  if (serviceIds === undefined) {
    return true;
  }

  const catalogServiceIds = new Set(serviceCatalog.map((service) => service.id));
  return serviceIds.every((serviceId) => catalogServiceIds.has(serviceId));
};
