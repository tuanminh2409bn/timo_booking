import type { Firestore } from "@google-cloud/firestore";
import {
  BILLING_PROVIDER_VALUES,
  BILLING_SUBSCRIPTION_STATUS_VALUES,
  type BillingAccountRecord,
} from "../../../business/billing/billing.types.js";

const BILLING_ACCOUNTS_COLLECTION = "billing_accounts";

const isStringValue = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const parseBillingAccount = (data: unknown): BillingAccountRecord | undefined => {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  const provider = record["provider"];
  const status = record["status"];

  if (
    !isStringValue(record["ownerUserId"]) ||
    !isStringValue(record["ownerId"]) ||
    !BILLING_PROVIDER_VALUES.includes(provider as (typeof BILLING_PROVIDER_VALUES)[number]) ||
    !isStringValue(record["providerSubscriptionId"]) ||
    !isStringValue(record["providerPlanId"]) ||
    record["plan"] !== "premium" ||
    !BILLING_SUBSCRIPTION_STATUS_VALUES.includes(
      status as (typeof BILLING_SUBSCRIPTION_STATUS_VALUES)[number],
    ) ||
    !isStringValue(record["amount"]) ||
    !isStringValue(record["currency"]) ||
    record["interval"] !== "month" ||
    typeof record["createdAt"] !== "number" ||
    typeof record["updatedAt"] !== "number"
  ) {
    return undefined;
  }

  return {
    ownerUserId: record["ownerUserId"],
    ownerId: record["ownerId"],
    provider: provider as BillingAccountRecord["provider"],
    providerSubscriptionId: record["providerSubscriptionId"],
    providerPlanId: record["providerPlanId"],
    plan: "premium",
    status: status as BillingAccountRecord["status"],
    amount: record["amount"],
    currency: record["currency"],
    interval: "month",
    createdAt: record["createdAt"],
    updatedAt: record["updatedAt"],
    ...(typeof record["activatedAt"] === "number" && { activatedAt: record["activatedAt"] }),
    ...(typeof record["nextBillingAt"] === "number" && {
      nextBillingAt: record["nextBillingAt"],
    }),
  };
};

export const getBillingAccountFactory = (firestoreDB: Firestore) => {
  return async (ownerUserId: string): Promise<BillingAccountRecord | undefined> => {
    const snapshot = await firestoreDB
      .collection(BILLING_ACCOUNTS_COLLECTION)
      .doc(ownerUserId)
      .get();

    return snapshot.exists ? parseBillingAccount(snapshot.data()) : undefined;
  };
};

export const getBillingAccountByProviderSubscriptionFactory = (firestoreDB: Firestore) => {
  return async (providerSubscriptionId: string): Promise<BillingAccountRecord | undefined> => {
    const snapshot = await firestoreDB
      .collection(BILLING_ACCOUNTS_COLLECTION)
      .where("providerSubscriptionId", "==", providerSubscriptionId)
      .limit(1)
      .get();
    const document = snapshot.docs[0];

    return document === undefined ? undefined : parseBillingAccount(document.data());
  };
};

export const upsertBillingAccountFactory = (firestoreDB: Firestore) => {
  return async (record: BillingAccountRecord): Promise<void> => {
    await firestoreDB
      .collection(BILLING_ACCOUNTS_COLLECTION)
      .doc(record.ownerUserId)
      .set(record, { merge: true });
  };
};
