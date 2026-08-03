import { z } from "zod";
import {
  DEFAULT_BUSINESS_TIME_ZONE,
  isValidBusinessTimeZone,
  isValidTimeOfDay,
} from "../../../helpers/business-day.js";
import { StoreStatusEnum } from "../../../repository/firestore/shop/shop.types.js";

const optionalTrimmedString = (maxLength: number) => z.string().trim().max(maxLength).optional();
const optionalTimeOfDaySchema = (fieldName: string) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z
      .string()
      .trim()
      .refine(isValidTimeOfDay, {
        message: `${fieldName} must be in HH:mm format`,
      })
      .optional(),
  );
const openTimeSchema = optionalTimeOfDaySchema("openTime");
const closeTimeSchema = optionalTimeOfDaySchema("closeTime");
const settlementCutoffTimeSchema = optionalTimeOfDaySchema("settlementCutoffTime");
const timezoneValueSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .trim()
    .refine(isValidBusinessTimeZone, {
      message: "timezone must be a valid IANA time zone",
    })
    .optional(),
);
const timezoneSchema = timezoneValueSchema.default(DEFAULT_BUSINESS_TIME_ZONE);
const bookingSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100)
  .optional();

export const storeAddressSchema = z
  .object({
    line1: z.string().trim().max(255).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    zipCode: z.string().trim().max(20).optional(),
    country: z.string().trim().max(100).optional(),
  })
  .optional();

export const createStoreSchema = z.object({
  name: z.string().trim().min(1).max(100),
  bookingSlug: bookingSlugSchema,
  phone: z.string().trim().max(30).optional(),
  email: optionalTrimmedString(100),
  manager: optionalTrimmedString(100),
  website: optionalTrimmedString(255),
  openTime: openTimeSchema,
  closeTime: closeTimeSchema,
  settlementCutoffTime: settlementCutoffTimeSchema,
  timezone: timezoneSchema,
  foundedDate: optionalTrimmedString(50),
  address: storeAddressSchema,
  status: StoreStatusEnum.default("active"),
  bookingWindowDays: z.number().int().min(1).max(365).optional().default(30),
  minimumNoticeHours: z.number().min(0).max(168).optional().default(2),
  cancellationNoticeHours: z.number().min(0).max(168).optional().default(12),
  slotIntervalMinutes: z.number().int().min(5).max(120).optional().default(15),
  publicStaffSelection: z.boolean().optional().default(true),
});

export const updateStoreSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    bookingSlug: bookingSlugSchema,
    phone: z.string().trim().max(30).optional(),
    email: optionalTrimmedString(100),
    manager: optionalTrimmedString(100),
    website: optionalTrimmedString(255),
    openTime: openTimeSchema,
    closeTime: closeTimeSchema,
    settlementCutoffTime: settlementCutoffTimeSchema,
    timezone: timezoneValueSchema,
    foundedDate: optionalTrimmedString(50),
    address: storeAddressSchema,
    status: StoreStatusEnum.optional(),
    bookingWindowDays: z.number().int().min(1).max(365).optional(),
    minimumNoticeHours: z.number().min(0).max(168).optional(),
    cancellationNoticeHours: z.number().min(0).max(168).optional(),
    slotIntervalMinutes: z.number().int().min(5).max(120).optional(),
    publicStaffSelection: z.boolean().optional(),
  })
  .refine((storeUpdate) => Object.keys(storeUpdate).length > 0, {
    message: "At least one field must be updated",
  });
