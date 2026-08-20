import { z } from "zod";
import {
  ShopServiceCategoryEnum,
  type ShopServiceCategoryType,
} from "../../../repository/firestore/shop/shop.types.js";
import { parseMoneyInput } from "../../../helpers/money.js";

const parseDurationInput = (value: string | number): number | undefined => {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  const normalizedValue = value.replace(/[^0-9]/g, "");
  const parsedValue = Number.parseInt(normalizedValue, 10);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : undefined;
};

const moneyInputSchema = z
  .union([z.number(), z.string().trim().min(1)])
  .refine((value) => parseMoneyInput(value) !== undefined, {
    message: "must be a positive number",
  });
const durationInputSchema = z
  .union([z.number().int().positive(), z.string().trim().min(1)])
  .refine((value) => parseDurationInput(value) !== undefined, {
    message: "must be a positive integer",
  });

export const mapGroupServiceToCategory = (groupServiceName: string): ShopServiceCategoryType => {
  const normalizedValue = groupServiceName.trim().toLowerCase();

  if (normalizedValue.includes("pedicure") || normalizedValue.includes("foot")) {
    return "pedicure";
  }

  if (normalizedValue.includes("manicure") || normalizedValue.includes("hand")) {
    return "manicure";
  }

  if (normalizedValue.includes("design") || normalizedValue.includes("art")) {
    return "design";
  }

  if (normalizedValue.includes("nail")) {
    return "nail";
  }

  return "other";
};

export const createShopServiceGroupSchema = z
  .object({
    storeId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(100),
    category: ShopServiceCategoryEnum.optional(),
  })
  .superRefine((serviceGroupInput, ctx) => {
    if (serviceGroupInput.storeId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storeId"],
        message: "storeId is required",
      });
    }
  })
  .transform((serviceGroupInput) => ({
    ...serviceGroupInput,
    storeId: serviceGroupInput.storeId ?? "",
  }));

export const normalizeShopServiceGroupPayload = (
  payload: z.infer<typeof createShopServiceGroupSchema>,
) => {
  const name = payload.name.trim();

  return {
    storeId: payload.storeId,
    name,
    label: name,
    category: payload.category ?? mapGroupServiceToCategory(name),
  };
};

export const createShopServiceSchema = z
  .object({
    storeId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(100),
    displayName: z.string().trim().max(40).optional(),
    description: z.string().trim().max(500).optional(),
    price: moneyInputSchema.optional(),
    amount: moneyInputSchema.optional(),
    category: ShopServiceCategoryEnum.optional(),
    groupService: z.string().trim().min(1).max(100).optional(),
    preferredWorkerType: z.enum(["main", "assistant"]).optional(),
    bookingKind: z.enum(["main", "add_on"]).optional().default("main"),
    availableForBooking: z.boolean().optional().default(true),
    durationMin: durationInputSchema.optional(),
    durationMax: durationInputSchema.optional(),
    duration: durationInputSchema.optional(),
  })
  .superRefine((serviceInput, ctx) => {
    if (serviceInput.storeId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storeId"],
        message: "storeId is required",
      });
    }

    if (serviceInput.price === undefined && serviceInput.amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "price or amount is required",
      });
    }

    if (serviceInput.category === undefined && serviceInput.groupService === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "category or groupService is required",
      });
    }

    if (
      serviceInput.duration === undefined &&
      (serviceInput.durationMin === undefined || serviceInput.durationMax === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["duration"],
        message: "duration or durationMin/durationMax is required",
      });
    }
  })
  .transform((serviceInput) => ({
    ...serviceInput,
    storeId: serviceInput.storeId ?? "",
  }));

export const updateShopServiceSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    displayName: z.string().trim().max(40).optional(),
    description: z.string().trim().max(500).optional(),
    price: moneyInputSchema.optional(),
    amount: moneyInputSchema.optional(),
    category: ShopServiceCategoryEnum.optional(),
    groupService: z.string().trim().min(1).max(100).optional(),
    preferredWorkerType: z.enum(["main", "assistant"]).optional(),
    bookingKind: z.enum(["main", "add_on"]).optional(),
    availableForBooking: z.boolean().optional(),
    durationMin: durationInputSchema.optional(),
    durationMax: durationInputSchema.optional(),
    duration: durationInputSchema.optional(),
  })
  .refine((serviceUpdate) => Object.keys(serviceUpdate).length > 0, {
    message: "At least one field must be updated",
  });

export type CreateShopServiceInput = z.infer<typeof createShopServiceSchema>;
export type UpdateShopServiceInput = z.infer<typeof updateShopServiceSchema>;

export type NormalizedShopServicePayload = {
  name?: string;
  displayName?: string;
  description?: string;
  groupService?: string;
  price?: number;
  category?: ShopServiceCategoryType;
  durationMin?: number;
  durationMax?: number;
  preferredWorkerType?: "main" | "assistant";
  bookingKind?: "main" | "add_on";
  availableForBooking?: boolean;
};

export const isValidShopServiceDurationRange = (
  durationMin: number | undefined,
  durationMax: number | undefined,
): boolean => {
  if (durationMin === undefined || durationMax === undefined) {
    return false;
  }

  return durationMax >= durationMin;
};

export const normalizeShopServicePayload = (
  payload: CreateShopServiceInput | UpdateShopServiceInput,
): NormalizedShopServicePayload => {
  const priceInput = payload.price ?? payload.amount;
  const price = priceInput === undefined ? undefined : parseMoneyInput(priceInput);

  const durationInput = payload.duration;

  let durationMin: number | undefined;

  if (durationInput !== undefined) {
    durationMin = parseDurationInput(durationInput);
  } else if (payload.durationMin !== undefined) {
    durationMin = parseDurationInput(payload.durationMin);
  }

  let durationMax: number | undefined;

  if (durationInput !== undefined) {
    durationMax = parseDurationInput(durationInput);
  } else if (payload.durationMax !== undefined) {
    durationMax = parseDurationInput(payload.durationMax);
  }
  const category =
    payload.category ??
    (payload.groupService ? mapGroupServiceToCategory(payload.groupService) : undefined);
  const groupService = payload.groupService !== undefined ? payload.groupService.trim() : undefined;

  return {
    ...(payload.name !== undefined && { name: payload.name }),
    ...(payload.displayName !== undefined && { displayName: payload.displayName }),
    ...(payload.description !== undefined && { description: payload.description }),
    ...(groupService !== undefined && { groupService }),
    ...(price !== undefined && { price }),
    ...(category !== undefined && { category }),
    ...(durationMin !== undefined && { durationMin }),
    ...(durationMax !== undefined && { durationMax }),
    ...(payload.preferredWorkerType !== undefined && {
      preferredWorkerType: payload.preferredWorkerType,
    }),
    ...(payload.bookingKind !== undefined && { bookingKind: payload.bookingKind }),
    ...(payload.availableForBooking !== undefined && {
      availableForBooking: payload.availableForBooking,
    }),
  };
};
