import { afterEach, describe, expect, it, vi } from "vitest";
import { paypalClient } from "../../src/business/billing/paypal-client.js";

const configuration = {
  mode: "sandbox" as const,
  clientId: "client-id",
  clientSecret: "client-secret",
  webhookId: "webhook-id",
  planId: "P-PREMIUM",
  apiBaseUrl: "https://api-m.sandbox.paypal.com",
  returnUrl: "http://localhost:5173/account/upgrade?payment=paypal&status=approved",
  cancelUrl: "http://localhost:5173/account/upgrade?payment=paypal&status=cancelled",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PayPal client", () => {
  it("accepts PayPal create responses without plan_id or custom_id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "I-SUBSCRIPTION",
            status: "APPROVAL_PENDING",
            create_time: "2026-08-01T00:00:00Z",
            links: [{ href: "https://www.sandbox.paypal.com/checkout", rel: "approve" }],
          }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const subscription = await paypalClient.createSubscription("owner-1", configuration);

    expect(subscription).toMatchObject({
      id: "I-SUBSCRIPTION",
      status: "APPROVAL_PENDING",
      plan_id: "P-PREMIUM",
      custom_id: "owner-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
