import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { runPageReview, reviewRebuiltSections } from "./runPageReview";

const chat = vi.hoisted(() => vi.fn());
const similar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/chat", () => ({ chatJson: chat }));
vi.mock("@/lib/knowledge/embeddingStore", () => ({ similarUnits: similar }));
const page = "11111111-1111-4111-8111-111111111111";
const line = "22222222-2222-4222-8222-222222222222";
const snapshot = { page: { id: page, title: "Inspections", slug: "inspections" }, pages: [], sections: [], lines: [{ line_id: line, content: "Inspections occur weekly.", author: "ai" }] };
beforeEach(() => {
  vi.clearAllMocks();
  chat.mockReset();
  chat.mockResolvedValue({ value: { summary: "Reviewed", edits: [], findings: [] }, model: "test", tokensIn: 1, tokensOut: 1 });
  similar.mockResolvedValue([{ revisionId: line, content: "Related claim" }]);
});
function database() {
  const call = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "page_review_snapshot") return snapshot;
    if (name === "page_review_related") return [{ content: "Related claim", passages: [{ text: "Supporting evidence" }] }];
    if (name === "complete_page_review") return { summary: "Reviewed", edits: (args?.p_edits as unknown[]).length, exceptions: 0, changeSetId: null };
    if (name === "pages_needing_editorial_review") return [];
    throw new Error(name);
  });
  return { db: { call: call as DbRpc["call"] }, call };
}
describe("review workflow", () => {
  it("retries a provider context-limit error with smaller payloads, without saving the failed attempt", async () => {
    const { db, call } = database();
    const large = { ...snapshot, lines: Array.from({ length: 6 }, (_, i) => ({ line_id: String(i), author: "ai", content: "Review this sentence. ".repeat(700) })) };
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
    chat.mockResolvedValueOnce({ value: { summary: "Consolidate", edits: [edit], findings: [{ operation: "consolidate", quote: "Inspections occur weekly.", guideline: "Repetition", reason: "Repeated", recommendation: "Shorten the lead", destinationId: page, decisionKind: null, decisionQuestion: null }] }, model: "test" });
    await runPageReview(db, { apiKey: "test" }, page);
    expect(chat).toHaveBeenCalledTimes(1);
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
    const large = { ...snapshot, lines: [0, 1, 2].map((i) => ({ line_id: `${i}`, author: "ai", content: "A long paragraph. ".repeat(5500) })) };
    call.mockImplementation(async (name) => name === "page_review_snapshot" ? large : { summary: "Reviewed", edits: 0, exceptions: 0, changeSetId: null });
    await runPageReview(db, { apiKey: "test" }, page);
    expect(chat.mock.calls.length).toBeGreaterThan(1);
    expect(call.mock.calls.filter(([name]) => name === "complete_page_review")).toHaveLength(1);
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_snapshot: large, p_review: expect.objectContaining({ summary: expect.stringContaining("cross-section structure was not assessed") }), p_trace: expect.objectContaining({ tokensIn: chat.mock.calls.length }) }));
  });

  it("saves nothing if a later batch fails", async () => {
    const { db, call } = database();
    const large = { ...snapshot, lines: [0, 1, 2].map((i) => ({ line_id: `${i}`, author: "ai", content: "A long paragraph. ".repeat(5500) })) };
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
    expect(chat.mock.calls[0]![1].messages[1].content).toContain("Supporting evidence");
    expect(chat.mock.calls[0]![1].reasoningEffort).toBe("low");
    expect(call).toHaveBeenCalledWith("complete_page_review", expect.objectContaining({ p_edits: [], p_review: expect.objectContaining({ findings: [] }) }));
  });
  it("rejects fabricated edit targets before making database changes", async () => {
    chat.mockResolvedValue({ value: { summary: "Edited", findings: [], edits: [{ type: "revise_line", targetId: page, text: "Invalid", reason: "test" }] } });
    const { db, call } = database();
    await expect(runPageReview(db, { apiKey: "test" }, page)).rejects.toThrow(/current AI-authored/);
    expect(call.mock.calls.some(([name]) => name === "complete_page_review")).toBe(false);
  });
  it("does not call the model when the database returns no pages needing review", async () => {
    const { db } = database();
    await reviewRebuiltSections(db, { apiKey: "test" }, [line]);
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
});
