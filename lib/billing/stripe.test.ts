import { describe, expect, it, vi } from "vitest";
import { createCheckoutSession, createPortalSession, formEncode, planForPrice, priceIdFor, signPayload, StripeSignatureError, stripeClient, verifyWebhook } from "./stripe";

// =====================================================================
// STRIPE WITHOUT STRIPE: signatures are made locally with a test secret
// and every REST call goes to a mock fetch, so nothing is ever charged.
// =====================================================================

const SECRET = "whsec_test_only";
const NOW = 1_800_000_000;
const body = JSON.stringify({ id: "evt_1", type: "ping", created: NOW, data: { object: {} } });
const header = (payload = body, t = NOW, secret = SECRET) => `t=${t},v1=${signPayload(payload, t, secret)}`;

describe("verifyWebhook", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyWebhook(body, header(), SECRET, NOW)).toMatchObject({ id: "evt_1" });
  });

  it("accepts when any one of several v1 signatures matches (secret rotation)", () => {
    expect(verifyWebhook(body, `t=${NOW},v1=${"0".repeat(64)},v1=${signPayload(body, NOW, SECRET)}`, SECRET, NOW)).toMatchObject({ id: "evt_1" });
  });

  it("rejects an unsigned request", () => {
    expect(() => verifyWebhook(body, null, SECRET, NOW)).toThrow(StripeSignatureError);
    expect(() => verifyWebhook(body, "", SECRET, NOW)).toThrow(StripeSignatureError);
  });

  it("rejects a signature made with another secret", () => {
    expect(() => verifyWebhook(body, header(body, NOW, "whsec_other"), SECRET, NOW)).toThrow(/does not match/);
  });

  it("rejects a body changed after signing", () => {
    expect(() => verifyWebhook(body.replace("ping", "pong"), header(), SECRET, NOW)).toThrow(/does not match/);
  });

  it("rejects an old signature (replay)", () => {
    expect(() => verifyWebhook(body, header(body, NOW - 301), SECRET, NOW)).toThrow(/too old/);
  });

  it("rejects malformed headers and a missing secret", () => {
    expect(() => verifyWebhook(body, "v1=abc", SECRET, NOW)).toThrow(/Malformed/);
    expect(() => verifyWebhook(body, `t=${NOW}`, SECRET, NOW)).toThrow(/Malformed/);
    expect(() => verifyWebhook(body, `t=${NOW},v1=zz`, SECRET, NOW)).toThrow(/does not match/);
    expect(() => verifyWebhook(body, header(), undefined, NOW)).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});

describe("prices", () => {
  const env = { STRIPE_PRICE_PRO_MONTHLY: "price_pro_m", STRIPE_PRICE_PRO_YEARLY: "price_pro_y", STRIPE_PRICE_TEAM_MONTHLY: "price_team" };
  it("finds the price for a plan and interval", () => {
    expect(priceIdFor(env, "pro", "year")).toBe("price_pro_y");
    expect(priceIdFor(env, "max", "month")).toBeNull();
    expect(priceIdFor(env, "max", "year")).toBeNull();
  });
  it("maps a price back to its plan", () => {
    expect(planForPrice(env, "price_team")).toBe("team");
    expect(planForPrice(env, "price_unknown")).toBeNull();
    expect(planForPrice(env, undefined)).toBeNull();
  });
});

describe("REST calls", () => {
  it("form-encodes nested params the way Stripe reads them", () => {
    expect(formEncode({ mode: "subscription", line_items: [{ price: "p", quantity: 3 }], metadata: { user_id: "u" }, skip: undefined }))
      .toBe("mode=subscription&line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=3&metadata%5Buser_id%5D=u");
  });

  it("needs a secret key", () => {
    expect(() => stripeClient(undefined)).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("creates a Checkout session with the person in its metadata", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })));
    const session = await createCheckoutSession(stripeClient("sk_test_x", fetchMock as unknown as typeof fetch), {
      userId: "user-1", email: "a@example.com", customerId: null, plan: "team", priceId: "price_team", seats: 3,
      successUrl: "https://app.test/settings", cancelUrl: "https://app.test/pricing",
    });
    expect(session.url).toBe("https://checkout.stripe.test/cs_1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer sk_test_x" });
    const params = new URLSearchParams(String(init.body));
    expect(params.get("mode")).toBe("subscription");
    expect(params.get("line_items[0][quantity]")).toBe("3");
    expect(params.get("client_reference_id")).toBe("user-1");
    expect(params.get("customer_email")).toBe("a@example.com");
    expect(params.get("subscription_data[metadata][user_id]")).toBe("user-1");
    expect(params.get("subscription_data[metadata][plan_id]")).toBe("team");
  });

  it("opens the portal for a known customer and surfaces Stripe's error", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ id: "bps_1", url: "https://billing.stripe.test/p" })));
    await expect(createPortalSession(stripeClient("sk_test_x", ok as unknown as typeof fetch), "cus_1", "https://app.test/settings")).resolves.toMatchObject({ url: "https://billing.stripe.test/p" });
    const failing = vi.fn(async () => new Response(JSON.stringify({ error: { message: "No such customer" } }), { status: 400 }));
    await expect(createPortalSession(stripeClient("sk_test_x", failing as unknown as typeof fetch), "cus_x", "https://app.test")).rejects.toThrow("Stripe: No such customer");
  });
});
