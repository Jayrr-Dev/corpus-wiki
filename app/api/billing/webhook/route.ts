import { handleStripeWebhook } from "@/lib/billing/webhook";
import { supabaseRpc } from "@/lib/db/rpc";
import { isFeatureEnabled } from "@/lib/flags/server";
import { getAdminSupabase } from "@/lib/supabase/admin";

// STRIPE WEBHOOK (POST /api/billing/webhook): a 404 while the billing flag is off.
// The raw body is checked against Stripe-Signature before anything is read from it.
export async function POST(request: Request) {
  if (!(await isFeatureEnabled("billing"))) return new Response("Not found", { status: 404 });
  const rawBody = await request.text();
  try {
    const outcome = await handleStripeWebhook(supabaseRpc(getAdminSupabase()), process.env, rawBody, request.headers.get("stripe-signature"));
    return new Response(outcome.body, { status: outcome.status });
  } catch (error) {
    // A 500 makes Stripe retry later
    console.error("Stripe webhook failed:", error);
    return new Response("Webhook failed", { status: 500 });
  }
}
