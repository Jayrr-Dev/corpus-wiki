import { describe, expect, it } from "vitest";
import { QUERY_TASKS, queryText, usesQueryInstruction } from "./queryText";

// QUERY TEXT: instructed for Qwen3-Embedding, untouched for other models
describe("queryText", () => {
  it("adds the task instruction for Qwen3-Embedding models", () => {
    expect(queryText("Qwen/Qwen3-Embedding-8B", "knowledge", "Who approves PPE?"))
      .toBe(`Instruct: ${QUERY_TASKS.knowledge}\nQuery: Who approves PPE?`);
    expect(queryText("qwen/qwen3-embedding-0.6b", "glossary", "lockout")).toContain(QUERY_TASKS.glossary);
  });

  it("leaves the text unchanged for models without query instructions", () => {
    expect(usesQueryInstruction("text-embedding-3-small")).toBe(false);
    expect(queryText("text-embedding-3-small", "knowledge", "Who approves PPE?")).toBe("Who approves PPE?");
  });
});
