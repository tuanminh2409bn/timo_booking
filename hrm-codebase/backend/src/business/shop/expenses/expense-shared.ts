import { z } from "zod";

const workDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const safeReceiptContentTypeSchema = z.enum(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const safeReceiptFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => /[A-Za-z0-9]/.test(value), {
    message: "Receipt file name must contain a letter or number",
  });
const receiptStoragePathSchema = z
  .string()
  .trim()
  .regex(/^expense-receipts\/[A-Za-z0-9._/-]+$/)
  .refine(
    (value) =>
      value
        .split("/")
        .every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    { message: "Receipt storage path contains an invalid segment" },
  );
const safeReceiptImageUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "https:" || protocol === "http:";
      } catch {
        return false;
      }
    },
    { message: "Receipt image URL must use http or https" },
  );

const expenseReceiptSchema = z
  .object({
    imageUrl: safeReceiptImageUrlSchema,
    storagePath: receiptStoragePathSchema.optional(),
    fileName: safeReceiptFileNameSchema.optional(),
    contentType: safeReceiptContentTypeSchema.optional(),
  })
  .optional();

export const expenseItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  supplierName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  amount: z.coerce.number().finite().positive(),
  receiptImage: expenseReceiptSchema,
});

export const expenseBatchSchema = z
  .object({
    storeId: z.string().trim().min(1).optional(),
    workDate: workDateSchema,
    items: z.array(expenseItemSchema).min(1).max(20),
  })
  .transform((expenseBatchInput, ctx) => {
    const storeId = expenseBatchInput.storeId;

    if (!storeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storeId"],
        message: "storeId is required",
      });
      return z.NEVER;
    }

    return { ...expenseBatchInput, storeId };
  });

export const expenseListQuerySchema = z
  .object({
    storeId: z.string().trim().min(1).optional(),
    fromWorkDate: workDateSchema,
    toWorkDate: workDateSchema,
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .transform((expenseListQueryInput, ctx) => {
    const storeId = expenseListQueryInput.storeId;

    if (!storeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storeId"],
        message: "storeId is required",
      });
      return z.NEVER;
    }

    return { ...expenseListQueryInput, storeId };
  });

export const expenseReceiptUploadSchema = z
  .object({
    storeId: z.string().trim().min(1).optional(),
    workDate: workDateSchema,
    fileName: safeReceiptFileNameSchema,
    contentType: safeReceiptContentTypeSchema,
    base64: z.string().trim().min(1),
  })
  .transform((receiptUploadInput, ctx) => {
    const storeId = receiptUploadInput.storeId;

    if (!storeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storeId"],
        message: "storeId is required",
      });
      return z.NEVER;
    }

    return { ...receiptUploadInput, storeId };
  });

export const updateExpenseSchema = expenseItemSchema
  .partial()
  .extend({
    storeId: z.string().trim().min(1).optional(),
    workDate: workDateSchema.optional(),
  })
  .refine(
    (expenseUpdate) =>
      expenseUpdate.workDate !== undefined ||
      expenseUpdate.name !== undefined ||
      expenseUpdate.supplierName !== undefined ||
      expenseUpdate.note !== undefined ||
      expenseUpdate.amount !== undefined ||
      expenseUpdate.receiptImage !== undefined,
    {
      message: "At least one expense field must be updated",
    },
  )
  .transform((expenseUpdate) => ({ ...expenseUpdate, storeId: expenseUpdate.storeId }));

export const parseExpenseBatchPayload = (payload: unknown) => expenseBatchSchema.safeParse(payload);
export const parseExpenseListQuery = (payload: unknown) =>
  expenseListQuerySchema.safeParse(payload);
export const parseExpenseReceiptUploadPayload = (payload: unknown) =>
  expenseReceiptUploadSchema.safeParse(payload);
export const parseUpdateExpensePayload = (payload: unknown) =>
  updateExpenseSchema.safeParse(payload);

export type ExpenseBatchInput = z.infer<typeof expenseBatchSchema>;
export type ExpenseItemInput = z.infer<typeof expenseItemSchema>;
export type ExpenseReceiptUploadInput = z.infer<typeof expenseReceiptUploadSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
