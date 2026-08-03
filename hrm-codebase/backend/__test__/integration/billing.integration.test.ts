import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  app,
  getUserOrThrow,
  ownerSessionHeader,
  paypalClientMocks,
  state,
  withRequestDefaults,
} from "./backend-api-fixture.js";

const { cancelSubscription, createSubscription, getSubscription, verifyWebhookSignature } =
  paypalClientMocks;
const originalAppCheckMode = process.env["APP_CHECK_MODE"];

const paypalWebhookHeaders = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert.pem",
  "paypal-transmission-id": "transmission-1",
  "paypal-transmission-sig": "signature-1",
  "paypal-transmission-time": "2026-08-01T00:00:00Z",
};

const activeSubscription = {
  id: "I-PREMIUM-OWNER-1",
  status: "ACTIVE" as const,
  plan_id: "P-TEST-PREMIUM",
  custom_id: "owner-1",
  billing_info: {
    next_billing_time: "2026-09-01T00:00:00Z",
  },
};

const seedLinkedBillingAccount = () => {
  state.billingAccounts.set("owner-1", {
    ownerUserId: "owner-1",
    ownerId: "shop-1",
    provider: "paypal",
    providerSubscriptionId: activeSubscription.id,
    providerPlanId: activeSubscription.plan_id,
    plan: "premium",
    status: "active",
    amount: "99.99",
    currency: "EUR",
    interval: "month",
    createdAt: Date.parse("2026-08-01T00:00:00Z"),
    updatedAt: Date.parse("2026-08-01T00:00:00Z"),
    activatedAt: Date.parse("2026-08-01T00:00:00Z"),
  });
};

beforeEach(() => {
  cancelSubscription.mockReset();
  createSubscription.mockReset();
  getSubscription.mockReset();
  verifyWebhookSignature.mockReset();
});

afterEach(() => {
  if (originalAppCheckMode === undefined) {
    delete process.env["APP_CHECK_MODE"];
    return;
  }

  process.env["APP_CHECK_MODE"] = originalAppCheckMode;
});

describe("Account billing API", () => {
  it("rejects activating Premium without an approved billing subscription", async () => {
    const response = await withRequestDefaults(
      request(app)
        .patch("/api/v1/account/data-retention-plan")
        .set("Authorization", ownerSessionHeader())
        .send({ plan: "premium" }),
    );

    expect(response.status).toBe(402);
    expect(response.body.type).toBe("/account/data-retention-plan/payment-required");
    expect(getUserOrThrow("owner-1").dataRetentionPlan).not.toBe("premium");
  });

  it("starts a PayPal subscription without activating Premium", async () => {
    createSubscription.mockResolvedValue({
      id: "I-PENDING-OWNER-1",
      status: "APPROVAL_PENDING" as const,
      plan_id: "P-TEST-PREMIUM",
      custom_id: "owner-1",
      links: [
        {
          href: "https://www.sandbox.paypal.com/checkoutnow?token=I-PENDING-OWNER-1",
          rel: "approve",
        },
      ],
    });

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/account/billing/subscriptions/start")
        .set("Authorization", ownerSessionHeader())
        .send({ provider: "paypal" }),
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      provider: "paypal",
      subscriptionId: "I-PENDING-OWNER-1",
      approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=I-PENDING-OWNER-1",
    });
    expect(getUserOrThrow("owner-1").dataRetentionPlan).not.toBe("premium");
    expect(state.billingAccounts.get("owner-1")).toMatchObject({
      providerSubscriptionId: "I-PENDING-OWNER-1",
      status: "approval_pending",
    });
  });

  it("rejects an unsupported checkout provider", async () => {
    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/account/billing/subscriptions/start")
        .set("Authorization", ownerSessionHeader())
        .send({ provider: "momo" }),
    );

    expect(response.status).toBe(400);
    expect(response.body.type).toBe("/account/billing/invalid-request");
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("cancels an active PayPal subscription before downgrading storage", async () => {
    const owner = getUserOrThrow("owner-1");
    state.users.set("owner-1", {
      ...owner,
      dataRetentionPlan: "premium",
    });
    seedLinkedBillingAccount();
    getSubscription.mockResolvedValue(activeSubscription);
    cancelSubscription.mockResolvedValue(undefined);

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/account/billing/subscriptions/cancel")
        .set("Authorization", ownerSessionHeader())
        .send({}),
    );

    expect(response.status).toBe(200);
    expect(response.body.currentPlan).toBe("standard");
    expect(getUserOrThrow("owner-1").dataRetentionPlan).toBe("standard");
    expect(state.billingAccounts.get("owner-1")?.status).toBe("cancelled");
    expect(cancelSubscription).toHaveBeenCalledWith(
      activeSubscription.id,
      expect.objectContaining({ planId: "P-TEST-PREMIUM" }),
    );
  });

  it("returns the Premium price and provider-neutral payment methods", async () => {
    const response = await withRequestDefaults(
      request(app).get("/api/v1/account/billing").set("Authorization", ownerSessionHeader()),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      plan: {
        code: "premium",
        name: "Premium",
        amount: "99.99",
        currency: "EUR",
        interval: "month",
      },
      currentPlan: "standard",
      methods: [
        {
          provider: "paypal",
          label: "PayPal",
          availability: "available",
          clientId: "test-paypal-client-id",
          planId: "P-TEST-PREMIUM",
          customerReference: "owner-1",
        },
        {
          provider: "momo",
          label: "MoMo",
          availability: "coming_soon",
        },
      ],
    });
  });

  it("forbids employees from reading owner billing", async () => {
    const response = await withRequestDefaults(
      request(app)
        .get("/api/v1/account/billing")
        .set(
          "Authorization",
          ownerSessionHeader({ uid: "staff-1", role: "employee", storeId: "branch-1" }),
        ),
    );

    expect(response.status).toBe(403);
    expect(response.body.type).toBe("/account/billing/forbidden");
  });

  it("activates Premium only after verifying an active matching PayPal subscription", async () => {
    getSubscription.mockResolvedValue(activeSubscription);

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/account/billing/subscriptions")
        .set("Authorization", ownerSessionHeader())
        .send({ provider: "paypal", subscriptionId: activeSubscription.id }),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      currentPlan: "premium",
      subscription: {
        provider: "paypal",
        status: "active",
        providerSubscriptionId: activeSubscription.id,
      },
    });
    expect(getUserOrThrow("owner-1")).toMatchObject({ dataRetentionPlan: "premium" });
    expect(state.billingAccounts.get("owner-1")).toMatchObject({
      providerSubscriptionId: activeSubscription.id,
      status: "active",
      amount: "99.99",
      currency: "EUR",
    });
  });

  it("cancels the PayPal subscription before starting the Standard grace period", async () => {
    seedLinkedBillingAccount();
    state.users.set("owner-1", {
      ...getUserOrThrow("owner-1"),
      dataRetentionPlan: "premium",
      dataRetentionPlanChangedAt: Date.parse("2026-08-01T00:00:00Z"),
    });
    getSubscription.mockResolvedValue(activeSubscription);
    cancelSubscription.mockResolvedValue(undefined);

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/account/billing/subscriptions/cancel")
        .set("Authorization", ownerSessionHeader())
        .send({}),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      currentPlan: "standard",
      subscription: {
        provider: "paypal",
        status: "cancelled",
        providerSubscriptionId: activeSubscription.id,
      },
    });
    expect(cancelSubscription).toHaveBeenCalledTimes(1);
    expect(getUserOrThrow("owner-1")).toMatchObject({
      dataRetentionPlan: "standard",
      dataRetentionStandardEligibleAt: expect.any(Number),
    });
  });

  it.each([
    [{ ...activeSubscription, plan_id: "P-OTHER" }, "plan"],
    [{ ...activeSubscription, custom_id: "another-owner" }, "customer"],
  ])("rejects a subscription with a mismatched %s reference", async (subscription) => {
    getSubscription.mockResolvedValue(subscription);

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/account/billing/subscriptions")
        .set("Authorization", ownerSessionHeader())
        .send({ provider: "paypal", subscriptionId: subscription.id }),
    );

    expect(response.status).toBe(409);
    expect(response.body.type).toBe("/account/billing/invalid-subscription");
    expect(state.billingAccounts.size).toBe(0);
  });
});

describe("PayPal webhook", () => {
  it("processes a linked cancellation without Firebase App Check", async () => {
    process.env["APP_CHECK_MODE"] = "required";
    verifyWebhookSignature.mockResolvedValue(true);
    seedLinkedBillingAccount();
    state.users.set("owner-1", {
      ...getUserOrThrow("owner-1"),
      dataRetentionPlan: "premium",
      dataRetentionPlanChangedAt: Date.parse("2026-08-01T00:00:00Z"),
    });
    const event = {
      id: "WH-CANCEL-1",
      event_type: "BILLING.SUBSCRIPTION.CANCELLED",
      resource: {
        ...activeSubscription,
        status: "CANCELLED",
      },
    };

    const firstResponse = await withRequestDefaults(
      request(app).post("/api/v1/webhooks/paypal").set(paypalWebhookHeaders).send(event),
    );
    const firstEligibleAt = getUserOrThrow("owner-1").dataRetentionStandardEligibleAt;
    const duplicateResponse = await withRequestDefaults(
      request(app).post("/api/v1/webhooks/paypal").set(paypalWebhookHeaders).send(event),
    );

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toEqual({ received: true, handled: true });
    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.body).toEqual({ received: true, handled: true });
    expect(getUserOrThrow("owner-1")).toMatchObject({
      dataRetentionPlan: "standard",
      dataRetentionStandardEligibleAt: firstEligibleAt,
    });
    expect(state.billingAccounts.get("owner-1")?.status).toBe("cancelled");
  });

  it("rejects an invalid PayPal signature", async () => {
    process.env["APP_CHECK_MODE"] = "required";
    verifyWebhookSignature.mockResolvedValue(false);

    const response = await withRequestDefaults(
      request(app)
        .post("/api/v1/webhooks/paypal")
        .set(paypalWebhookHeaders)
        .send({ id: "WH-INVALID", event_type: "CATALOG.PRODUCT.CREATED", resource: {} }),
    );

    expect(response.status).toBe(400);
    expect(response.body.type).toBe("/webhooks/paypal/invalid-request");
  });

  it("ignores a valid event for an unlinked subscription", async () => {
    verifyWebhookSignature.mockResolvedValue(true);

    const response = await withRequestDefaults(
      request(app).post("/api/v1/webhooks/paypal").set(paypalWebhookHeaders).send({
        id: "WH-ACTIVE-UNLINKED",
        event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
        resource: activeSubscription,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, handled: false });
    expect(getUserOrThrow("owner-1").dataRetentionPlan).not.toBe("premium");
  });
});
