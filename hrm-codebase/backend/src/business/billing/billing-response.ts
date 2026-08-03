import type { OwnerUserType } from "../../repository/firestore/user/user.types.js";
import type { BillingAccountRecord } from "./billing.types.js";
import {
  getBillingMethodAvailability,
  getBillingPlanConfiguration,
  getPayPalBillingConfiguration,
} from "./billing-config.js";

export type BillingOverviewResponse = {
  plan: ReturnType<typeof getBillingPlanConfiguration>;
  methods: Array<
    | {
        provider: "paypal";
        label: "PayPal";
        availability: "available" | "coming_soon";
        clientId?: string;
        planId?: string;
        customerReference?: string;
      }
    | {
        provider: "momo";
        label: "MoMo";
        availability: "coming_soon";
      }
  >;
  currentPlan: "standard" | "premium";
  subscription?: {
    provider: BillingAccountRecord["provider"];
    status: BillingAccountRecord["status"];
    providerSubscriptionId: string;
    nextBillingAt?: number;
  };
};

export const resolveBillingOverviewResponse = (
  owner: OwnerUserType,
  billingAccount: BillingAccountRecord | undefined,
): BillingOverviewResponse => {
  const paypalConfiguration = getPayPalBillingConfiguration();
  const paypalAvailability = getBillingMethodAvailability("paypal");

  return {
    plan: getBillingPlanConfiguration(),
    methods: [
      {
        provider: "paypal",
        label: "PayPal",
        availability: paypalAvailability,
        ...(paypalConfiguration !== undefined && {
          clientId: paypalConfiguration.clientId,
          planId: paypalConfiguration.planId,
          customerReference: owner.uid,
        }),
      },
      {
        provider: "momo",
        label: "MoMo",
        availability: "coming_soon",
      },
    ],
    currentPlan: owner.dataRetentionPlan ?? "standard",
    ...(billingAccount !== undefined && {
      subscription: {
        provider: billingAccount.provider,
        status: billingAccount.status,
        providerSubscriptionId: billingAccount.providerSubscriptionId,
        ...(billingAccount.nextBillingAt !== undefined && {
          nextBillingAt: billingAccount.nextBillingAt,
        }),
      },
    }),
  };
};
