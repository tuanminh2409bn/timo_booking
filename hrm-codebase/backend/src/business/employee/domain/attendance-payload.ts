import { z } from "zod";
import { normalizeCustomerPhone } from "../../../helpers/customer-phone.js";
import { resolveBusinessWorkDate } from "../../../helpers/business-day.js";
import {
  ShopAttendanceDiscountTypeEnum,
  ShopServiceCategoryEnum,
  SHOP_ATTENDANCE_BOOKING_STATUSES,
  SHOP_ATTENDANCE_SOURCES,
  type ShopServiceCategoryType,
  type ShopServiceType,
} from "../../../repository/firestore/shop/shop.types.js";
import { parseMoneyInput } from "../../../helpers/money.js";
import { getAttendanceAssigneeValidationError } from "./attendance-rules.js";
import { parseDateInput, parseTimestampInput, toMinutesFromDate } from "./attendance-timing.js";

const imageUrlsSchema = z.array(z.string().url()).max(10);
const durationInputSchema = z.union([z.number().int().positive(), z.string().trim().min(1)]);
const optionalMoneyNumberSchema = z
  .number()
  .min(0)
  .refine((value) => parseMoneyInput(value, { allowZero: true }) !== undefined, {
    message: "must use the configured money scale",
  });
const moneyInputSchema = z
  .union([z.number().positive(), z.string().trim().min(1)])
  .refine((value) => parseMoneyInput(value) !== undefined, {
    message: "must use the configured money scale",
  });

const discountSchema = z
  .object({
    type: ShopAttendanceDiscountTypeEnum,
    value: z.number().positive(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "amount" && parseMoneyInput(data.value) === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "discount amount must use the configured money scale",
      });
    }

    if (data.type === "percentage" && data.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "discount percentage cannot exceed 100",
      });
    }
  });

const frontendEmployeeShareSchema = z.object({
  employeeId: z.string().trim().min(1),
  employeeName: z.string().trim().min(1).max(100).optional(),
  workerType: z.enum(["main", "assistant"]).optional(),
  percentage: z.number().min(0).max(100).optional(),
  shareAmount: optionalMoneyNumberSchema.optional(),
});

export const frontendAttendanceServiceSchema = z
  .object({
    id: z.string().trim().min(1),
    sourceServiceId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    category: ShopServiceCategoryEnum.optional(),
    imageUrls: imageUrlsSchema.optional(),
    images: imageUrlsSchema.optional(),
    durationMin: durationInputSchema.optional(),
    durationMax: durationInputSchema.optional(),
    duration: durationInputSchema.optional(),
    time: durationInputSchema.optional(),
    price: moneyInputSchema,
    amount: moneyInputSchema.optional(),
    employees: z.array(frontendEmployeeShareSchema).max(20).default([]),
  })
  .superRefine((data, ctx) => {
    const hasExplicitPercentages = data.employees.some(
      (employee) => employee.percentage !== undefined,
    );

    if (!hasExplicitPercentages) {
      return;
    }

    const hasMissingPercentage = data.employees.some(
      (employee) => employee.percentage === undefined,
    );

    if (hasMissingPercentage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["employees"],
        message: "employee percentages must be provided for every service employee",
      });
      return;
    }

    const totalPercentage = data.employees.reduce(
      (sum, employee) => sum + (employee.percentage ?? 0),
      0,
    );

    if (totalPercentage !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["employees"],
        message: "employee percentages must total 100",
      });
    }
  });

const bookingStatusSchema = z.enum(SHOP_ATTENDANCE_BOOKING_STATUSES);

const frontendAttendancePayloadSchema = z
  .object({
    bookingId: z.string().trim().min(1).max(100).optional(),
    date: z.union([z.string().trim().min(1), z.date()]),
    createdAt: z.union([z.string().trim().min(1), z.date()]).optional(),
    endDate: z.union([z.string().trim().min(1), z.date()]).optional(),
    startTimestamp: z.number().int().positive().optional(),
    endTimestamp: z.number().int().positive().optional(),
    employeeUserId: z.string().trim().min(1).optional(),
    mainAssigneeUserId: z.string().trim().min(1).optional(),
    assistantAssigneeUserId: z.string().trim().min(1).optional(),
    employeeName: z.string().trim().min(1).max(100).optional(),
    customerName: z.string().trim().max(100).optional(),
    customerPhone: z.string().trim().max(30).optional(),
    source: z.enum([...SHOP_ATTENDANCE_SOURCES, "hrm"]).optional(),
    note: z.string().trim().max(500).optional(),
    bookingSource: z.string().trim().max(50).optional(),
    storeId: z.union([z.number().int().positive(), z.string().trim().min(1)]).optional(),
    services: z.array(frontendAttendanceServiceSchema).max(50),
    discount: discountSchema.optional(),
    discountAmount: optionalMoneyNumberSchema.optional(),
    bookingStatus: bookingStatusSchema.optional(),
    attendanceStatus: z.enum(["open", "completed"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.storeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storeId"],
        message: "storeId is required",
      });
    }

    const assigneeError = getAttendanceAssigneeValidationError(
      data.mainAssigneeUserId ?? data.employeeUserId,
      data.services.map((service) => service.employees.map((employee) => employee.employeeId)),
    );

    if (assigneeError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["services"],
        message: assigneeError,
      });
    }

    if (
      data.assistantAssigneeUserId !== undefined &&
      data.assistantAssigneeUserId === (data.mainAssigneeUserId ?? data.employeeUserId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assistantAssigneeUserId"],
        message: "assistant assignee must differ from main assignee",
      });
    }

    const mainAssigneeUserId = data.mainAssigneeUserId ?? data.employeeUserId;
    const serviceAssistantIds = new Set(
      data.services.flatMap((service) =>
        service.employees
          .map((employee) => employee.employeeId)
          .filter((employeeUserId) => employeeUserId !== mainAssigneeUserId),
      ),
    );

    if (
      data.assistantAssigneeUserId !== undefined &&
      serviceAssistantIds.size > 0 &&
      !serviceAssistantIds.has(data.assistantAssigneeUserId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assistantAssigneeUserId"],
        message: "assistant assignee must match the service assistant",
      });
    }
  });

type FrontendAttendancePayload = z.infer<typeof frontendAttendancePayloadSchema>;

export type NormalizedAttendanceAssigneeInput = {
  employeeUserId: string;
  employeeName?: string | undefined;
  workerType?: "main" | "assistant" | undefined;
  percentage?: number | undefined;
};

export type NormalizedAttendanceServiceInput = {
  id?: string;
  sourceServiceId?: string;
  mode?: "existing" | "create_new";
  name: string;
  description?: string;
  category?: ShopServiceCategoryType;
  price: number;
  imageUrls?: string[];
  durationMin?: number;
  durationMax?: number;
  employees: NormalizedAttendanceAssigneeInput[];
};

export type NormalizedAttendancePayload = {
  storeId: string;
  bookingId?: string;
  // Thợ chính do FE khai (màn "Thông tin"), giữ RIÊNG — không suy từ `assignees[0]`, vì thứ tự
  // trong `assignees` là thứ tự thợ xuất hiện trong services, không phải ai là thợ chính.
  mainAssigneeUserId?: string;
  assistantAssigneeUserId?: string;
  workDate: string;
  startTimestamp?: number;
  endTimestamp?: number;
  startTime: number;
  endTime: number;
  customerName?: string;
  customerPhone?: string;
  source?: (typeof SHOP_ATTENDANCE_SOURCES)[number] | "hrm";
  note?: string;
  bookingSource?: string;
  services: NormalizedAttendanceServiceInput[];
  assignees: NormalizedAttendanceAssigneeInput[];
  discount?: z.infer<typeof discountSchema>;
  discountAmount?: number;
  bookingStatus?: z.infer<typeof bookingStatusSchema>;
  attendanceStatus?: "open" | "completed";
};

// FE gửi thời lượng khá tuỳ tiện ("45", "45 phút", 45) → rút lấy số nguyên dương, sai thì bỏ qua.
const parseDurationInput = (value: string | number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  const parsedValue = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : undefined;
};

export const getAttendanceServiceDuration = (service: {
  duration?: string | number | undefined;
  durationMin?: string | number | undefined;
  durationMax?: string | number | undefined;
  time?: string | number | undefined;
}) => {
  const durationFromSingleField =
    parseDurationInput(service.duration) ?? parseDurationInput(service.time);

  if (durationFromSingleField !== undefined) {
    return {
      durationMin: durationFromSingleField,
      durationMax: durationFromSingleField,
    };
  }

  const durationMin = parseDurationInput(service.durationMin);
  const durationMax = parseDurationInput(service.durationMax);

  return {
    ...(durationMin !== undefined && { durationMin }),
    ...(durationMax !== undefined && { durationMax }),
  };
};

// Service trỏ tới `sourceServiceId` thì id đó phải có thật trong catalog hoặc trong service đang lưu.
export const areAttendanceServiceReferencesValid = (
  services: NormalizedAttendanceServiceInput[],
  serviceCatalog: ShopServiceType[],
  existingServices: ShopServiceType[] = [],
) => {
  const catalogServiceIds = new Set(serviceCatalog.map((service) => service.id));
  const existingServiceIds = new Set(existingServices.map((service) => service.id));

  return services.every(
    (service) =>
      service.sourceServiceId === undefined ||
      catalogServiceIds.has(service.sourceServiceId) ||
      existingServiceIds.has(service.sourceServiceId),
  );
};

// Gom thợ từ mọi service thành danh sách assignee duy nhất theo employeeUserId.
export const getAssigneesFromServices = (
  services: NormalizedAttendanceServiceInput[],
): NormalizedAttendanceAssigneeInput[] => {
  const assigneeMap = new Map<string, NormalizedAttendanceAssigneeInput>();

  services
    .flatMap((service) => service.employees)
    .forEach((employee) => {
      const existingAssignee = assigneeMap.get(employee.employeeUserId);
      const employeeName = employee.employeeName ?? existingAssignee?.employeeName;

      assigneeMap.set(employee.employeeUserId, {
        employeeUserId: employee.employeeUserId,
        ...(employeeName !== undefined && { employeeName }),
        ...(employee.workerType !== undefined && { workerType: employee.workerType }),
        ...(employee.percentage !== undefined && { percentage: employee.percentage }),
      });
    });

  return Array.from(assigneeMap.values());
};

const dedupeAssignees = (
  assignees: NormalizedAttendanceAssigneeInput[],
): NormalizedAttendanceAssigneeInput[] => {
  const assigneeMap = new Map<string, NormalizedAttendanceAssigneeInput>();

  assignees.forEach((assignee) => {
    const existingAssignee = assigneeMap.get(assignee.employeeUserId);

    if (existingAssignee) {
      assigneeMap.set(assignee.employeeUserId, {
        employeeUserId: assignee.employeeUserId,
        employeeName: assignee.employeeName ?? existingAssignee.employeeName,
        ...(assignee.workerType !== undefined && { workerType: assignee.workerType }),
        ...(assignee.workerType === undefined &&
          existingAssignee.workerType !== undefined && {
            workerType: existingAssignee.workerType,
          }),
        ...(assignee.percentage !== undefined && { percentage: assignee.percentage }),
        ...(assignee.percentage === undefined &&
          existingAssignee.percentage !== undefined && {
            percentage: existingAssignee.percentage,
          }),
      });
      return;
    }

    assigneeMap.set(assignee.employeeUserId, {
      employeeUserId: assignee.employeeUserId,
      ...(assignee.employeeName !== undefined && { employeeName: assignee.employeeName }),
      ...(assignee.workerType !== undefined && { workerType: assignee.workerType }),
      ...(assignee.percentage !== undefined && { percentage: assignee.percentage }),
    });
  });

  return Array.from(assigneeMap.values());
};

const normalizeFrontendPayload = (
  payload: FrontendAttendancePayload,
): NormalizedAttendancePayload | undefined => {
  const startDate =
    parseTimestampInput(payload.startTimestamp) ??
    parseDateInput(payload.createdAt ?? payload.date);

  if (!startDate) {
    return undefined;
  }

  const storeId = String(payload.storeId);
  if (!storeId) {
    return undefined;
  }

  const frontendServices = payload.services.map((service) => {
    const price = parseMoneyInput(service.amount) ?? parseMoneyInput(service.price);

    if (price === undefined) {
      return undefined;
    }

    const duration = parseDurationInput(service.duration) ?? parseDurationInput(service.time);
    const durationMin = parseDurationInput(service.durationMin) ?? duration;
    const durationMax = parseDurationInput(service.durationMax) ?? duration;

    return {
      id: service.id,
      ...(service.sourceServiceId !== undefined && {
        sourceServiceId: service.sourceServiceId,
      }),
      ...(service.sourceServiceId !== undefined && { mode: "existing" as const }),
      ...(service.sourceServiceId === undefined && { mode: "create_new" as const }),
      name: service.name,
      ...(service.description !== undefined && { description: service.description }),
      ...(service.category !== undefined && { category: service.category }),
      ...((service.imageUrls ?? service.images) !== undefined && {
        imageUrls: service.imageUrls ?? service.images,
      }),
      ...(durationMin !== undefined && { durationMin }),
      ...(durationMax !== undefined && { durationMax }),
      price,
      employees: service.employees.map((employee) => ({
        employeeUserId: employee.employeeId,
        ...(employee.employeeName !== undefined && { employeeName: employee.employeeName }),
        ...(employee.workerType !== undefined && { workerType: employee.workerType }),
        ...(employee.percentage !== undefined && { percentage: employee.percentage }),
      })),
    };
  });

  if (frontendServices.some((service) => service === undefined)) {
    return undefined;
  }

  const normalizedServices = frontendServices as NormalizedAttendanceServiceInput[];
  const allEmployees = normalizedServices.flatMap((service) => service.employees);
  const requestedMainAssigneeUserId = payload.mainAssigneeUserId ?? payload.employeeUserId;
  const requestedAssignee =
    requestedMainAssigneeUserId !== undefined
      ? [
          {
            employeeUserId: requestedMainAssigneeUserId,
            ...(payload.employeeName !== undefined && { employeeName: payload.employeeName }),
            workerType: "main" as const,
            percentage: 100,
          },
        ]
      : [];
  const requestedAssistantAssignee =
    payload.assistantAssigneeUserId !== undefined
      ? [
          {
            employeeUserId: payload.assistantAssigneeUserId,
            workerType: "assistant" as const,
          },
        ]
      : [];
  const assignees = dedupeAssignees([
    ...allEmployees,
    ...requestedAssignee,
    ...requestedAssistantAssignee,
  ]);
  const defaultDurationMinutes = Math.max(
    normalizedServices.reduce(
      (sum, service) => sum + Math.max(service.durationMax ?? service.durationMin ?? 0, 0),
      0,
    ),
    60,
  );
  const fallbackEndDate = new Date(startDate.getTime() + defaultDurationMinutes * 60_000);
  const endDate =
    parseTimestampInput(payload.endTimestamp) ??
    (payload.endDate ? parseDateInput(payload.endDate) : fallbackEndDate);

  if (!endDate) {
    return undefined;
  }

  const workDate = resolveBusinessWorkDate(startDate);
  const startTime = toMinutesFromDate(startDate);
  let endTime = toMinutesFromDate(endDate);

  if (endTime <= startTime) {
    endTime = startTime + defaultDurationMinutes;
  }

  const normalizedCustomerPhone = normalizeCustomerPhone(payload.customerPhone);

  if (payload.customerPhone?.trim() && normalizedCustomerPhone === undefined) {
    return undefined;
  }

  return {
    storeId,
    ...(payload.bookingId !== undefined && { bookingId: payload.bookingId }),
    ...(payload.employeeUserId !== undefined && {
      mainAssigneeUserId: payload.employeeUserId,
    }),
    ...(payload.mainAssigneeUserId !== undefined && {
      mainAssigneeUserId: payload.mainAssigneeUserId,
    }),
    ...(payload.assistantAssigneeUserId !== undefined && {
      assistantAssigneeUserId: payload.assistantAssigneeUserId,
    }),
    workDate,
    startTimestamp: startDate.getTime(),
    endTimestamp: endDate.getTime(),
    startTime,
    endTime,
    ...(payload.customerName !== undefined && { customerName: payload.customerName }),
    ...(normalizedCustomerPhone !== undefined && { customerPhone: normalizedCustomerPhone }),
    ...(payload.note !== undefined && { note: payload.note }),
    ...(payload.bookingSource !== undefined && { bookingSource: payload.bookingSource }),
    ...(payload.source !== undefined && { source: payload.source }),
    services: normalizedServices,
    assignees,
    ...(payload.discount !== undefined && { discount: payload.discount }),
    ...(payload.discountAmount !== undefined && {
      discountAmount: Math.max(payload.discountAmount, 0),
    }),
    ...(payload.bookingStatus !== undefined && { bookingStatus: payload.bookingStatus }),
    ...(payload.attendanceStatus !== undefined && { attendanceStatus: payload.attendanceStatus }),
  };
};

// 2 tầng: zod kiểm hình dạng thô FE gửi lên, rồi normalize về dạng nghiệp vụ dùng nội bộ.
export const parseAttendancePayload = (
  input: unknown,
): { success: true; data: NormalizedAttendancePayload } | { success: false } => {
  const frontendParseResult = frontendAttendancePayloadSchema.safeParse(input);

  if (!frontendParseResult.success) {
    return { success: false };
  }

  const normalizedPayload = normalizeFrontendPayload(frontendParseResult.data);

  if (!normalizedPayload) {
    return { success: false };
  }

  return {
    success: true,
    data: normalizedPayload,
  };
};
