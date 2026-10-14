import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type CompletionResponse, parseContent } from "./chat";

// =====================================================================
// PARSING THE MODEL'S ANSWER: every unusable answer gets a clear message.
// The first case is the real failure on a 169-passage PDF: GLM-5.3-Flash
// spent the whole 8,000-token budget reasoning and wrote no JSON.
// =====================================================================

const SCHEMA = z.object({ summary: z.string() });

// A completion with one choice
const completion = (content: string | null, finishReason: string, completionTokens = 100): CompletionResponse => ({
  choices: [{ message: { content }, finish_reason: finishReason }],
  usage: { prompt_tokens: 18_680, completion_tokens: completionTokens },
});

describe("parseContent", () => {
  it("says the model ran out of room when the budget ends the answer", () => {
    expect(() => parseContent(completion("", "length", 8000), SCHEMA)).toThrow(/ran out of room after 8000 tokens/);
    expect(() => parseContent(completion('{"summary": "Rea', "length", 8000), SCHEMA)).toThrow(/ran out of room/);
  });

  it("names an empty answer and a broken one instead of a bare JSON error", () => {
    expect(() => parseContent(completion("  ", "stop"), SCHEMA)).toThrow(/returned no answer/);
    expect(() => parseContent(completion('{"summary": "Rea', "stop"), SCHEMA)).toThrow(/not valid JSON/);
  });

  it("returns a valid answer", () => {
    expect(parseContent(completion('{"summary": "Read the safety program"}', "stop"), SCHEMA)).toEqual({ summary: "Read the safety program" });
  });
});
