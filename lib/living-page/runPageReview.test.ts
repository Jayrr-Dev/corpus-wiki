import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { pageReviewMessages, runPageReview, reviewRebuiltSections } from "./runPageReview";

const chat = vi.hoisted(() => vi.fn());
const similar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/chat", async original => ({ ...(await original<typeof import("@/lib/ai/chat")>()), chatJson: chat }));
vi.mock("@/lib/ai/contextWindow", () => ({ reviewContextWindow: async (settings: { contextWindowTokens?: number }) => settings.contextWindowTokens ?? 65536 }));
vi.mock("@/lib/knowledge/embeddingStore", () => ({ similarUnits: similar }));
const page = "11111111-1111-4111-8111-111111111111";
const line = "22222222-2222-4222-8222-222222222222";
const snapshot = { page: { id: page, title: "Inspections", slug: "inspections" }, pages: [], sections: [], lines: [{ line_id: line, content: "Inspections occur weekly.", author: "ai", unit_revision_ids: ["claim"] }], claims: [{ id: "claim", content: "Inspections occur weekly." }] };
beforeEach(() => {
  vi.clearAllMocks();
  chat.mockReset();
  chat.mockResolvedValue({ value: { summary: "Reviewed", edits: [], findings: [] }, model: "test", tokensIn: 1, tokensOut: 1 });
  similar.mockResolvedValue([{ revisionId: line, content: "Related claim" }]);
});
function database() {
  const call = vi.fn(async (name: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (name === "page_review_snapshot") return snapshot;
    if (name === "page_review_related") return [{ content: "Related claim", passages: [{ text: "Supporting evidence" }] }];
    if (name === "complete_page_review") return { summary: "Reviewed", edits: (args?.p_edits as unknown[]).length, exceptions: 0, changeSetId: null };
    if (name === "pages_needing_editorial_review") return [];
    if (name === "page_review_state") return { current: false, partialRuns: 0, unfinishedSections: 0 };
    throw new Error(name);
  });
  return { db: { call: call as DbRpc["call"] }, call };
}
describe("review workflow", () => {
  it("finishes the review while rejecting an unsafe patch batch and preserving existing text", async () => {
    const { db, call } = database();
    chat.mockResolvedValueOnce({ value: { summary: "Changed weekly to daily.", findings: [], edits: [{ type: "revise_line", targetId: line, patches: [{ old_str: "weekly", new_str: "daily" }], reason: "Improve wording" }] }, model: "test", tokensIn: 10, tokensOut: 2 });
    chat.mockResolvedValueOnce({ value: { lines: [{ ref: "L1", supported: false, problem: "The evidence says weekly, not daily.", missingCitations: [], unstatedCitations: [] }] }, tokensIn: 3, tokensOut: 1 });
    chat.mockResolvedValueOnce({ value: { opinions: [{ ref: "L1", lineHasFault: true, reason: "Only weekly is supported." }] }, tokensIn: 4, tokensOut: 1 });
    const result = await runPageReview(db, { apiKey: "test" }, page);
    expect(result.coverageComplete).toBe(true);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({
      p_edits: [], p_snapshot: snapshot,
      p_review: expect.objectContaining({ summary: expect.stringContaining("were not applied"), coverageComplete: true }),
      p_trace: expect.objectContaining({ tokensIn: 17, tokensOut: 4 }),
    }));
    const saved = call.mock.calls.find(([name]) => name === "complete_page_review")![1]?.p_review as { summary: string };
    expect(saved.summary).not.toContain("Changed weekly to daily");
  });

  it("retries a provider context-limit error with smaller payloads, without saving the failed attempt", async () => {
    const { db, call } = database();
    const large = { ...snapshot, lines: Array.from({ length: 6 }, (_, i) => ({ line_id: String(i), author: "ai", unit_revision_ids: [], content: "Review this sentence. ".repeat(700) })) };
    call.mockImplementation(async (name) => name === "page_review_snapshot" ? large : { summary: "Reviewed", edits: 0, exceptions: 0, changeSetId: null });
    chat.mockRejectedValueOnce(new Error("Token Factory 400: maximum context length exceeded"));
    await runPageReview(db, { apiKey: "test" }, page);
    const payloads = chat.mock.calls.map((call) => call[1].messages[1].content.length);
    expect(payloads.length).toBeGreaterThan(1);
    expect(Math.max(...payloads.slice(1))).toBeLessThan(payloads[0]!);
    expect(call.mock.calls.filter(([name]) => name === "complete_page_review")).toHaveLength(1);
  });

  it("settles a same-page destination without another model call and saves the validated rewrite", async () => {
    const { db, call } = database();
    const edit = { type: "revise_line", targetId: line, text: "Inspections follow a weekly schedule.", reason: "Shorten the repeated lead." };
    chat.mockResolvedValueOnce({ value: { summary: "Consolidate", edits: [{ type: edit.type, targetId: line, patches: [{ old_str: "occur weekly", new_str: "follow a weekly schedule" }], reason: edit.reason }], findings: [{ operation: "consolidate", quote: "Inspections occur weekly.", guideline: "Repetition", reason: "Repeated", recommendation: "Shorten the lead", destinationId: page, decisionKind: null, decisionQuestion: null }] }, model: "test" });
    chat.mockResolvedValueOnce({ value: { lines: [{ ref: "L1", supported: true, problem: "", missingCitations: [], unstatedCitations: [] }] }, tokensIn: 1, tokensOut: 1 });
    await runPageReview(db, { apiKey: "test" }, page);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_edits: [edit], p_snapshot: snapshot, p_trace: expect.objectContaining({ timingsMs: expect.objectContaining({ snapshot: expect.any(Number), editorial: expect.any(Number) }) }) }));
  });

  it("accepts a destination whose text was actually supplied through related retrieval", async () => {
    const { db, call } = database();
    const destination = "33333333-3333-4333-8333-333333333333";
    const original = call.getMockImplementation()!;
    call.mockImplementation(async (name, args) => name === "page_review_related" ? [{ content: "Related", passages: [], pages: [{ id: destination, title: "Related page", content: "Inspections occur weekly." }] }] : original(name, args));
    chat.mockResolvedValueOnce({ value: { summary: "Compare pages", edits: [], findings: [{ operation: "consolidate", quote: "Inspections occur weekly.", guideline: "Repetition", reason: "Repeated", recommendation: "Consolidate", destinationId: destination, decisionKind: "cross_page_restructure", decisionQuestion: "Keep this on the related page?" }] }, model: "test" });
    await runPageReview(db, { apiKey: "test" }, page, { model: "embedding", embed: vi.fn().mockResolvedValue([[0.1]]) });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_snapshot: snapshot }));
  });

  it("leaves out what the corrective retry still gets wrong and keeps the rest", async () => {
    const { db, call } = database();
    const unknown = "33333333-3333-4333-8333-333333333333";
    const bad = { summary: "Reviewed", edits: [{ type: "revise_line", targetId: unknown, patches: [{ old_str: "x", new_str: "y" }], reason: "Fix" }], findings: [] };
    chat.mockResolvedValueOnce({ value: bad, model: "test" });
    chat.mockResolvedValueOnce({ value: { ...bad, edits: [...bad.edits, { type: "rename_section", targetId: unknown, text: "New heading", reason: "Fix" }], findings: [{ operation: "investigate", quote: "Not on this page.", guideline: "Evidence", reason: "Unsure", recommendation: "Check it", destinationId: null, decisionKind: null, decisionQuestion: null }] }, model: "test" });
    await runPageReview(db, { apiKey: "test" }, page);
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_edits: [], p_review: expect.objectContaining({ findings: [] }) }));
  });

  it("does not retry authentication failures as context problems", async () => {
    const { db, call } = database();
    chat.mockRejectedValueOnce(new Error("Token Factory 401: Unauthorized"));
    await expect(runPageReview(db, { apiKey: "test" }, page)).rejects.toThrow("401");
    expect(chat).toHaveBeenCalledTimes(1);
    expect(call.mock.calls.some(([name]) => name === "complete_page_review")).toBe(false);
  });

  it("saves nothing when consolidation of fragmented evidence fails", async () => {
    const { db, call } = database();
    const large = { ...snapshot, lines: [{ ...snapshot.lines[0]!, unit_revision_ids: ["claim"], content: "Inspections occur weekly." }], claims: [{ id: "claim", content: "Inspections occur monthly.", passage_ids: ["passage"] }], passages: [{ id: "passage", source_id: "source", text: "Inspections occur monthly. " + "Evidence. ".repeat(25000) }], sources: [{ id: "source", title: "Manual" }] };
    call.mockImplementation(async (name) => name === "page_review_snapshot" ? large : { summary: "Reviewed", edits: 0, exceptions: 0, changeSetId: null });
    chat.mockImplementation(async (_settings, request) => {
      if (request.name === "page_review_consolidate") throw new Error("Consolidation failed");
      const fragments = JSON.parse(request.messages[1].content).fragments;
      return { value: { observations: fragments.flatMap((fragment: { kind: string; recordIndex: number; text: string }) => {
        const quote = fragment.kind === "lines" ? "Inspections occur weekly." : "Inspections occur monthly.";
        return ["lines", "claims", "passages"].includes(fragment.kind) && fragment.text.includes(quote) ? [{ kind: fragment.kind, recordIndex: fragment.recordIndex, quote }] : [];
      }), moreRelevantText: false }, model: "test", tokensIn: 1, tokensOut: 1 };
    });
    await expect(runPageReview(db, { apiKey: "test" }, page)).rejects.toThrow("Consolidation failed");
    expect(chat.mock.calls.some((call) => call[1].name === "page_review_consolidate")).toBe(true);
    expect(call.mock.calls.some(([name]) => name === "complete_page_review")).toBe(false);
  });

  it("marks a fragmented review partial when extraction returns no relevant quotations", async () => {
    const { db, call } = database();
    const large = { ...snapshot, lines: [{ ...snapshot.lines[0]!, content: "Original fact. ".repeat(20000) }] };
    call.mockImplementation(async (name) => name === "page_review_snapshot" ? large : { summary: "Reviewed", edits: 0, exceptions: 0, changeSetId: null });
    chat.mockImplementation(async () => ({ value: { observations: [], moreRelevantText: false }, model: "test", tokensIn: 1, tokensOut: 1 }));
    await runPageReview(db, { apiKey: "test" }, page);
    expect(chat.mock.calls.length).toBeGreaterThan(1);
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_snapshot: large, p_edits: [], p_review: expect.objectContaining({ findings: [], coverageComplete: false, summary: expect.stringContaining("Partial review.") }) }));
  });

  it("reviews oversized pages in bounded parts and saves the original snapshot once", async () => {
    const { db, call } = database();
    const large = { ...snapshot, lines: [0, 1, 2].map((i) => ({ line_id: `${i}`, author: "ai", unit_revision_ids: [], content: "A long paragraph. ".repeat(5500) })) };
    call.mockImplementation(async (name) => name === "page_review_snapshot" ? large : { summary: "Reviewed", edits: 0, exceptions: 0, changeSetId: null });
    await runPageReview(db, { apiKey: "test" }, page);
    expect(chat.mock.calls.length).toBeGreaterThan(1);
    expect(call.mock.calls.filter(([name]) => name === "complete_page_review")).toHaveLength(1);
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_snapshot: large, p_review: expect.objectContaining({ summary: expect.stringContaining("cross-section structure was not assessed") }), p_trace: expect.objectContaining({ tokensIn: chat.mock.calls.length }) }));
  });

  it("saves nothing if a later batch fails", async () => {
    const { db, call } = database();
    const large = { ...snapshot, lines: [0, 1, 2].map((i) => ({ line_id: `${i}`, author: "ai", unit_revision_ids: [], content: "A long paragraph. ".repeat(5500) })) };
    call.mockImplementation(async (name) => name === "page_review_snapshot" ? large : {} as never);
    chat.mockResolvedValueOnce({ value: { summary: "Reviewed", edits: [], findings: [] }, model: "test", tokensIn: 1, tokensOut: 1 }).mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(runPageReview(db, { apiKey: "test" }, page)).rejects.toThrow("Provider unavailable");
    expect(call.mock.calls.some(([name]) => name === "complete_page_review")).toBe(false);
  });

  it("streams public draft updates and real workflow stages", async () => {
    chat.mockImplementationOnce(async (_settings, request) => {
      request.onStream({ content: '{"summary":"Checked the source', reasoning: "private reasoning" });
      return { value: { summary: "Checked the source", edits: [], findings: [] }, model: "test", tokensIn: 1, tokensOut: 1 };
    });
    const { db } = database();
    const progress = vi.fn();
    await runPageReview(db, { apiKey: "test" }, page, null, progress);
    const messages = progress.mock.calls.flat();
    expect(messages).toContain("Reading the current page and its cited evidence…");
    expect(messages).toContain("Draft review: Checked the source");
    expect(messages).toContain("Saving 0 fixes and 0 unresolved decisions…");
    expect(messages.join(" ")).not.toContain("private reasoning");
  });
  it("passes the mocked retrieval result to the reviewer and saves a clean result", async () => {
    const { db, call } = database();
    const embed = vi.fn().mockResolvedValue([[0.1, 0.2]]);
    await runPageReview(db, { apiKey: "test" }, page, { model: "embedding", embed });
    expect(similar).toHaveBeenCalledWith(db, "embedding", [0.1, 0.2], 12, 0.65);
    expect(chat.mock.calls[0]![1].messages[2].content).toContain("Supporting evidence");
    expect(chat.mock.calls[0]![1].reasoningEffort).toBe("low");
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_edits: [], p_review: expect.objectContaining({ findings: [] }) }));
  });
  it("leaves out fabricated edit targets after the retry, and the review still completes", async () => {
    chat.mockResolvedValue({ value: { summary: "Edited", findings: [], edits: [{ type: "revise_line", targetId: page, patches: [], reason: "test" }] } });
    const { db, call } = database();
    await runPageReview(db, { apiKey: "test" }, page);
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_edits: [] }));
  });
  it("does not call the model when the database returns no pages needing review", async () => {
    const { db } = database();
    await reviewRebuiltSections(db, { apiKey: "test" }, [line]);
    expect(chat).not.toHaveBeenCalled();
  });
  it("finishes an outstanding partial review without rebuilding its scaffold", async () => {
    const { db, call } = database();
    const original = call.getMockImplementation()!;
    let reads = 0;
    call.mockImplementation(async (name, args) => {
      if (name === "pages_needing_editorial_review") return ++reads < 3 ? [page] : [];
      if (name === "page_review_content_hash") return "current-content";
      return original(name, args);
    });
    await reviewRebuiltSections(db, { apiKey: "test" }, [line]);
    expect(call.mock.calls.filter(([name]) => name === "complete_page_review")).toHaveLength(2);
    expect(call).toHaveBeenCalledWith("page_review_content_hash", { p_page_id: page });
  });
  it("finishes the upload when only a partial review fits, leaving the page flagged for review", async () => {
    const { db, call } = database();
    const original = call.getMockImplementation()!;
    const large = { ...snapshot, lines: [0, 1, 2].map(i => ({ line_id: String(i), author: "ai", unit_revision_ids: [], content: "A long paragraph. ".repeat(5500) })) };
    call.mockImplementation(async (name, args) => {
      if (name === "pages_needing_editorial_review") return [page];
      if (name === "page_review_content_hash") return "large-content";
      if (name === "page_review_snapshot") return large;
      return original(name, args);
    });
    await expect(reviewRebuiltSections(db, { apiKey: "test" }, [line])).resolves.toBeUndefined();
    const saves = call.mock.calls.filter(([name]) => name === "complete_page_review");
    expect(saves).toHaveLength(2);
    expect(saves.every(([, args]) => (args?.p_review as { coverageComplete: boolean }).coverageComplete === false)).toBe(true);
  });
});

describe("reviewing only what changed", () => {
  const states = (...values: object[]) => {
    const { db, call } = database();
    const original = call.getMockImplementation()!;
    let reads = 0;
    call.mockImplementation(async (name, args) => {
      if (name === "pages_needing_editorial_review") return [page];
      if (name === "page_review_content_hash") return "same-content";
      if (name === "page_review_state") return values[Math.min(reads++, values.length - 1)];
      return original(name, args);
    });
    return { db, call };
  };
  it("skips a page whose current content was already reviewed", async () => {
    const { db, call } = states({ current: true, partialRuns: 0, unfinishedSections: 0 });
    await reviewRebuiltSections(db, { apiKey: "test" }, [line]);
    expect(chat).not.toHaveBeenCalled();
    expect(call.mock.calls.filter(([name]) => name === "complete_page_review")).toHaveLength(0);
  });
  it("stops resending identical content after two partial reviews of it", async () => {
    const { db } = states({ current: false, partialRuns: 2, unfinishedSections: 0 });
    await expect(reviewRebuiltSections(db, { apiKey: "test" }, [line])).resolves.toBeUndefined();
    expect(chat).not.toHaveBeenCalled();
  });
  it("logs an article with unfinished sections without paying for another identical review", async () => {
    const { db } = states({ current: true, partialRuns: 0, unfinishedSections: 1 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(reviewRebuiltSections(db, { apiKey: "test" }, [line])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Article review left unfinished; the page stays flagged for review", expect.anything());
    warn.mockRestore();
    expect(chat).not.toHaveBeenCalled();
  });
});

describe("approval noise control", () => {
  const finding = { operation: "investigate", quote: "Inspections occur weekly.", guideline: "Evidence", reason: "Check another page", recommendation: "Compare with the training page.", destinationId: null, decisionKind: null, decisionQuestion: null };
  it("retains routine investigations as notes without creating approvals", async () => {
    chat.mockResolvedValue({ value: { summary: "Reviewed", edits: [], findings: [finding] }, model: "test" });
    const { db, call } = database();
    await runPageReview(db, { apiKey: "test" }, page);
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_review: expect.objectContaining({ findings: [], summary: expect.stringContaining(finding.recommendation) }) }));
  });
  it("routes a model-labeled conflicting-evidence decision to approval", async () => {
    const conflict = { ...finding, decisionKind: "conflicting_evidence", decisionQuestion: "Should the weekly or monthly policy take precedence?" };
    chat.mockResolvedValue({ value: { summary: "Reviewed", edits: [], findings: [finding, conflict] }, model: "test" });
    const { db, call } = database();
    await runPageReview(db, { apiKey: "test" }, page);
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_review: expect.objectContaining({ findings: [conflict] }) }));
  });
  it("does not escalate an investigation mislabeled as a structural decision", async () => {
    chat.mockResolvedValue({ value: { summary: "Reviewed", edits: [], findings: [{ ...finding, decisionKind: "cross_page_restructure", decisionQuestion: "Can you check the other page?" }] }, model: "test" });
    const { db, call } = database();
    await runPageReview(db, { apiKey: "test" }, page);
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_review: expect.objectContaining({ findings: [] }) }));
  });
  it("keeps the system message identical with a Curator focus and caches the cited evidence before the page", async () => {
    const { db } = database();
    chat.mockResolvedValueOnce({ value: { summary: "Bad", findings: [], edits: [{ type: "revise_line", targetId: page, patches: [], reason: "test" }] }, model: "test", tokensIn: 1, tokensOut: 1 });
    await runPageReview(db, { apiKey: "test" }, page, undefined, undefined, "Check the inspection schedule");
    await runPageReview(db, { apiKey: "test" }, page);
    const [first, retry, plain] = chat.mock.calls.map((call) => call[1].messages as { role: string; content: string; cache?: boolean }[]);
    expect(first!.map((message) => [message.role, message.cache === true])).toEqual([["system", false], ["user", true], ["user", false], ["user", false]]);
    expect(first![0]!.content).toBe(plain![0]!.content);
    expect(first![0]!.content).not.toContain("Curator");
    expect(first![1]!.content).toBe(plain![1]!.content);
    expect(JSON.parse(first![1]!.content)).toEqual({ claims: snapshot.claims, passages: [], sources: [] });
    expect(JSON.parse(first![2]!.content).lines).toHaveLength(1);
    expect(first![3]!.content).toContain("Check the inspection schedule");
    // The validation retry repeats the same prefix and adds the correction last.
    expect(retry!.slice(0, 4)).toEqual(first);
    expect(retry![4]!.content).toContain("failed validation");
    expect(plain).toHaveLength(3);
  });
});

describe("page review messages", () => {
  it("puts the cited evidence after the system message and before the page, and skips empty parts", () => {
    const batch = { snapshot: snapshot as never, evidence: "{\"lines\":[]}", citedEvidence: "{\"claims\":[]}" };
    expect(pageReviewMessages("rules", batch, "focus")).toEqual([
      { role: "system", content: "rules" }, { role: "user", content: batch.citedEvidence, cache: true }, { role: "user", content: batch.evidence }, { role: "user", content: "focus" },
    ]);
    expect(pageReviewMessages("rules", { snapshot: snapshot as never, evidence: "{}" })).toEqual([{ role: "system", content: "rules" }, { role: "user", content: "{}" }]);
  });
});
