import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJson } from "@/lib/ai/chat";
import type { ArticleKnowledge, ArticlePlan } from "@/lib/living-page/articlePlan";
import { roleForPurpose } from "@/lib/ai/roles";
import { buildOutline, draftSchema, OutlineRejectedError, reviewPasses, reviewTotal, structuralProblems, type OutlineReview } from "./outlineBuilder";

vi.mock("@/lib/ai/chat", async (original) => ({ ...(await original<typeof import("@/lib/ai/chat")>()), chatJson: vi.fn() }));
const knowledge: ArticleKnowledge = { entity: { id: "school", key: "school", name: "School colors", type: "concept" }, units: [
  { unitId: "definition", revisionId: "r1", content: "School colors identify schools.", kind: "fact", epistemicStatus: "supported" },
  { unitId: "origin", revisionId: "r2", content: "Cambridge adopted blue in 1836.", kind: "fact", epistemicStatus: "supported" },
  { unitId: "uniforms", revisionId: "r3", content: "Sports teams wear school colors.", kind: "fact", epistemicStatus: "supported" },
] };
const good: ArticlePlan = { title: "School colors", introduction: ["C1"], sections: [{ title: "Origins of school colors", claims: ["C2"] }, { title: "School colors in sports", claims: ["C3"] }] };
const review = (score = 4): OutlineReview => {
  const grade = () => ({ score, reason: "Specific evidence checked." });
  return { grounding: grade(), cohesion: grade(), flow: grade(), headings: grade(), balance: grade(), introduction: grade(), blockingIssues: [], fixes: [] };
};
const answer = (value: unknown) => ({ value, model: "test", tokensIn: 10, tokensOut: 20 });
const draft = (plan = good) => ({ plan, centralMessage: "School colors express institutional identity.", readingOrderRationale: "Definition, origins, then uses." });
beforeEach(() => vi.clearAllMocks());

describe("outline structure gates", () => {
  it("accepts sparse evidence without padding to three sections", () => {
    expect(structuralProblems(good, knowledge)).toEqual([]);
  });
  it("has no preferred count or inherited twelve-section ceiling in the sandbox", () => {
    const many = { ...good, sections: Array.from({ length: 14 }, (_, i) => ({ title: `Supported topic ${i + 1}`, claims: [`C${i + 2}`] })) };
    expect(draftSchema.safeParse(draft(many)).success).toBe(true);
  });
  it("requires bare claim references rather than prose with a citation appended", () => {
    expect(draftSchema.safeParse(draft({ ...good, introduction: ["School colors identify schools (C1)."] })).success).toBe(false);
  });
  it("rejects duplicate claims even though the existing section converter silently deduplicates them", () => {
    expect(structuralProblems({ ...good, sections: [{ title: "Origins", claims: ["C1", "C2", "C3", "C3"] }] }, knowledge).filter((p) => p.includes("appears"))).toHaveLength(2);
  });
  it("rejects omissions and unknown evidence", () => {
    expect(structuralProblems({ ...good, sections: [{ title: "Origins", claims: ["C2"] }] }, knowledge).join(" ")).toContain("omitted");
    expect(structuralProblems({ ...good, introduction: ["C99"] }, knowledge).join(" ")).toContain("unknown claim");
  });
  it("rejects generic headings and repeated section names", () => {
    expect(structuralProblems({ ...good, sections: [{ title: "Step one", claims: ["C2"] }, { title: "Other", claims: ["C3"] }] }, knowledge)).toHaveLength(2);
    expect(structuralProblems({ ...good, sections: [{ title: "Origins", claims: ["C2"] }, { title: "Origins", claims: ["C3"] }] }, knowledge).join(" ")).toContain("repeated");
  });
  it("keeps composite members with the parent, including introduction assignments", () => {
    const linked = { ...knowledge, units: knowledge.units.map((u, i) => i === 2 ? { ...u, memberOf: "origin" } : u) };
    expect(structuralProblems(good, linked).join(" ")).toContain("C3 must stay with its parent C2");
  });
  it("does not let a high total conceal one weak dimension or a blocking issue", () => {
    const r = review();
    r.flow.score = 2;
    expect(reviewTotal(r)).toBe(22);
    expect(reviewPasses(r)).toBe(false);
    expect(reviewPasses({ ...review(), blockingIssues: ["C2 is under the wrong heading"] })).toBe(false);
    expect(reviewPasses(review(3))).toBe(false); // 18/24 is below the fixed acceptance threshold.
  });
});

describe("outline review and repair", () => {
  it("repairs valid but semantically bad structure using specific reviewer feedback", async () => {
    const bad = { ...good, sections: [...good.sections].reverse() };
    const critique = { ...review(2), blockingIssues: ["Origins must precede uses"], fixes: ["Move C2 before C3"] };
    vi.mocked(chatJson).mockResolvedValueOnce(answer(critique)).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    const built = await buildOutline({ apiKey: "test" }, knowledge, { seed: bad });
    expect(built.attempts.map((a) => a.accepted)).toEqual([false, true]);
    expect(built.tokensIn).toBe(30);
    expect(built.tokensOut).toBe(60);
    expect(JSON.stringify(vi.mocked(chatJson).mock.calls[1]?.[1].messages)).toContain("Move C2 before C3");
    const reviewInput = JSON.parse(String(vi.mocked(chatJson).mock.calls[2]?.[1].messages[1]?.content));
    expect(reviewInput).not.toHaveProperty("centralMessage");
    expect(reviewInput).not.toHaveProperty("readingOrderRationale");
  });
  it("skips AI approval for invalid references and repairs against deterministic feedback", async () => {
    const invalid = { ...good, introduction: ["C900"] };
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    const built = await buildOutline({ apiKey: "test" }, knowledge, { seed: invalid });
    expect(built.attempts[0]?.review).toBeNull();
    expect(vi.mocked(chatJson).mock.calls[0]?.[1].name).toBe("article_outline");
    expect(built.attempts.at(-1)?.accepted).toBe(true);
  });
  it("stops and retains the rejected attempts instead of accepting a bad last outline", async () => {
    vi.mocked(chatJson).mockResolvedValueOnce(answer(review(1))).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review(1)));
    try {
      await buildOutline({ apiKey: "test" }, knowledge, { seed: good, maxAttempts: 2 });
      expect.unreachable("Must reject");
    } catch (error) {
      expect(error).toBeInstanceOf(OutlineRejectedError);
      expect((error as OutlineRejectedError).attempts).toHaveLength(2);
      expect((error as OutlineRejectedError).usage).toEqual({ tokensIn: 30, tokensOut: 60 });
    }
    expect(chatJson).toHaveBeenCalledTimes(3);
  });
  it("preserves live logging, routing and role settings for both planner and reviewer calls", async () => {
    const logCall = vi.fn();
    const memoryDb = { call: vi.fn() };
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    await buildOutline({ apiKey: "test", logCall, memoryDb, roleInstructions: [], roleRoutes: {}, roleEfforts: {} }, knowledge);
    for (const [settings] of vi.mocked(chatJson).mock.calls) {
      expect(settings).toHaveProperty("logCall", logCall);
      expect(settings).toHaveProperty("memoryDb", memoryDb);
      expect(settings).toHaveProperty("roleRoutes");
    }
    expect(logCall).not.toHaveBeenCalled();
    expect(roleForPurpose("article_outline")).toBe("plan_articles");
    expect(roleForPurpose("article_outline_review")).toBe("reviewer");
  });
  it("uses the primary agent's editorial audit to force a revision even when the seed passed AI review", async () => {
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    const built = await buildOutline({ apiKey: "test" }, knowledge, { seed: good, editorialNote: "Keep related applications adjacent and use neutral headings." });
    expect(built.attempts[0]?.accepted).toBe(false);
    expect(built.attempts[0]?.review).toBeNull();
    expect(built.attempts[0]?.problems.join(" ")).toContain("Direct editorial audit");
    expect(vi.mocked(chatJson).mock.calls[0]?.[1].name).toBe("article_outline");
    const messages = vi.mocked(chatJson).mock.calls[0]?.[1].messages;
    expect(JSON.stringify(messages)).toContain("not additional factual evidence");
    expect(built.attempts.at(-1)?.accepted).toBe(true);
  });
  it("preserves proper names when the source spells out only their abbreviation", async () => {
    const named = { ...good, sections: [{ title: "School colors in the United States", claims: ["C2", "C3"] }] };
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft(named))).mockResolvedValueOnce(answer(review()));
    const built = await buildOutline({ apiKey: "test" }, knowledge);
    expect(built.plan.sections[0]?.title).toBe("School colors in the United States");
  });
  it("does not invent an outline for empty knowledge or an unbounded repair budget", async () => {
    await expect(buildOutline({ apiKey: "test" }, { ...knowledge, units: [] })).rejects.toThrow("No knowledge");
    await expect(buildOutline({ apiKey: "test" }, knowledge, { maxAttempts: 100 })).rejects.toThrow("1-6");
    expect(chatJson).not.toHaveBeenCalled();
  });
});
