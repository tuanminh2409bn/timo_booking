import { addUtcCalendarMonths } from "../../helpers/data-retention.js";
import { firestoreRepository } from "../../repository/firestore/index.js";
import type { OwnerUserType } from "../../repository/firestore/user/user.types.js";
import { getBillingPlanConfiguration, getPayPalBillingConfiguration } from "./billing-config.js";
import type { BillingAccountRecord, BillingSubscriptionStatus } from "./billing.types.js";
import type { PayPalSubscription } from "./paypal-client.js";

const toBillingStatus = (status: PayPalSubscription["status"]): BillingSubscriptionStatus => {
  if (status === "ACTIVE") {
    return "active";
  }

  if (status === "SUSPENDED") {
    return "suspended";
  }

  if (status === "CANCELLED") {
    return "cancelled";
  }

  return "expired";
};

const getTimestamp = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

const createBillingAccountRecord = (
  ownerUserId: string,
  ownerId: string,
  subscription: PayPalSubscription,
  existing: BillingAccountRecord | undefined,
  now: number,
  statusOverride?: BillingSubscriptionStatus,
): BillingAccountRecord => {
  const configuration = getPayPalBillingConfiguration();

  if (configuration === undefined) {
    throw new Error("PayPal billing is not configured");
  }

  const plan = getBillingPlanConfiguration();
  const nextBillingAt = getTimestamp(subscription.billing_info?.next_billing_time);

  return {
    ownerUserId,
    ownerId,
    provider: "paypal",
    providerSubscriptionId: subscription.id,
    providerPlanId: subscription.plan_id,
    plan: "premium",
    status: statusOverride ?? toBillingStatus(subscription.status),
    amount: plan.amount,
    currency: plan.currency,
    interval: "month",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(subscription.status === "ACTIVE" && { activatedAt: existing?.activatedAt ?? now }),
    ...(nextBillingAt !== undefined && { nextBillingAt }),
  };
};

export type PayPalSubscriptionSyncResult = {
  owner: OwnerUserType;
  billingAccount: BillingAccountRecord;
  planChanged: boolean;
};

export const syncPayPalSubscription = async ({
  ownerUserId,
  ownerId,
  subscription,
  now = Date.now(),
  statusOverride,
}: {
  ownerUserId: string;
  ownerId: string;
  subscription: PayPalSubscription;
  now?: number;
  statusOverride?: BillingSubscriptionStatus;
}): Promise<PayPalSubscriptionSyncResult> => {
  const currentUser = await firestoreRepository.user.getUser(ownerUserId);

  if (currentUser.role !== "owner" || currentUser.ownerId !== ownerId) {
    throw new Error("Billing account owner mismatch");
  }

  const existing = await firestoreRepository.billing.getBillingAccount(ownerUserId);
  const billingAccount = createBillingAccountRecord(
    ownerUserId,
    ownerId,
    subscription,
    existing,
    now,
    statusOverride,
  );
  await firestoreRepository.billing.upsertBillingAccount(billingAccount);

  const isDowngrade = ["cancelled", "expired", "suspended"].includes(billingAccount.status);
  const nextPlan =
    billingAccount.status === "payment_failed"
      ? (currentUser.dataRetentionPlan ?? "standard")
      : isDowngrade
        ? "standard"
        : "premium";
  const planChanged = currentUser.dataRetentionPlan !== nextPlan;

  if (planChanged) {
    const standardRetentionEligibleAt =
      nextPlan === "standard" ? addUtcCalendarMonths(now, 2) : undefined;
    await firestoreRepository.user.updateUser(ownerUserId, {
      dataRetentionPlan: nextPlan,
      dataRetentionPlanChangedAt: now,
      dataRetentionStandardEligibleAt: standardRetentionEligibleAt,
      updatedAt: now,
      updatedByUserId: ownerUserId,
    });
  }

  const updatedUser = await firestoreRepository.user.getUser(ownerUserId);

  if (updatedUser.role !== "owner") {
    throw new Error("Billing account owner mismatch");
  }

  return {
    owner: updatedUser,
    billingAccount,
    planChanged,
  };
};

export const getPayPalSubscriptionStatus = (status: PayPalSubscription["status"]) =>
  toBillingStatus(status);
