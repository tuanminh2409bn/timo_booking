import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { verifyAuthorizationHeader } from "../../modules/verify-auth-header.js";
import { firestoreAuth } from "../../repository/firestore/index.js";

export const createStripeCheckout = async (request: Request, response: Response) => {
  const authContext = await verifyAuthorizationHeader(request.headers["authorization"]);
  if (authContext.role !== "owner") {
    return response.status(403).json({ message: "Only owners may manage billing" });
  }
  const secretKey = process.env["STRIPE_SECRET_KEY"];
  const priceId = process.env["STRIPE_SUBSCRIPTION_PRICE_ID"];
  const webUrl = process.env["PUBLIC_WEB_URL"] ?? "http://localhost:3000";
  if (!secretKey || !priceId) {
    return response.status(503).json({
      type: "/billing/not-configured",
      message: "Card payment provider is not configured",
    });
  }

  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: authContext.ownerId,
    "metadata[ownerId]": authContext.ownerId,
    "metadata[ownerUserId]": authContext.uid,
    "subscription_data[metadata][ownerId]": authContext.ownerId,
    "subscription_data[metadata][ownerUserId]": authContext.uid,
    success_url: `${webUrl}/admin/dashboard/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${webUrl}/admin/dashboard/billing?status=cancelled`,
  });
  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const result: unknown = await stripeResponse.json();
  const data = typeof result === "object" && result !== null
    ? result as Record<string, unknown>
    : {};
  const error = typeof data["error"] === "object" && data["error"] !== null
    ? data["error"] as Record<string, unknown>
    : undefined;
  if (!stripeResponse.ok || typeof data["url"] !== "string") {
    return response.status(502).json({
      type: "/billing/provider-error",
      message: typeof error?.["message"] === "string" ? error["message"] : "Could not create card checkout",
    });
  }
  return response.status(201).json({ url: data["url"] });
};

const validSignature = (body: Buffer, signatureHeader: string, secret: string): boolean => {
  const values = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key ?? "", value ?? ""];
    }),
  );
  const timestamp = values["t"];
  const signature = values["v1"];
  if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body.toString("utf8")}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const stripeWebhook = async (request: Request, response: Response) => {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  const signature = request.headers["stripe-signature"];
  const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from("");
  if (!secret || typeof signature !== "string" || !validSignature(body, signature, secret)) {
    return response.status(400).json({ message: "Invalid Stripe signature" });
  }

  const parsed: unknown = JSON.parse(body.toString("utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    return response.status(400).json({ message: "Invalid Stripe event" });
  }
  const event = parsed as Record<string, unknown>;
  const eventData = typeof event["data"] === "object" && event["data"] !== null
    ? event["data"] as Record<string, unknown>
    : {};
  const object = typeof eventData["object"] === "object" && eventData["object"] !== null
    ? eventData["object"] as Record<string, unknown>
    : {};
  const metadata = typeof object["metadata"] === "object" && object["metadata"] !== null
    ? object["metadata"] as Record<string, unknown>
    : {};
  const ownerId =
    typeof object["client_reference_id"] === "string"
      ? object["client_reference_id"]
      : typeof metadata["ownerId"] === "string"
        ? metadata["ownerId"]
        : undefined;
  const ownerUserId = typeof metadata["ownerUserId"] === "string" ? metadata["ownerUserId"] : ownerId;
  const eventType = typeof event["type"] === "string" ? event["type"] : "";
  const eventId = typeof event["id"] === "string" ? event["id"] : "";

  if (ownerId && ownerUserId && eventType === "checkout.session.completed") {
    await firestoreAuth.collection("billing_subscriptions").doc(ownerUserId).set({
      ownerId,
      ownerUserId,
      provider: "stripe",
      status: "active",
      stripeCustomerId: object["customer"],
      stripeSubscriptionId: object["subscription"],
      lastEventId: eventId,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    }, { merge: true });
  }
  if (ownerUserId && eventType === "customer.subscription.deleted") {
    await firestoreAuth.collection("billing_subscriptions").doc(ownerUserId).set({
      status: "cancelled",
      lastEventId: eventId,
      updatedAt: Date.now(),
    }, { merge: true });
  }
  return response.status(200).json({ received: true });
};
