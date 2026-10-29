import "server-only";

import type { DbRpc } from "@/lib/db/rpc";

// =====================================================================
// REVIEWER BUDGET (issue #42): one 461-page book wrote 648 sections and
// made most of a month's Reviewer calls. Before an upload writes its
// pages, it estimates the Reviewer calls the build needs. Over the
// budget it logs the numbers and asks a person on Exceptions (reason
// reviewer_budget, supabase/migrations/20261124042000_reviewer_budget.sql);
// the upload waits until they answer. Accept writes the pages; decline
// stops the upload with the reason, and its knowledge stays saved.
// =====================================================================

// Reviewer calls one section build costs: editorial selection, one fact-check
// and one editorial review (3 when clean, measured in writers/reviewerCalls.test.ts),
// plus an allowance for repairs and the page review
export const REVIEWER_CALLS_PER_SECTION = 4;

// About 200 sections; a normal upload writes a few to a few dozen
export const DEFAULT_REVIEWER_CALL_BUDGET = 800;

// REVIEWER_CALL_BUDGET overrides the budget; a missing or invalid value uses the default
export type BudgetEnv = Readonly<Record<string, string | undefined>>;
export function reviewerCallBudget(env: BudgetEnv = process.env): number {
  const value = Number(env.REVIEWER_CALL_BUDGET);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_REVIEWER_CALL_BUDGET;
}

export class ReviewerBudgetDeclined extends Error {
  constructor(sections: number, estimate: number, budget: number) {
    super(`Writing pages was declined: about ${estimate} Reviewer calls for ${sections} sections is over the budget of ${budget}.`);
  }
}

export type BudgetLease = { eventId: string; token: string };

// True when the upload must wait for the answer. Under the budget, or once a
// person accepted, the build goes on; a declined build throws ReviewerBudgetDeclined.
export async function checkReviewerBudget(db: DbRpc, lease: BudgetLease, sections: number, env: BudgetEnv = process.env): Promise<boolean> {
  const estimate = sections * REVIEWER_CALLS_PER_SECTION;
  const budget = reviewerCallBudget(env);
  if (estimate <= budget) return false;
  console.warn("Upload reviewer budget exceeded", { eventId: lease.eventId, sections, estimate, budget });
  const answer = await db.call<"approved" | "declined" | "waiting">("hold_upload_for_reviewer_budget", {
    p_event_id: lease.eventId, p_token: lease.token, p_sections: sections, p_estimate: estimate, p_budget: budget,
  });
  if (answer === "declined") throw new ReviewerBudgetDeclined(sections, estimate, budget);
  if (answer === "approved") console.info("Upload reviewer budget approved", { eventId: lease.eventId, sections, estimate, budget });
  return answer === "waiting";
}
