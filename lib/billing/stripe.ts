import { createHmac, timingSafeEqual } from "node:crypto";
import { type BillingInterval, type PlanId, isPlanId } from "./plans";

// =====================================================================
// STRIPE: the few REST calls billing needs (Checkout, the customer portal)
// and webhook signature checks, without the stripe package. Keys come from
// the env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and one STRIPE_PRICE_*
// per plan and interval. `fetch` is passed in so tests never reach Stripe.
// =====================================================================

const STRIPE_API = "https://api.stripe.com/v1";

// A signature older than this is refused (Stripe's own default)
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeEnv = Partial<Record<string, string | undefined>>;

// THE PRICE IDS: one env var per plan and interval
export const PRICE_ENV: Readonly<Partial<Record<PlanId, Partial<Record<BillingInterval, string>>>>> = {
  plus: { month: "STRIPE_PRICE_PLUS_MONTHLY", year: "STRIPE_PRICE_PLUS_YEARLY" },
  pro: { month: "STRIPE_PRICE_PRO_MONTHLY", year: "STRIPE_PRICE_PRO_YEARLY" },
  max: { month: "STRIPE_PRICE_MAX_MONTHLY" },
  team: { month: "STRIPE_PRICE_TEAM_MONTHLY" },
};

// The Stripe price for a plan and interval, or null when that env var is unset
export function priceIdFor(env: StripeEnv, plan: PlanId, interval: BillingInterval): string | null {
  const name = PRICE_ENV[plan]?.[interval];
  return (name && env[name]) || null;
}

// The plan a Stripe price belongs to (null: not one of ours)
export function planForPrice(env: StripeEnv, priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const [plan, intervals] of Object.entries(PRICE_ENV)) {
    for (const name of Object.values(intervals ?? {})) {
      if (name && env[name] === priceId && isPlanId(plan)) return plan;
    }
  }
  return null;
}

export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeSignatureError";
  }
}

// CHECKS A WEBHOOK: the Stripe-Signature header must hold a v1 HMAC-SHA256 of
// "<t>.<raw body>" made with the endpoint secret, signed within the tolerance.
// Returns the parsed event; throws StripeSignatureError otherwise.
export function verifyWebhook<T = unknown>(rawBody: string, header: string | null, secret: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): T {
  if (!secret) throw new StripeSignatureError("STRIPE_WEBHOOK_SECRET is not set.");
  if (!header) throw new StripeSignatureError("Missing Stripe-Signature header.");
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const item of header.split(",")) {
    const [key, value] = item.split("=", 2).map((part) => part.trim());
    if (key === "t" && value && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (timestamp === null || !signatures.length) throw new StripeSignatureError("Malformed Stripe-Signature header.");
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) throw new StripeSignatureError("Stripe signature is too old.");
  const expected = Buffer.from(signPayload(rawBody, timestamp, secret), "hex");
  const matches = signatures.some((signature) => {
    const given = Buffer.from(signature, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matches) throw new StripeSignatureError("Stripe signature does not match.");
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new StripeSignatureError("Webhook body is not JSON.");
  }
}

// The hex v1 signature Stripe sends for a body (tests sign their fixtures with it)
export function signPayload(rawBody: string, timestamp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

// Nested params in Stripe's form encoding: {a: {b: 1}} -> "a[b]=1"
export function formEncode(params: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const itemName = `${name}[${index}]`;
        parts.push(item && typeof item === "object" ? formEncode(item as Record<string, unknown>, itemName) : `${encodeURIComponent(itemName)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === "object") {
      parts.push(formEncode(value as Record<string, unknown>, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

export type StripeClient = {
  post<T>(path: string, params: Record<string, unknown>): Promise<T>;
};

// A Stripe REST client for the secret key
export function stripeClient(secretKey: string | undefined, fetchImpl: typeof fetch = fetch): StripeClient {
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set.");
  return {
    async post<T>(path: string, params: Record<string, unknown>): Promise<T> {
      const response = await fetchImpl(`${STRIPE_API}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: formEncode(params),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } } & T;
      if (!response.ok) throw new Error(`Stripe: ${body.error?.message ?? `HTTP ${response.status}`}`);
      return body;
    },
  };
}

export type CheckoutRequest = {
  userId: string;
  email: string | null;
  customerId: string | null;
  plan: PlanId;
  priceId: string;
  seats: number;
  successUrl: string;
  cancelUrl: string;
};

// A Checkout session for a subscription; the webhook links it back by the user id in its metadata
export async function createCheckoutSession(stripe: StripeClient, request: CheckoutRequest): Promise<{ id: string; url: string }> {
  const metadata = { user_id: request.userId, plan_id: request.plan };
  return stripe.post<{ id: string; url: string }>("/checkout/sessions", {
    mode: "subscription",
    line_items: [{ price: request.priceId, quantity: request.seats }],
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
    client_reference_id: request.userId,
    ...(request.customerId ? { customer: request.customerId } : request.email ? { customer_email: request.email } : {}),
    metadata,
    subscription_data: { metadata },
    allow_promotion_codes: true,
  });
}

// A customer portal session (change plan, card, cancel)
export async function createPortalSession(stripe: StripeClient, customerId: string, returnUrl: string): Promise<{ id: string; url: string }> {
  return stripe.post<{ id: string; url: string }>("/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
}
