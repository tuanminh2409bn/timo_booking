import { z } from "zod";
import { isValidWorkDate } from "../../../helpers/verify-work-date.js";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const workDateSchema = z.string().regex(DATE_KEY_PATTERN).refine(isValidWorkDate);

export type EmployeeLeaveWindow = {
  startDate: string;
  endDate: string;
  allDay?: boolean | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
};

const timeToMinutes = (value: string | undefined): number | undefined => {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined;
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

/** True only when the leave blocks this concrete attendance interval. */
export const leaveOverlapsAttendance = (
  leave: EmployeeLeaveWindow,
  workDate: string,
  attendanceStartMinutes: number,
  attendanceEndMinutes: number,
): boolean => {
  if (workDate < leave.startDate || workDate > leave.endDate) return false;
  if (leave.allDay !== false) return true;

  const leaveStart = timeToMinutes(leave.startTime);
  const leaveEnd = timeToMinutes(leave.endTime);
  // Legacy partial records without a valid interval are treated conservatively.
  if (leaveStart === undefined || leaveEnd === undefined) return true;
  return attendanceStartMinutes < leaveEnd && attendanceEndMinutes > leaveStart;
};

export const leaveRequestSchema = z.object({
  storeId: z.string().min(1),
  startDate: workDateSchema,
  endDate: workDateSchema,
  allDay: z.boolean().default(true),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  reason: z.string().trim().min(1).max(500),
}).superRefine((value, context) => {
  if (value.allDay) return;
  if (!value.startTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["startTime"], message: "startTime is required for partial-day leave" });
  }
  if (!value.endTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "endTime is required for partial-day leave" });
  }
  if (value.startDate !== value.endDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "partial-day leave must be within one day" });
  }
  if (value.startTime && value.endTime && value.startTime >= value.endTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "endTime must be after startTime" });
  }
});
