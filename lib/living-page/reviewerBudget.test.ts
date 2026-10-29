import type { DbRpc } from "@/lib/db/rpc";
import { describe, expect, it, vi } from "vitest";
import { checkReviewerBudget, DEFAULT_REVIEWER_CALL_BUDGET, REVIEWER_CALLS_PER_SECTION, ReviewerBudgetDeclined, reviewerCallBudget } from "./reviewerBudget";

// A database that answers the hold with `answer` and keeps every call
function database(answer: string) {
  const call = vi.fn(async () => answer);
  return { db: { call: call as DbRpc["call"] }, call };
}
const lease = { eventId: "event", token: "token" };

describe("reviewer budget", () => {
  it("reads REVIEWER_CALL_BUDGET and falls back to the default", () => {
    expect(reviewerCallBudget({ REVIEWER_CALL_BUDGET: "50" })).toBe(50);
    expect(reviewerCallBudget({})).toBe(DEFAULT_REVIEWER_CALL_BUDGET);
    expect(reviewerCallBudget({ REVIEWER_CALL_BUDGET: "off" })).toBe(DEFAULT_REVIEWER_CALL_BUDGET);
    expect(reviewerCallBudget({ REVIEWER_CALL_BUDGET: "0" })).toBe(DEFAULT_REVIEWER_CALL_BUDGET);
  });

  it("asks nobody when the build fits the budget", async () => {
    const { db, call } = database("waiting");
    expect(await checkReviewerBudget(db, lease, 25, { REVIEWER_CALL_BUDGET: String(25 * REVIEWER_CALLS_PER_SECTION) })).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("logs and holds a build over the budget with its numbers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, call } = database("waiting");
    expect(await checkReviewerBudget(db, lease, 648, {})).toBe(true);
    expect(call).toHaveBeenCalledWith("hold_upload_for_reviewer_budget", { p_event_id: "event", p_token: "token", p_sections: 648, p_estimate: 648 * REVIEWER_CALLS_PER_SECTION, p_budget: DEFAULT_REVIEWER_CALL_BUDGET });
    expect(warn).toHaveBeenCalledWith("Upload reviewer budget exceeded", expect.objectContaining({ sections: 648 }));
    warn.mockRestore();
  });

  it("goes on once approved and stops with the reason once declined", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await checkReviewerBudget(database("approved").db, lease, 648, {})).toBe(false);
    await expect(checkReviewerBudget(database("declined").db, lease, 648, {})).rejects.toBeInstanceOf(ReviewerBudgetDeclined);
    await expect(checkReviewerBudget(database("declined").db, lease, 648, {})).rejects.toThrow("over the budget of 800");
    vi.restoreAllMocks();
  });
});
