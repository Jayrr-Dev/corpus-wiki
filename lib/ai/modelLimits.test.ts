import { describe, expect, it } from "vitest";
import { answerRoom, modelLimit } from "./modelLimits";

describe("model limits", () => {
  it("finds a model however the app names it", () => {
    expect(modelLimit("nvidia/nemotron-3-super-120b-a12b")?.contextTokens).toBe(262144);
    expect(modelLimit("nvidia/Nemotron-3-Super-120b-a12b")?.contextTokens).toBe(262144);
    expect(modelLimit("anthropic/claude-haiku-5-5")?.maxOutputTokens).toBe(128000);
  });

  it("knows no limit for a model no provider published", () => {
    expect(modelLimit("cerebras/qwen-3.8-27b")).toBeNull();
    expect(modelLimit("made-up/model")).toBeNull();
    expect(answerRoom("made-up/model", 100)).toBeNull();
  });

  it("gives an answer the window left after the prompt", () => {
    expect(answerRoom("nvidia/nemotron-3-super-120b-a12b", 30_000)).toBe(262144 - 10_000 - 1_000);
  });

  it("stops at the model's own answer limit", () => {
    expect(answerRoom("anthropic/claude-haiku-5-5", 3_000)).toBe(128000);
  });

  it("still leaves an answer budget when the prompt fills the window", () => {
    expect(answerRoom("nvidia/nemotron-3-super-120b-a12b", 3_000_000)).toBe(1_024);
  });
});
