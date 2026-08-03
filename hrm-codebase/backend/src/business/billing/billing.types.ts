export const BILLING_PROVIDER_VALUES = ["paypal", "momo"] as const;
export type BillingProvider = (typeof BILLING_PROVIDER_VALUES)[number];

export const BILLING_PLAN_CODE_VALUES = ["premium"] as const;
export type BillingPlanCode = (typeof BILLING_PLAN_CODE_VALUES)[number];

export const BILLING_SUBSCRIPTION_STATUS_VALUES = [
  "approval_pending",
  "active",
  "cancelled",
  "suspended",
  "expired",
  "payment_failed",
] as const;
export type BillingSubscriptionStatus = (typeof BILLING_SUBSCRIPTION_STATUS_VALUES)[number];

export type BillingAccountRecord = {
  ownerUserId: string;
  ownerId: string;
  provider: BillingProvider;
  providerSubscriptionId: string;
  providerPlanId: string;
  plan: BillingPlanCode;
  status: BillingSubscriptionStatus;
  amount: string;
  currency: string;
  interval: "month";
  createdAt: number;
  updatedAt: number;
  activatedAt?: number;
  nextBillingAt?: number;
};
