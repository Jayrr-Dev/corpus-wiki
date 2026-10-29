"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startCheckout } from "@/lib/billing/actions";
import type { BillingInterval, PlanId } from "@/lib/billing/plans";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-gold focus-visible:ring-offset-2 focus-visible:ring-offset-landing-base";

// PLAN BUTTON (/pricing): opens Stripe Checkout for a paid plan; a signed-out visitor signs up first
export function PlanButton({ plan, interval, label, primary }: { plan: PlanId; interval: BillingInterval; label: string; primary?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const choose = () => start(async () => {
    setError(null);
    const result = await startCheckout(plan, interval).catch(() => null);
    if (result?.ok) {
      window.location.assign(result.url);
      return;
    }
    if (!result || result.error === "Not signed in.") {
      router.push(`/signup?next=${encodeURIComponent("/pricing")}`);
      return;
    }
    setError(result.error);
  });

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={choose}
        disabled={pending}
        className={`w-full rounded-xl px-3 py-2 text-base font-semibold transition duration-300 active:scale-[0.98] disabled:opacity-60 ${primary ? "bg-landing-green text-white hover:bg-landing-green-hover" : "border border-landing-ink/15 text-landing-ink hover:bg-landing-ink/[0.06]"} ${FOCUS}`}
      >
        {pending ? "Opening…" : label}
      </button>
      {error && <p role="alert" className="text-sm text-landing-conflict">{error}</p>}
    </div>
  );
}
