import { describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { signPayload } from "./stripe";
import { handleStripeWebhook } from "./webhook";

// =====================================================================
// THE WEBHOOK: unsigned or wrongly signed requests are refused before the
// database is touched; signed subscription events are synced.
// =====================================================================

const env = { STRIPE_WEBHOOK_SECRET: "whsec_test_only", STRIPE_PRICE_PRO_MONTHLY: "price_pro_m", STRIPE_PRICE_TEAM_MONTHLY: "price_team" };
const now = () => Math.floor(Date.now() / 1000);

function signed(event: object) {
  const raw = JSON.stringify(event);
  const t = now();
  return { raw, signature: `t=${t},v1=${signPayload(raw, t, env.STRIPE_WEBHOOK_SECRET)}` };
}

const subscriptionEvent = (type: string, object: object) => ({ id: "evt_1", type, created: 1_800_000_000, data: { object } });

const proSubscription = {
  id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false, metadata: { user_id: "user-1", plan_id: "pro" },
  items: { data: [{ price: { id: "price_pro_m" }, quantity: 1, current_period_start: 1_800_000_000, current_period_end: 1_802_592_000 }] },
};

function mockDb() {
  const call = vi.fn(async () => undefined);
  return { call, db: { call } as unknown as DbRpc };
}

describe("handleStripeWebhook", () => {
  it("rejects an unsigned request without touching the database", async () => {
    const { call, db } = mockDb();
    const outcome = await handleStripeWebhook(db, env, JSON.stringify(subscriptionEvent("customer.subscription.updated", proSubscription)), null);
    expect(outcome.status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });

  it("rejects a forged signature", async () => {
    const { call, db } = mockDb();
    const { raw } = signed(subscriptionEvent("customer.subscription.updated", proSubscription));
    const outcome = await handleStripeWebhook(db, env, raw, `t=${now()},v1=${"ab".repeat(32)}`);
    expect(outcome.status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });

  it("rejects everything when no webhook secret is set", async () => {
    const { call, db } = mockDb();
    const { raw, signature } = signed(subscriptionEvent("customer.subscription.updated", proSubscription));
    const outcome = await handleStripeWebhook(db, { ...env, STRIPE_WEBHOOK_SECRET: undefined }, raw, signature);
    expect(outcome.status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });

  it("syncs a signed subscription update", async () => {
    const { call, db } = mockDb();
    const { raw, signature } = signed(subscriptionEvent("customer.subscription.updated", proSubscription));
    expect(await handleStripeWebhook(db, env, raw, signature)).toEqual({ status: 200, body: "Synced." });
    expect(call).toHaveBeenCalledWith("sync_subscription", {
      p_subscription: {
        userId: "user-1", customerId: "cus_1", subscriptionId: "sub_1", planId: "pro", status: "active", seats: 1,
        periodStart: new Date(1_800_000_000_000).toISOString(), periodEnd: new Date(1_802_592_000_000).toISOString(),
        cancelAtPeriodEnd: false, eventAt: new Date(1_800_000_000_000).toISOString(),
      },
    });
  });

  it("moves a deleted subscription back to Free", async () => {
    const { call, db } = mockDb();
    const { raw, signature } = signed(subscriptionEvent("customer.subscription.deleted", { ...proSubscription, status: "canceled" }));
    await handleStripeWebhook(db, env, raw, signature);
    expect(call).toHaveBeenCalledWith("sync_subscription", { p_subscription: expect.objectContaining({ planId: "free", status: "canceled" }) });
  });

  it("counts Team seats", async () => {
    const { call, db } = mockDb();
    const team = { ...proSubscription, metadata: { user_id: "user-1" }, items: { data: [{ price: { id: "price_team" }, quantity: 5 }] } };
    const { raw, signature } = signed(subscriptionEvent("customer.subscription.created", team));
    await handleStripeWebhook(db, env, raw, signature);
    expect(call).toHaveBeenCalledWith("sync_subscription", { p_subscription: expect.objectContaining({ planId: "team", seats: 5 }) });
  });

  it("ignores a price that is not one of ours", async () => {
    const { call, db } = mockDb();
    const other = { ...proSubscription, metadata: {}, items: { data: [{ price: { id: "price_elsewhere" } }] } };
    const { raw, signature } = signed(subscriptionEvent("customer.subscription.updated", other));
    expect(await handleStripeWebhook(db, env, raw, signature)).toEqual({ status: 200, body: "Not one of our plans." });
    expect(call).not.toHaveBeenCalled();
  });

  it("links the Stripe customer when Checkout completes", async () => {
    const { call, db } = mockDb();
    const { raw, signature } = signed(subscriptionEvent("checkout.session.completed", { client_reference_id: "user-1", customer: "cus_1", metadata: { user_id: "user-1" } }));
    await handleStripeWebhook(db, env, raw, signature);
    expect(call).toHaveBeenCalledWith("link_stripe_customer", { p_user: "user-1", p_customer: "cus_1" });
  });

  it("answers other events without writing", async () => {
    const { call, db } = mockDb();
    const { raw, signature } = signed(subscriptionEvent("invoice.paid", {}));
    expect(await handleStripeWebhook(db, env, raw, signature)).toEqual({ status: 200, body: "Ignored." });
    expect(call).not.toHaveBeenCalled();
  });
});
