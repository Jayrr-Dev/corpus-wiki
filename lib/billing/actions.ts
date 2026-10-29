"use server";

import { headers } from "next/headers";
import { currentAgentSession } from "@/lib/agents/session";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { requireFeature } from "@/lib/flags/server";
import { type ActionResult, toActionResult } from "@/lib/server-actions/result";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { type BillingInterval, isPaidPlan, isPlanId, PLANS_BY_ID, type PlanId } from "./plans";
import { createCheckoutSession, createPortalSession, priceIdFor, stripeClient } from "./stripe";

// =====================================================================
// BILLING ACTIONS: start a Stripe Checkout for a plan, or open the
// customer portal. Both are a 404 while the billing flag is off, and
// neither charges anything itself: Stripe's pages do, and the webhook
// (app/api/billing/webhook) saves the result.
// =====================================================================

type BillingAccount = { planId: PlanId; status: string; customerId: string | null };

// Where Stripe sends the person back: this site's own origin
async function siteOrigin(): Promise<string> {
  const origin = (await headers()).get("origin");
  if (!origin || !/^https?:\/\/[^/]+$/.test(origin)) throw new Error("Open billing from the app.");
  return origin;
}

async function signedInPerson() {
  await requireFeature("billing");
  const person = await requireUser();
  if (currentAgentSession()) throw new Error("Agents cannot change billing.");
  return person;
}

// CHECKOUT: a Stripe Checkout page for a paid plan; returns its URL
export async function startCheckout(plan: PlanId, interval: BillingInterval = "month", seats?: number): Promise<ActionResult<{ url: string }>> {
  return toActionResult(async () => {
    const person = await signedInPerson();
    if (!isPlanId(plan) || !isPaidPlan(plan)) throw new Error("Choose a paid plan.");
    if (interval !== "month" && interval !== "year") throw new Error("Choose monthly or yearly.");
    const priceId = priceIdFor(process.env, plan, interval);
    if (!priceId) throw new Error(`${PLANS_BY_ID[plan].name} is not for sale ${interval === "year" ? "yearly" : "monthly"} yet.`);
    const minimum = PLANS_BY_ID[plan].seatMinimum;
    const quantity = PLANS_BY_ID[plan].perSeat ? Math.max(minimum, Math.floor(Number(seats) || minimum)) : 1;
    const db = supabaseRpc(getAdminSupabase());
    const account = await db.call<BillingAccount>("get_billing_account", { p_user: person.id });
    const origin = await siteOrigin();
    const session = await createCheckoutSession(stripeClient(process.env.STRIPE_SECRET_KEY), {
      userId: person.id,
      email: person.email,
      customerId: account.customerId,
      plan,
      priceId,
      seats: quantity,
      successUrl: `${origin}/settings?billing=done`,
      cancelUrl: `${origin}/pricing`,
    });
    return { url: session.url };
  });
}

// PORTAL: Stripe's page to change plan, card or cancel; returns its URL
export async function openBillingPortal(): Promise<ActionResult<{ url: string }>> {
  return toActionResult(async () => {
    const person = await signedInPerson();
    const account = await supabaseRpc(getAdminSupabase()).call<BillingAccount>("get_billing_account", { p_user: person.id });
    if (!account.customerId) throw new Error("No paid plan yet.");
    const origin = await siteOrigin();
    const session = await createPortalSession(stripeClient(process.env.STRIPE_SECRET_KEY), account.customerId, `${origin}/settings`);
    return { url: session.url };
  });
}
