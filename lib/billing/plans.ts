// =====================================================================
// PLANS: the price list (docs/monetization-plan.md, section 3). The
// /pricing page, the landing FAQ and the checkout read it from here; the
// billing migration seeds public.plans with the same numbers (a test keeps
// them in step). Credits are a fixed slice of real provider cost, so
// cheap models use little and large ones a lot.
// =====================================================================

export const PLAN_IDS = ["free", "plus", "pro", "max", "team"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type BillingInterval = "month" | "year";

export type Plan = {
  id: PlanId;
  name: string;
  // US dollars; per seat when `perSeat`
  monthlyUsd: number;
  // null: no yearly price
  yearlyUsd: number | null;
  perSeat: boolean;
  seatMinimum: number;
  // Per seat for Team (pooled across the team)
  weeklyCredits: number;
  // null: no separate 5-hour limit (Team draws from its pool)
  sessionCredits: number | null;
  // What the plan adds, in short words, for the pricing table
  features: string[];
};

export const PLANS: readonly Plan[] = [
  { id: "free", name: "Free", monthlyUsd: 0, yearlyUsd: null, perSeat: false, seatMinimum: 1, weeklyCredits: 300, sessionCredits: 100, features: ["1 space", "Small models only", "No background agents"] },
  { id: "plus", name: "Plus", monthlyUsd: 9, yearlyUsd: 90, perSeat: false, seatMinimum: 1, weeklyCredits: 2_500, sessionCredits: 800, features: [] },
  { id: "pro", name: "Pro", monthlyUsd: 24, yearlyUsd: 240, perSeat: false, seatMinimum: 1, weeklyCredits: 7_500, sessionCredits: 2_500, features: ["All models", "MCP", "Publishing and embeds", "Connectors"] },
  { id: "max", name: "Max", monthlyUsd: 79, yearlyUsd: null, perSeat: false, seatMinimum: 1, weeklyCredits: 25_000, sessionCredits: 8_000, features: ["Priority queue"] },
  { id: "team", name: "Team", monthlyUsd: 15, yearlyUsd: null, perSeat: true, seatMinimum: 3, weeklyCredits: 5_000, sessionCredits: null, features: ["Pooled credits", "3 seat minimum"] },
];

export const PLANS_BY_ID: Readonly<Record<PlanId, Plan>> = Object.fromEntries(PLANS.map((plan) => [plan.id, plan])) as Record<PlanId, Plan>;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

// One credit is this many US dollars of estimateCallCost
export const CREDIT_USD = 0.001;

// Credits for a dollar cost, to three decimals (null stays unknown)
export function creditsForCost(usd: number | null): number | null {
  if (usd === null || !Number.isFinite(usd) || usd < 0) return null;
  return Math.round((usd / CREDIT_USD) * 1000) / 1000;
}

// "$9", "$15"
export function formatPrice(usd: number): string {
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// "2,500"
export function formatCredits(credits: number): string {
  return credits.toLocaleString("en-US");
}

// The landing FAQ's "How much does it cost?" answer, written from the price list
export function pricingFaqAnswer(): string {
  const free = PLANS_BY_ID.free;
  const paid = PLANS.filter((plan) => plan.monthlyUsd > 0 && !plan.perSeat).map((plan) => `${plan.name} ${formatPrice(plan.monthlyUsd)}`);
  const team = PLANS.find((plan) => plan.perSeat);
  const yearly = PLANS.filter((plan) => plan.yearlyUsd !== null).map((plan) => plan.name);
  return [
    `Free costs nothing and needs no card: ${formatCredits(free.weeklyCredits)} credits a week.`,
    `Paid plans are ${paid.join(", ")} a month${team ? `, and ${team.name} is ${formatPrice(team.monthlyUsd)} per seat (${team.seatMinimum} seats minimum)` : ""}.`,
    yearly.length ? `${yearly.join(" and ")} cost two months less when paid yearly.` : "",
    "Every plan has a weekly limit and a 5-hour limit, measured in credits.",
  ].filter(Boolean).join(" ");
}

// The plans a person can buy with Checkout (Free needs no card)
export function isPaidPlan(id: PlanId): boolean {
  return PLANS_BY_ID[id].monthlyUsd > 0;
}
