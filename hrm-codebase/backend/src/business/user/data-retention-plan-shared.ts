import { z } from "zod";
import { addUtcCalendarMonths, STANDARD_DETAIL_RETENTION_MONTHS } from "../../helpers/data-retention.js";
import {
  OWNER_DATA_RETENTION_PLAN_VALUES,
  type OwnerDataRetentionPlan,
  type OwnerUserType,
} from "../../repository/firestore/user/user.types.js";

export const updateDataRetentionPlanSchema = z.object({
  plan: z.enum(OWNER_DATA_RETENTION_PLAN_VALUES),
});

export type DataRetentionPlanResponse = {
  plan: OwnerDataRetentionPlan;
  detailRetentionMonths: number | null;
  planChangedAt: number;
  standardRetentionEligibleAt?: number;
};

export const resolveOwnerDataRetentionPlanResponse = (
  owner: OwnerUserType,
  now: number,
): DataRetentionPlanResponse => {
  const plan = owner.dataRetentionPlan ?? "standard";
  const planChangedAt = owner.dataRetentionPlanChangedAt ?? now;
  const standardRetentionEligibleAt =
    plan === "standard"
      ? owner.dataRetentionStandardEligibleAt ?? addUtcCalendarMonths(planChangedAt, 2)
      : undefined;

  return {
    plan,
    detailRetentionMonths: plan === "standard" ? STANDARD_DETAIL_RETENTION_MONTHS : null,
    planChangedAt,
    ...(standardRetentionEligibleAt !== undefined && { standardRetentionEligibleAt }),
  };
};

export const ownerDataRetentionPolicyNeedsInitialization = (owner: OwnerUserType): boolean =>
  owner.dataRetentionPlan === undefined ||
  owner.dataRetentionPlanChangedAt === undefined ||
  (owner.dataRetentionPlan === "standard" && owner.dataRetentionStandardEligibleAt === undefined);
