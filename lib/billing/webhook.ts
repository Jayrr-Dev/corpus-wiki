import type { DbRpc } from "@/lib/db/rpc";
import { type StripeEnv, StripeSignatureError, planForPrice, verifyWebhook } from "./stripe";
import { isPlanId, type PlanId } from "./plans";

// =====================================================================
// STRIPE WEBHOOK: keeps public.subscriptions in step with Stripe.
// Only a correctly signed event is read. Both writes are idempotent: a
// retry from Stripe saves the same row again, and sync_subscription ignores
// an event older than the one already applied (Stripe may send them out of order).
// =====================================================================

type StripeEvent = { id: string; type: string; created: number; data: { object: Record<string, unknown> } };

type SubscriptionItem = { price?: { id?: string }; quantity?: number; current_period_start?: number; current_period_end?: number };

type StripeSubscription = {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end?: boolean;
  current_period_start?: number;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: SubscriptionItem[] };
};

// What sync_subscription saves
export type SubscriptionSync = {
  userId: string | null;
  customerId: string;
  subscriptionId: string;
  planId: PlanId;
  status: string;
  seats: number;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  eventAt: string;
};

export type WebhookOutcome = { status: number; body: string };

const SUBSCRIPTION_EVENTS = new Set(["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]);

const iso = (seconds: number | undefined) => (typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null);

// The row to save for a subscription event (null: not one of our prices or plans)
export function subscriptionSync(env: StripeEnv, event: StripeEvent): SubscriptionSync | null {
  const subscription = event.data.object as unknown as StripeSubscription;
  const item = subscription.items?.data?.[0];
  const planFromPrice = planForPrice(env, item?.price?.id);
  const planFromMetadata = isPlanId(subscription.metadata?.plan_id) ? subscription.metadata.plan_id : null;
  const deleted = event.type === "customer.subscription.deleted";
  const planId = deleted ? "free" : planFromPrice ?? planFromMetadata;
  if (!planId) return null;
  return {
    userId: subscription.metadata?.user_id ?? null,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    subscriptionId: subscription.id,
    planId,
    status: deleted ? "canceled" : subscription.status,
    seats: Math.max(1, item?.quantity ?? 1),
    // Newer API versions keep the period on the item
    periodStart: iso(item?.current_period_start ?? subscription.current_period_start),
    periodEnd: iso(item?.current_period_end ?? subscription.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    eventAt: new Date(event.created * 1000).toISOString(),
  };
}

// Verifies and applies one webhook request
export async function handleStripeWebhook(db: DbRpc, env: StripeEnv, rawBody: string, signature: string | null): Promise<WebhookOutcome> {
  let event: StripeEvent;
  try {
    event = verifyWebhook<StripeEvent>(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    if (error instanceof StripeSignatureError) return { status: 400, body: error.message };
    throw error;
  }
  if (!event?.id || !event.type || !event.data?.object) return { status: 400, body: "Not a Stripe event." };

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as { client_reference_id?: string | null; customer?: string | null; metadata?: Record<string, string> };
    const userId = session.metadata?.user_id ?? session.client_reference_id ?? null;
    if (userId && session.customer) await db.call("link_stripe_customer", { p_user: userId, p_customer: session.customer });
    return { status: 200, body: "Linked." };
  }
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const sync = subscriptionSync(env, event);
    if (!sync) return { status: 200, body: "Not one of our plans." };
    await db.call("sync_subscription", { p_subscription: sync });
    return { status: 200, body: "Synced." };
  }
  return { status: 200, body: "Ignored." };
}
