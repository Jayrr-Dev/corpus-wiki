import { describe, expect, it } from "vitest";
import { formatReviewSummary, reviewSummarySchema } from "./reviewSummary";

const group = { title: "Next steps", items: Array.from({ length: 3 }, () => ({ lead: "Confirm placement", detail: "Check the intended parent." })) };
const summary = { heading: "Review domain placement", groups: [group, group, group] };
describe("domain review summaries", () => {
  it("requires three groups with three items each", () => {
    expect(reviewSummarySchema.safeParse(summary).success).toBe(true);
    expect(reviewSummarySchema.safeParse({ ...summary, groups: [group] }).success).toBe(false);
    expect(reviewSummarySchema.safeParse({ ...summary, groups: [group, group, { ...group, items: [] }] }).success).toBe(false);
  });
  it("stores a heading, bold group titles and nine action-led bullets", () => {
    const text = formatReviewSummary(summary);
    expect(text.startsWith("# Review domain placement\n")).toBe(true);
    expect(text.match(/^- \*\*Confirm placement:\*\* Check the intended parent\.$/gm)).toHaveLength(9);
    expect(text.match(/^\*\*Next steps\*\*$/gm)).toHaveLength(3);
  });
});
