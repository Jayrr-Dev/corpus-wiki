import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { SiteNav } from "@/components/landing/site-nav";
import { PlanButton } from "@/components/landing/plan-button";
import { requireFeature } from "@/lib/flags/server";
import { formatCredits, formatPrice, type Plan, PLANS } from "@/lib/billing/plans";

// =====================================================================
// PRICING (/pricing): the plan table from lib/billing/plans.ts.
// A 404 while the billing flag is off. Rebuilt every minute, so turning
// the flag on or off shows here within a minute.
// =====================================================================

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Pricing | Corpus Wiki",
  description: "Plans for Corpus Wiki, from Free to Team, with weekly AI credits.",
};

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-landing-gold focus-visible:ring-offset-2 focus-visible:ring-offset-landing-base";

function PlanPrice({ plan }: { plan: Plan }) {
  return (
    <div className="mt-4">
      <p className="flex items-baseline gap-1">
        <span className="text-4xl font-semibold tracking-tight">{formatPrice(plan.monthlyUsd)}</span>
        <span className="text-sm text-landing-ink/50">{plan.perSeat ? "per seat / month" : "/ month"}</span>
      </p>
      <p className="mt-1 h-5 text-sm text-landing-ink/50">{plan.yearlyUsd !== null ? `or ${formatPrice(plan.yearlyUsd)} / year` : ""}</p>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const featured = plan.id === "pro";
  const credits = [
    `${formatCredits(plan.weeklyCredits)} credits a week${plan.perSeat ? " per seat" : ""}`,
    plan.sessionCredits !== null ? `${formatCredits(plan.sessionCredits)} per 5-hour session` : null,
  ].filter((line): line is string => line !== null);
  return (
    <div className={`flex h-full flex-col rounded-2xl border p-6 ${featured ? "border-landing-gold/60 bg-landing-ink/[0.05]" : "border-landing-ink/10 bg-landing-ink/[0.03]"}`}>
      <h2 className="text-lg font-semibold">{plan.name}</h2>
      <PlanPrice plan={plan} />
      <ul className="mt-6 flex flex-1 flex-col gap-2 text-sm text-landing-ink/70">
        {[...credits, ...plan.features].map((line) => (
          <li key={line} className="flex gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-landing-gold" />
            {line}
          </li>
        ))}
      </ul>
      <div className="mt-6">
        {plan.monthlyUsd === 0 ? (
          <Link href="/signup" className={`block w-full rounded-xl border border-landing-ink/15 px-3 py-2 text-center text-base font-semibold transition duration-300 hover:bg-landing-ink/[0.06] ${FOCUS}`}>
            Start free
          </Link>
        ) : (
          <PlanButton plan={plan.id} interval="month" label={`Choose ${plan.name}`} primary={featured} />
        )}
      </div>
    </div>
  );
}

export default async function PricingPage() {
  await requireFeature("billing");
  return (
    <>
      <SiteNav />
      <main id="main" className="px-4 pt-32 pb-24 sm:px-6">
        <div className="mx-auto max-w-[680px] text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Pricing</h1>
          <p className="mt-4 text-lg text-landing-ink/60 text-pretty">Start free. No card needed.</p>
        </div>
        <div className="mx-auto mt-12 grid max-w-7xl gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PLANS.map((plan) => <PlanCard key={plan.id} plan={plan} />)}
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-landing-ink/50 text-pretty">
          Credits measure AI use: one credit is a tenth of a cent of model cost, so small models use fewer. Limits reset every 5 hours and every week.
        </p>
      </main>
    </>
  );
}
