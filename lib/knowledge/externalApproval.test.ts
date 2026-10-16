import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJson } from "@/lib/ai/chat";
import { approveExternalSearch, approveExternalSource, type ExternalProjectContext } from "./externalApproval";
vi.mock("@/lib/ai/chat", () => ({ chatJson: vi.fn() }));

const context: ExternalProjectContext = { organization: "Utilitek", article: "Health and safety", section: "WHMIS", sourceTitles: ["Utilitek safety manual"], projectFacts: ["Utilitek requires WHMIS training."], existingKnowledge: ["Utilitek requires WHMIS training."] };
const settings = { apiKey: "test", skills: { plan_articles: { id: "custom", name: "Custom", instructions: "RESEARCHER_INSTRUCTION_CANARY", version: 1 } } };
const research = { needed: true, gap: "Meaning of a safety data sheet", justification: "The manual uses SDS without defining it.", query: "WHMIS safety data sheet definition" };
const excerpt = "A safety data sheet provides detailed information about a hazardous product.";
const source = { title: "WHMIS reference", url: "https://example.org/whmis", text: `${excerpt}\nBuy our unrelated training course.` };
const mock = vi.mocked(chatJson);
const answer = (value: object) => ({ value, model: "test-model", tokensIn: 1, tokensOut: 1 });
beforeEach(() => vi.resetAllMocks());

describe("independent external research approval", () => {
  it("uses saved role instructions independently and records the actual policies", async () => {
    mock.mockResolvedValueOnce(answer(research)).mockResolvedValueOnce(answer({ approved: false, reason: "Already covered." }));
    const record = vi.fn().mockResolvedValue("review");
    await approveExternalSearch({ ...settings, roleInstructions: [
      { role: "researcher", instructions: "Custom researcher", version: 1 },
      { role: "reviewer", instructions: "Custom reviewer", version: 1 },
    ] }, context, "", record);
    expect(mock.mock.calls[0]![1].messages[0]!.content).toBe("Custom researcher");
    expect(mock.mock.calls[1]![1].messages[0]!.content).toBe("Custom reviewer");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ attribution: expect.objectContaining({ instructions: { proposer: "Custom researcher", reviewer: "Custom reviewer" } }) }));
  });
  it("preserves separate proposer and reviewer models and role policies", async () => {
    mock.mockResolvedValueOnce({ ...answer(research), model: "research-model" }).mockResolvedValueOnce({ ...answer({ approved: false, reason: "Already covered." }), model: "review-model" });
    const record = vi.fn().mockResolvedValue("review");
    await approveExternalSearch(settings, context, "", record);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ attribution: expect.objectContaining({
      proposedBy: { role: "researcher", model: "research-model" },
      decidedBy: { role: "reviewer", model: "review-model" },
      instructions: { proposer: mock.mock.calls[0]![1].messages[0]!.content, reviewer: mock.mock.calls[1]![1].messages[0]!.content },
    }) }));
  });

  it("records usage from all provider attempts, including retries", async () => {
    mock.mockImplementationOnce(async (settings) => {
      const call = { purpose: "test", subject: null, model: "test-model", reasoningEffort: "none", promptTokens: 12, completionTokens: 3, reasoningTokens: null, durationMs: 1, status: "cut_off" as const, error: null };
      await settings.logCall?.(call);
      await settings.logCall?.({ ...call, promptTokens: 14, completionTokens: 5, status: "ok" });
      return answer(research);
    }).mockImplementationOnce(async (settings) => {
      await settings.logCall?.({ purpose: "test", subject: null, model: "test-model", reasoningEffort: "none", promptTokens: 20, completionTokens: 6, reasoningTokens: null, durationMs: 1, status: "ok", error: null });
      return answer({ approved: false, reason: "Already covered." });
    });
    const record = vi.fn().mockResolvedValue("review");
    await approveExternalSearch(settings, context, "", record);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ tokensIn: 46, tokensOut: 14 }));
  });

  it("gives the final reviewer project facts but no researcher instructions, skills, or editorial note", async () => {
    mock.mockResolvedValueOnce(answer(research)).mockResolvedValueOnce(answer({ approved: false, reason: "Already covered by saved knowledge." }));
    const record = vi.fn().mockResolvedValue("review");
    expect(await approveExternalSearch(settings, context, "EDITORIAL_NOTE_CANARY", record)).toBeNull();
    const [reviewerSettings, request] = mock.mock.calls[1]!;
    expect(reviewerSettings.skills).toBeUndefined();
    expect(request.messages).toHaveLength(2);
    const messages = JSON.stringify(request.messages);
    expect(messages).toContain("Utilitek safety manual");
    expect(messages).not.toContain("RESEARCHER_INSTRUCTION_CANARY");
    expect(messages).not.toContain("EDITORIAL_NOTE_CANARY");
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "rejected", stage: "search" }));
  });
  it("blocks research without internally sourced project context", async () => {
    const record = vi.fn().mockResolvedValue("review");
    expect(await approveExternalSearch(settings, { ...context, projectFacts: [] }, "", record)).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });
  it("has the independent approver make the final call even when the researcher sees no gap", async () => {
    mock.mockResolvedValueOnce(answer({ needed: false, gap: "", justification: "Already covered.", query: "" })).mockResolvedValueOnce(answer({ approved: false, reason: "The original manual already provides the needed evidence." }));
    const record = vi.fn().mockResolvedValue("review");
    expect(await approveExternalSearch(settings, context, "", record)).toBeNull();
    expect(mock).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ reason: "The original manual already provides the needed evidence.", model: "test-model", tokensIn: 2, tokensOut: 2 }));
  });
  it("rejects a source when the independent approver rejects the researcher's argument", async () => {
    mock.mockResolvedValueOnce(answer({ justification: "It fills the gap.", excerpts: [excerpt] })).mockResolvedValueOnce(answer({ approved: false, reason: "Not needed for this project's scope.", excerptIndices: [0] }));
    expect(await approveExternalSource(settings, context, research, source, vi.fn().mockResolvedValue("review"))).toBeNull();
  });
  it("still asks the independent source approver when the researcher proposes no usable excerpts", async () => {
    mock.mockResolvedValueOnce(answer({ justification: "No relevant evidence.", excerpts: [] })).mockResolvedValueOnce(answer({ approved: false, reason: "There is no evidence to admit.", excerptIndices: [] }));
    const record = vi.fn().mockResolvedValue("review");
    expect(await approveExternalSource(settings, context, research, source, record)).toBeNull();
    expect(mock).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ reason: "There is no evidence to admit." }));
  });
  it("admits only verbatim excerpts explicitly selected by the final approver", async () => {
    const second = "WHMIS is a Canadian system for communicating workplace hazards.";
    mock.mockResolvedValueOnce(answer({ justification: "Adds a definition.", excerpts: [excerpt, second, "Invented evidence that was never part of the downloaded page."] })).mockResolvedValueOnce(answer({ approved: true, reason: "Only the SDS definition fills the gap.", excerptIndices: [0, 0, 999] }));
    const result = await approveExternalSource(settings, context, research, { ...source, text: source.text + second }, vi.fn().mockResolvedValue("saved-review"));
    expect(result).toEqual({ text: excerpt, reviewId: "saved-review" });
    expect(JSON.stringify(mock.mock.calls[1]![1].messages)).not.toContain("Invented evidence");
  });
  it("fails closed when approval has no valid evidence or the reviewer fails", async () => {
    mock.mockResolvedValueOnce(answer({ justification: "Useful", excerpts: [excerpt] })).mockResolvedValueOnce(answer({ approved: true, reason: "Useful", excerptIndices: [999] }));
    expect(await approveExternalSource(settings, context, research, source, vi.fn().mockResolvedValue("review"))).toBeNull();
    mock.mockResolvedValueOnce(answer({ justification: "Useful", excerpts: [excerpt] })).mockRejectedValueOnce(new Error("Reviewer unavailable"));
    const record = vi.fn().mockResolvedValue("review");
    expect(await approveExternalSource(settings, context, research, source, record)).toBeNull();
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "error" }));
  });
  it("cannot admit a source when recording the final decision fails", async () => {
    mock.mockResolvedValueOnce(answer({ justification: "Useful", excerpts: [excerpt] })).mockResolvedValueOnce(answer({ approved: true, reason: "Fills the gap.", excerptIndices: [0] }));
    await expect(approveExternalSource(settings, context, research, source, vi.fn().mockRejectedValue(new Error("Audit unavailable")))).rejects.toThrow("Audit unavailable");
  });
});
