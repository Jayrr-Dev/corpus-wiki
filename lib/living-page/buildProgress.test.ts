import { afterEach, describe, expect, it, vi } from "vitest";
import { readCompletionStream } from "@/lib/ai/chat";
import { partialSectionAnswer, progressReporter, type SectionBuildMessage } from "./buildProgress";

// =====================================================================
// SECTION BUILD PROGRESS: the half-written answer is read into paragraphs,
// messages are numbered and spaced out, and a streamed completion reads
// back into the same shape as a plain one.
// =====================================================================

describe("partialSectionAnswer", () => {
  it("reads revised and added paragraphs from an unfinished answer", () => {
    const content = '{"revise":[{"line":"L2","text":"Inspections run weekly.","claims":["C1"]}],"retire":["L3"],"add":[{"text":"Safety meetings are held every Mon';
    expect(partialSectionAnswer(content)).toEqual({
      revised: [{ line: "L2", text: "Inspections run weekly." }],
      added: ["Safety meetings are held every Mon"],
    });
  });

  it("decodes escapes and drops one cut off mid-way", () => {
    expect(partialSectionAnswer('{"revise":[],"add":[{"text":"The \\"site\\" lead\\u00e9 \\u00').added).toEqual(['The "site" leadé ']);
  });

  it("is empty before any paragraph starts", () => {
    expect(partialSectionAnswer('{"rev')).toEqual({ revised: [], added: [] });
  });

  it("ignores a quoted key inside a paragraph", () => {
    const content = '{"add":[{"text":"He said \\"revise\\": no","claims":[]}],"revise":[';
    expect(partialSectionAnswer(content).added).toEqual(['He said "revise": no']);
  });
});

describe("progressReporter", () => {
  afterEach(() => vi.useRealTimers());

  it("numbers messages and keeps only the latest draft within the interval", () => {
    vi.useFakeTimers();
    const sent: SectionBuildMessage[] = [];
    const progress = progressReporter((message) => sent.push(message), 250);
    progress.step("Reading");
    progress.draft({ revised: {}, added: ["A"] });
    progress.draft({ revised: {}, added: ["AB"] });
    progress.draft({ revised: {}, added: ["ABC"] });
    expect(sent.map((message) => message.kind)).toEqual(["step", "draft"]);
    vi.advanceTimersByTime(250);
    progress.done();
    expect(sent).toEqual([
      { seq: 1, kind: "step", text: "Reading" },
      { seq: 2, kind: "draft", draft: { revised: {}, added: ["A"] } },
      { seq: 3, kind: "draft", draft: { revised: {}, added: ["ABC"] } },
      { seq: 4, kind: "done" },
    ]);
  });
});

describe("readCompletionStream", () => {
  it("collects content, thinking, finish reason and usage from server-sent events", async () => {
    const events = [
      { model: "m", choices: [{ delta: { reasoning_content: "Let me " } }] },
      { choices: [{ delta: { reasoning_content: "think." } }] },
      { choices: [{ delta: { content: '{"summary":' } }] },
      { choices: [{ delta: { content: '"ok"}' }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ];
    const text = `${events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("")}data: [DONE]\n\n`;
    // Split mid-line, as a network read would
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 37));
        controller.enqueue(bytes.slice(37));
        controller.close();
      },
    });
    const seen: string[] = [];
    const result = await readCompletionStream(new Response(body), ({ content, reasoning }) => seen.push(`${reasoning}|${content}`));
    expect(seen).toEqual(["Let me |", "Let me think.|", 'Let me think.|{"summary":', 'Let me think.|{"summary":"ok"}']);
    expect(result).toEqual({
      model: "m",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      choices: [{ message: { content: '{"summary":"ok"}', refusal: null }, finish_reason: "stop" }],
    });
  });
});
