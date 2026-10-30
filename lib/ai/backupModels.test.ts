import { describe, expect, it } from "vitest";
import { AiInactivityError } from "./inactivityTimeout";
import { backupCandidates, backupIndex, blendedCostPerM, isProviderFailure, providerOf, rankedBackups } from "./backupModels";

describe("backupIndex", () => {
  it("puts the cheaper, faster, smarter model first and counts unknowns as the middle", () => {
    const ranked = backupIndex([
      { model: "dear-slow", costPerM: 10, tokensPerSecond: 20, intelligence: 3 },
      { model: "cheap-fast-smart", costPerM: 1, tokensPerSecond: 200, intelligence: 5 },
      { model: "unknown", costPerM: null, tokensPerSecond: null, intelligence: null },
    ]);
    expect(ranked.map((item) => item.model)).toEqual(["cheap-fast-smart", "unknown", "dear-slow"]);
    expect(ranked[0]!.index).toBeCloseTo(0.1);
    expect(ranked[1]!.index).toBeCloseTo(1.5);
  });
});

describe("backup candidates and ranking per role", () => {
  const models = (candidates: { model: string }[]) => candidates.map((candidate) => candidate.model);
  it("offers only providers this server has a key for", () => {
    expect(backupCandidates({})).toEqual([]);
    expect(models(backupCandidates({ OPENROUTER_API_KEY: "k" }))).toEqual(["openrouter/inception/mercury-3"]);
    expect(backupCandidates({ ANTHROPIC_API_KEY: "k" }).every((candidate) => providerOf(candidate.model) === "anthropic")).toBe(true);
  });
  it("takes an explicit list from AI_BACKUP_MODELS", () => {
    expect(models(backupCandidates({ AI_BACKUP_MODELS: " openrouter/a , openrouter/b ", ANTHROPIC_API_KEY: "k" }))).toEqual(["openrouter/a", "openrouter/b"]);
  });
  it("weights intelligence for judgment roles and cost for bulk ones", () => {
    const candidates = [
      { model: "cheap", costPerM: 0.2, tokensPerSecond: 100, intelligence: 20 },
      { model: "smart", costPerM: 4, tokensPerSecond: 100, intelligence: 48 },
    ];
    expect(rankedBackups(candidates, "reviewer")[0]).toBe("smart");
    expect(rankedBackups(candidates, "deduplicator")[0]).toBe("cheap");
  });
});

describe("blendedCostPerM", () => {
  it("counts Claude's cached input at its cache-read rate and others at full price", () => {
    // Haiku 5.5: input 0.1, half of it at the default 0.1x cache rate -> 0.055; output 0.5
    expect(blendedCostPerM("anthropic/claude-haiku-5-5")).toBeCloseTo((3 * 0.055 + 0.5) / 4, 6);
    // Mercury 3 on OpenRouter: no cache discount
    expect(blendedCostPerM("openrouter/inception/mercury-3")).toBeCloseTo((3 * 0.1 + 0.35) / 4);
    expect(blendedCostPerM("unknown/model")).toBeNull();
  });
});

describe("isProviderFailure", () => {
  it("moves on for overload, stalls, credit and outages, never for a bad request or answer", () => {
    expect(isProviderFailure(new Error('Token Factory 529: {"error":"worker overloaded"}'))).toBe(true);
    expect(isProviderFailure(new Error("Cerebras 402: Payment required"))).toBe(true);
    expect(isProviderFailure(new AiInactivityError())).toBe(true);
    expect(isProviderFailure(new Error("Token Factory 400: bad request"))).toBe(false);
    expect(isProviderFailure(new Error("The answer did not match the schema"))).toBe(false);
  });
});
