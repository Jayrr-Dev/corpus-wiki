import { describe, expect, it, vi } from "vitest";
import type { NliScorer, NliScores } from "@/lib/ai/nli";
import { prefilter, relate, UNRELATED_MIN_NEUTRAL } from "./prefilter";

const E = (entailment: number): NliScores => ({ entailment, contradiction: (1 - entailment) / 2, neutral: (1 - entailment) / 2 });
const C = (contradiction: number): NliScores => ({ contradiction, entailment: (1 - contradiction) / 2, neutral: (1 - contradiction) / 2 });
const N = (neutral: number): NliScores => ({ neutral, entailment: (1 - neutral) / 2, contradiction: (1 - neutral) / 2 });

// A fake scorer: scores keyed by "premise => hypothesis"; unknown pairs are an even split
function fake(pairs: Record<string, NliScores>): NliScorer & { score: ReturnType<typeof vi.fn> } {
  return { model: "fake", score: vi.fn(async (premise: string, hypothesis: string) => pairs[`${premise} => ${hypothesis}`] ?? { entailment: 1 / 3, contradiction: 1 / 3, neutral: 1 / 3 }) };
}

describe("relate", () => {
  it("scores both directions", async () => {
    const nli = fake({});
    await relate("a", "b", nli);
    expect(nli.score.mock.calls).toEqual([["a", "b"], ["b", "a"]]);
  });
  it("calls mutual entailment the same", async () => {
    expect(await relate("a", "b", fake({ "a => b": E(0.9), "b => a": E(0.8) }))).toBe("same");
  });
  it("calls one-way entailment added detail", async () => {
    expect(await relate("a", "b", fake({ "a => b": E(0.9), "b => a": N(0.7) }))).toBe("adds_detail");
  });
  it("calls a contradiction in either direction a contradiction, even beside entailment", async () => {
    expect(await relate("a", "b", fake({ "a => b": N(0.9), "b => a": C(0.6) }))).toBe("contradicts");
    expect(await relate("a", "b", fake({ "a => b": C(0.6), "b => a": E(0.9) }))).toBe("contradicts");
  });
  it("calls a pair unrelated only when both directions are confidently neutral", async () => {
    expect(await relate("a", "b", fake({ "a => b": N(0.95), "b => a": N(UNRELATED_MIN_NEUTRAL) }))).toBe("unrelated");
    expect(await relate("a", "b", fake({ "a => b": N(0.95), "b => a": N(UNRELATED_MIN_NEUTRAL - 0.01) }))).toBe("unclear");
    expect(await relate("a", "b", fake({ "a => b": N(0.6), "b => a": N(0.6) }))).toBe("unclear");
  });
  it("is unclear without a scorer, or when the scorer throws", async () => {
    expect(await relate("a", "b", null)).toBe("unclear");
    expect(await relate("a", "b", { model: "broken", score: async () => { throw new Error("no model"); } })).toBe("unclear");
  });
});

describe("prefilter", () => {
  const item = { id: "x", text: "x" };
  const candidates = [{ id: "same", text: "s" }, { id: "far", text: "f" }, { id: "against", text: "c" }, { id: "maybe", text: "m" }];
  const nli = fake({
    "x => s": E(0.9), "s => x": E(0.9),
    "x => f": N(0.95), "f => x": N(0.9),
    "x => c": C(0.9), "c => x": N(0.9),
  });

  it("drops only unrelated candidates and keeps contradictions", async () => {
    expect(await prefilter(item, candidates, nli)).toEqual({
      keep: [candidates[0], candidates[2], candidates[3]],
      dropped: [{ id: "far", relation: "unrelated" }],
    });
  });
  it("drops nothing without a scorer", async () => {
    expect(await prefilter(item, candidates, null)).toEqual({ keep: candidates, dropped: [] });
  });
  it("leaves keep empty when every candidate is unrelated, so the caller can skip its call", async () => {
    expect((await prefilter(item, [candidates[1]!], nli)).keep).toEqual([]);
  });
});
