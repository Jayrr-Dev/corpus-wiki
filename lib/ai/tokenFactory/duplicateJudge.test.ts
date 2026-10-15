import { describe, expect, it } from "vitest";
import { readJudgeAnswer, type JudgeRequest } from "./duplicateJudge";

const request: JudgeRequest = {
  claims: [
    { ref: "N1", content: "a", candidates: ["U1"] },
    { ref: "N2", content: "b", candidates: ["U1", "N1"] },
    { ref: "N3", content: "c", candidates: ["U2"] },
  ],
  known: [],
};

describe("readJudgeAnswer", () => {
  it("keeps decisions that name one of the claim's own candidates", () => {
    const decisions = readJudgeAnswer({
      decisions: [
        { claim: "n1", verdict: "same", match: "u1", content: null, reason: "same rule" },
        { claim: "N2", verdict: "adds_detail", match: "N1", content: "b plus", reason: "" },
      ],
    }, request);
    expect(decisions.get("N1")).toMatchObject({ verdict: "same", match: "U1" });
    expect(decisions.get("N2")).toMatchObject({ verdict: "adds_detail", match: "N1", content: "b plus" });
  });

  it("keeps the claim when the match is not a candidate, a merge has no wording, or the ref is unknown", () => {
    const decisions = readJudgeAnswer({
      decisions: [
        { claim: "N1", verdict: "same", match: "U2", content: null, reason: "" },
        { claim: "N3", verdict: "adds_detail", match: "U2", content: " ", reason: "" },
        { claim: "N9", verdict: "same", match: "U1", content: null, reason: "" },
      ],
    }, request);
    expect(decisions.get("N1")).toMatchObject({ verdict: "different", match: null });
    expect(decisions.get("N3")).toMatchObject({ verdict: "different", match: null });
    expect(decisions.has("N9")).toBe(false);
  });
});
