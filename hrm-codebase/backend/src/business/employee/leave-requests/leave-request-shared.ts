import { z } from "zod";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const workDateSchema = z.string().regex(DATE_KEY_PATTERN).refine(isValidWorkDate);

export const leaveRequestSchema = z.object({
  storeId: z.string().min(1),
  startDate: workDateSchema,
  endDate: workDateSchema,
  allDay: z.boolean().default(true),
  reason: z.string().trim().min(1).max(500),
});
