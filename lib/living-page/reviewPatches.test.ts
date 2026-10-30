import { expect, it } from "vitest";
import { materializeReviewPatches, pagePatchReviewSchema } from "./reviewPatches";
import type { PageReviewSnapshot } from "./pageReview";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const snapshot: PageReviewSnapshot = {
  page: { id: "p", title: "Page", slug: "page" },
  lines: [
    { line_id: A, author: "ai", content: "The front desk opens at 7:30 on weekdays." },
    { line_id: B, author: "ai", content: "Reminder texts go out two days ahead." },
  ],
  pages: [],
};
const proposal = pagePatchReviewSchema.parse({
  summary: "Tightened two lines.",
  findings: [],
  edits: [
    { type: "revise_line", targetId: A, reason: "Clearer", patches: [{ old_str: "on weekdays", new_str: "Monday to Friday" }] },
    { type: "revise_line", targetId: B, reason: "Quotes text the line lacks", patches: [{ old_str: "two days before", new_str: "48 hours before" }] },
  ],
});

it("fails on an edit that quotes missing text, so the reviewer can be asked again", () => {
  expect(() => materializeReviewPatches(proposal, snapshot)).toThrow("absent from the original paragraph");
});

it("after the retry, leaves out only the edit that still cannot be applied", () => {
  const review = materializeReviewPatches(proposal, snapshot, true);
  expect(review.edits).toEqual([{ type: "revise_line", targetId: A, reason: "Clearer", text: "The front desk opens at 7:30 Monday to Friday." }]);
  expect(review.summary).toBe("Tightened two lines.");
});

it("after the retry, keeps the first of two edits to one paragraph", () => {
  const twice = pagePatchReviewSchema.parse({ summary: "Edited twice.", findings: [], edits: [
    { type: "revise_line", targetId: A, reason: "First", patches: [{ old_str: "on weekdays", new_str: "Monday to Friday" }] },
    { type: "revise_line", targetId: A, reason: "Second", patches: [{ old_str: "7:30", new_str: "7:45" }] },
  ] });
  expect(() => materializeReviewPatches(twice, snapshot)).toThrow("conflicting operations");
  expect(materializeReviewPatches(twice, snapshot, true).edits.map((edit) => edit.reason)).toEqual(["First"]);
});
