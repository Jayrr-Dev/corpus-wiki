import { describe, expect, it } from "vitest";
import { pageReviewSchema, validatePageReview, duplicateSectionRepairs, type PageReviewSnapshot } from "./pageReview";

const id = "11111111-1111-4111-8111-111111111111";
const destinationId = "22222222-2222-4222-8222-222222222222";
const snapshot: PageReviewSnapshot = { page: { id, title: "Inspections", slug: "inspections" }, lines: [{ content: "Inspections happen weekly." }], pages: [{ id }, { id: destinationId }].map((page) => ({ ...page, title: "Topic" })) };
const finding = { operation: "revise" as const, quote: "Inspections happen weekly.", guideline: "Lead and body", reason: "Repeated without detail", recommendation: "Keep a concise lead and add sourced detail to the body.", destinationId: null };
describe("page reviewer evidence boundaries", () => {
  it("allows a clean review without forcing findings", () => {
    expect(() => validatePageReview(pageReviewSchema.parse({ summary: "No actionable issue", findings: [] }), snapshot)).not.toThrow();
  });
  it("rejects fabricated quotes", () => {
    expect(() => validatePageReview({ summary: "Review", findings: [{ ...finding, quote: "Invented evidence" }] }, snapshot)).toThrow(/not in this page/);
  });
  it("requires a real, different destination for a structural recommendation", () => {
    for (const destination of [null, id, "33333333-3333-4333-8333-333333333333"]) {
      expect(() => validatePageReview({ summary: "Review", findings: [{ ...finding, operation: "move", destinationId: destination }] }, snapshot)).toThrow();
    }
    expect(() => validatePageReview({ summary: "Review", findings: [{ ...finding, operation: "consolidate", destinationId }] }, snapshot)).not.toThrow();
  });
  it("caps findings and rejects executable operations", () => {
    expect(pageReviewSchema.safeParse({ summary: "Review", findings: Array(7).fill(finding) }).success).toBe(false);
    expect(pageReviewSchema.safeParse({ summary: "Review", findings: [{ ...finding, operation: "drop_table" }] }).success).toBe(false);
  });
});

describe("automatic duplicate consolidation", () => {
  const article: PageReviewSnapshot = { ...snapshot, sections: [{ id, title: "Overview", mode: "generated" }, { id: destinationId, title: "Context and requirements", mode: "generated" }], lines: [
    { section_id: id, content: "The inspections take place weekly.", author: "ai", unit_revision_ids: [id] },
    { section_id: destinationId, content: "Inspections occur weekly.", author: "ai", unit_revision_ids: [id] },
  ] };
  it("consolidates equivalent text with identical evidence", () => expect(duplicateSectionRepairs(article)).toHaveLength(1));
  it.each(["Inspections occur monthly.", "Inspections do not occur weekly.", "Inspections occur weekly if needed."])("preserves distinct wording: %s", (content) => {
    expect(duplicateSectionRepairs({ ...article, lines: [article.lines[0]!, { ...article.lines[1]!, content }] })).toEqual([]);
  });
  it("preserves different evidence and human writing", () => {
    for (const change of [{ unit_revision_ids: [destinationId] }, { author: "person" }]) {
      expect(duplicateSectionRepairs({ ...article, lines: [article.lines[0]!, { ...article.lines[1]!, ...change }] })).toEqual([]);
    }
  });
});
