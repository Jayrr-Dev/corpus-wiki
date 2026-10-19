import { expect, it } from "vitest";
import { correctionRefsFor, reconcileReviewParents } from "./filingReview";

const parents = [{ path: "A/Fears", refs: ["C1", "C2"] }, { path: "A/Growth", refs: ["C3"] }, { path: "A/Wings", refs: ["C4", "C5"] }];

it("keeps assessments that cover their destination and returns only unassessed destinations", () => {
  const result = reconcileReviewParents([
    { path: "A/Fears", refs: ["C2", "c1"], reason: "Both describe fear." },
    { path: "A/Growth", refs: ["C3", "C9"], reason: "Growth path." },
    { path: "A/Wings", refs: ["C4"], reason: "Wing detail." },
    { path: "Invented", refs: ["C1"], reason: "Not a destination." },
  ], parents);
  expect(result.assessed).toEqual([{ path: "A/Fears", refs: ["C1", "C2"], reason: "Both describe fear." }, { path: "A/Growth", refs: ["C3"], reason: "Growth path." }]);
  expect(result.missing).toEqual([{ path: "A/Wings", refs: ["C4", "C5"] }]);
});

it("joins a destination assessed in two entries and reports a destination it never assessed", () => {
  const result = reconcileReviewParents([{ path: "A/Fears ", refs: ["C1"], reason: "One." }, { path: "A/Fears", refs: ["C2"], reason: "Two." }], parents.slice(0, 2));
  expect(result.assessed).toEqual([{ path: "A/Fears", refs: ["C1", "C2"], reason: "One. Two." }]);
  expect(result.missing).toEqual([{ path: "A/Growth", refs: ["C3"] }]);
});

it("corrects named current refs and every member of a named destination", () => {
  expect([...correctionRefsFor(["C3 belongs under Growth; C42 is context only."], parents, new Set(["C1", "C2", "C3", "C4", "C5"]))]).toEqual(["C3"]);
  expect([...correctionRefsFor(["A/Wings mixes two subjects."], parents, new Set(["C1", "C2", "C3", "C4", "C5"]))].sort()).toEqual(["C4", "C5"]);
});
