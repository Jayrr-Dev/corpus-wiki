import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_TOKEN_BUDGET, chatJson, CompletionLengthError, type ChatMessage } from "@/lib/ai/chat";
import type { ArticleKnowledge, ArticlePlan } from "@/lib/living-page/articlePlan";
import { roleForPurpose } from "@/lib/ai/roles";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import { buildOutline, claimInput, draftSchema, OutlineRejectedError, reviewPasses, reviewTotal, structuralProblems, type OutlineReview } from "./outlineBuilder";

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

// Persist only finished steps, with the same JSONB object ordering on reload.
function persistedPlanning() {
  const saved = new Map<string, unknown>();
  const jsonb = (value: unknown): unknown => Array.isArray(value) ? value.map(jsonb)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, jsonb(item)])) : value;
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    const key = String(args.p_key);
    if (name === "start_upload_step") return { done: saved.has(key), output: saved.get(key) } as T;
    if (name === "finish_upload_step" && args.p_error === null) saved.set(key, jsonb(args.p_output));
    return undefined as T;
  } };
  return (input = knowledge, options: Parameters<typeof buildOutline>[2] = {}) => uploadExecution.run({ eventId: "upload", token: "lease", db }, () => buildOutline({ apiKey: "test" }, input, options));
}

describe("durable outline continuation", () => {
  it("allows bounded fresh repairs after every exhausted resume while preserving all rejections", async () => {
    const resume = persistedPlanning();
    const critique = { ...review(2), blockingIssues: ["C2 still needs its evidence-led home"], fixes: ["Move the whole claim"] };
    vi.mocked(chatJson).mockImplementation(async (_settings, request) => answer(request.name === "article_outline" ? draft() : critique));
    for (const total of [2, 4]) {
      vi.mocked(chatJson).mockClear();
      try {
        await resume(knowledge, { maxAttempts: 2 });
        expect.unreachable("Rejected plans must not be accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(OutlineRejectedError);
        expect((error as OutlineRejectedError).attempts).toHaveLength(total);
        expect((error as OutlineRejectedError).attempts.every(attempt => !attempt.accepted)).toBe(true);
      }
      expect(chatJson).toHaveBeenCalledTimes(4);
    }
    vi.mocked(chatJson).mockClear().mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    const built = await resume(knowledge, { maxAttempts: 2 });
    expect(built.attempts).toHaveLength(5);
    expect(built.attempts.at(-1)?.accepted).toBe(true);
    expect(chatJson).toHaveBeenCalledTimes(2);
    const finalReview = vi.mocked(chatJson).mock.calls[1]![1];
    expect(JSON.parse(String(finalReview.messages[2]!.content)).priorReviewFindings).toHaveLength(4);
    vi.mocked(chatJson).mockClear();
    expect((await resume()).attempts.at(-1)?.accepted).toBe(true);
    expect(chatJson).not.toHaveBeenCalled();
  });
  it("still rejects the outline when the extended repair budget is exhausted", async () => {
    vi.mocked(chatJson).mockImplementation(async (_settings, request) => answer(request.name === "article_outline" ? draft() : {
      ...review(2), blockingIssues: ["A material topic mismatch remains"], fixes: ["Correct the misplaced claim"],
    }));
    let failure: unknown;
    try { await buildOutline({ apiKey: "test" }, knowledge); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(OutlineRejectedError);
    expect((failure as OutlineRejectedError).attempts).toHaveLength(6);
    expect((failure as OutlineRejectedError).attempts.every(attempt => !attempt.accepted)).toBe(true);
    expect(chatJson).toHaveBeenCalledTimes(12);
  });
  it("continues beyond four saved rejections without redrafting or accepting them", async () => {
    const resume = persistedPlanning();
    const critique = { ...review(2), blockingIssues: ["Move C2 to the origins section"], fixes: ["Preserve the other sections"] };
    for (let index = 0; index < 4; index++) vi.mocked(chatJson).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(critique));
    await expect(resume(knowledge, { maxAttempts: 4 })).rejects.toBeInstanceOf(OutlineRejectedError);
    vi.mocked(chatJson).mockClear().mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    const built = await resume();
    expect(built.attempts).toHaveLength(5);
    expect(built.attempts.slice(0, 4).every(attempt => !attempt.accepted)).toBe(true);
    expect(built.attempts[4]?.accepted).toBe(true);
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(chatJson).mock.calls[0]?.[1].messages)).toContain("Move C2 to the origins section");
  });
  it("resumes a cut-off draft with room for the complete outline and still requires review", async () => {
    const resume = persistedPlanning();
    vi.mocked(chatJson).mockRejectedValueOnce(new CompletionLengthError(27209, 8000, "test", 8000));
    await expect(resume()).rejects.toBeInstanceOf(CompletionLengthError);
    vi.mocked(chatJson).mockClear().mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    expect((await resume()).attempts[0]?.accepted).toBe(true);
    const requests = vi.mocked(chatJson).mock.calls.map(call => call[1]);
    expect(requests.map(request => request.name)).toEqual(["article_outline", "article_outline_review"]);
    expect(requests[0]?.maxTokens).toBe(ANSWER_TOKEN_BUDGET);
    expect(requests[0]?.maxTokens).toBeGreaterThan(8000);
    expect(requests[1]?.maxTokens).toBe(ANSWER_TOKEN_BUDGET);
  });

  it("resumes a cut-off review without discarding its saved complete draft", async () => {
    const resume = persistedPlanning();
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft()))
      .mockRejectedValueOnce(new CompletionLengthError(12000, 6000, "test", 6000));
    await expect(resume()).rejects.toBeInstanceOf(CompletionLengthError);
    vi.mocked(chatJson).mockClear().mockResolvedValueOnce(answer(review()));
    expect((await resume()).attempts[0]?.accepted).toBe(true);
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chatJson).mock.calls[0]?.[1]).toMatchObject({ name: "article_outline_review", maxTokens: ANSWER_TOKEN_BUDGET });
  });

  it("resumes a saved draft after interruption during review, including JSONB reordering", async () => {
    const resume = persistedPlanning();
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft())).mockRejectedValueOnce(new Error("Server restarted"));
    await expect(resume()).rejects.toThrow("Server restarted");
    vi.mocked(chatJson).mockClear().mockResolvedValueOnce(answer(review()));
    expect((await resume()).plan).toEqual(good);
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chatJson).mock.calls[0]?.[1].name).toBe("article_outline_review");
  });

  it("keeps the rejected draft and reviewer feedback when the repair is interrupted", async () => {
    const resume = persistedPlanning();
    const critique = { ...review(2), blockingIssues: ["Move C2 before C3"], fixes: ["Put origins before uses"] };
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(critique)).mockRejectedValueOnce(new Error("Deadline"));
    await expect(resume()).rejects.toThrow("Deadline");
    vi.mocked(chatJson).mockClear().mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    const built = await resume();
    expect(built.attempts.map(attempt => attempt.accepted)).toEqual([false, true]);
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(chatJson).mock.calls[0]?.[1].messages)).toContain("Put origins before uses");
    const reviewInput = JSON.parse(String(vi.mocked(chatJson).mock.calls[1]?.[1].messages[2]?.content));
    expect(reviewInput.priorReviewFindings).toEqual([{ blockingIssues: critique.blockingIssues, fixes: critique.fixes }]);
    expect(reviewInput.priorReviewFindings[0]).not.toHaveProperty("flow");
  });

  it("does not reuse a plan after its evidence changes", async () => {
    const resume = persistedPlanning();
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    await resume();
    vi.mocked(chatJson).mockClear().mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    await resume({ ...knowledge, units: knowledge.units.map(unit => ({ ...unit, revisionId: `${unit.revisionId}-new` })) });
    expect(chatJson).toHaveBeenCalledTimes(2);
  });
});
const draft = (plan = good) => ({ plan, centralMessage: "School colors express institutional identity.", readingOrderRationale: "Definition, origins, then uses." });
beforeEach(() => vi.clearAllMocks());

describe("outline structure gates", () => {
  it("passes source sequence positions separately from arbitrary claim reference numbers", () => {
    const input = { ...knowledge, units: [knowledge.units[0]!,
      { ...knowledge.units[1]!, memberOf: "definition", position: 2 },
      { ...knowledge.units[2]!, memberOf: "definition", position: 1 },
    ] };
    expect(claimInput(input).claims.slice(1)).toEqual([
      expect.objectContaining({ ref: "C2", stepOf: "C1", step: 2 }),
      expect.objectContaining({ ref: "C3", stepOf: "C1", step: 1 }),
    ]);
  });
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
  it("keeps concrete background-practice headings while rejecting a bare background label", () => {
    const plan = { ...good, sections: [{ title: "Background practices for type groups", claims: ["C2", "C3"] }] };
    expect(structuralProblems(plan, knowledge)).toEqual([]);
    expect(structuralProblems({ ...plan, sections: [{ ...plan.sections[0]!, title: "Background" }] }, knowledge)).toContain('"Background" is a vague or introductory heading; name its actual topic.');
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
    expect(reviewPasses(review(3))).toBe(true); // Every dimension is sound under the rubric.
  });
});

describe("outline review and repair", () => {
  it("lets a person's approval stand in for the independent review", async () => {
    const built = await buildOutline({ apiKey: "test" }, knowledge, { seed: good, skipReview: true });
    expect(built.attempts).toEqual([expect.objectContaining({ accepted: true, review: null })]);
    expect(chatJson).not.toHaveBeenCalled();
  });
  it("gives later reviews the earlier findings without allowing them to override a new rejection", async () => {
    const first = { ...review(2), blockingIssues: ["Move C2 to origins"], fixes: ["Keep C3 in sports"] };
    const second = { ...review(2), blockingIssues: ["C3 still has a misleading heading"], fixes: ["Rename the sports heading"] };
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(first))
      .mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(second))
      .mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    const built = await buildOutline({ apiKey: "test" }, knowledge);
    expect(built.attempts.map(attempt => attempt.accepted)).toEqual([false, false, true]);
    const requests = vi.mocked(chatJson).mock.calls.filter(call => call[1].name === "article_outline_review").map(call => call[1]);
    expect(JSON.parse(String(requests[0]?.messages[2]?.content))).not.toHaveProperty("priorReviewFindings");
    expect(JSON.parse(String(requests[2]?.messages[2]?.content)).priorReviewFindings).toEqual([first, second].map(({ blockingIssues, fixes }) => ({ blockingIssues, fixes })));
    expect(String(requests[2]?.messages[0]?.content)).toContain("prior review never entitles a plan to approval");
  });
  it("repairs valid but semantically bad structure using specific reviewer feedback", async () => {
    const bad = { ...good, sections: [...good.sections].reverse() };
    const critique = { ...review(2), blockingIssues: ["Origins must precede uses"], fixes: ["Move C2 before C3"] };
    vi.mocked(chatJson).mockResolvedValueOnce(answer(critique)).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    const built = await buildOutline({ apiKey: "test" }, knowledge, { seed: bad });
    expect(built.attempts.map((a) => a.accepted)).toEqual([false, true]);
    expect(built.tokensIn).toBe(30);
    expect(built.tokensOut).toBe(60);
    expect(JSON.stringify(vi.mocked(chatJson).mock.calls[1]?.[1].messages)).toContain("Move C2 before C3");
    const reviewInput = JSON.parse(String(vi.mocked(chatJson).mock.calls[2]?.[1].messages[2]?.content));
    expect(reviewInput).not.toHaveProperty("centralMessage");
    expect(reviewInput).not.toHaveProperty("readingOrderRationale");
  });
  it("drops repeated claims without a paid repair, the introduction keeping its copy", async () => {
    const repeated = { ...good, introduction: ["C1", "C2"], sections: [{ title: "Origins of school colors", claims: ["C2"] }, { title: "School colors in sports", claims: ["C3", "C1", "C3"] }] };
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft(repeated))).mockResolvedValueOnce(answer(review()));
    const built = await buildOutline({ apiKey: "test" }, knowledge);
    expect(built.plan).toEqual({ ...good, introduction: ["C1", "C2"], sections: [{ title: "School colors in sports", claims: ["C3"] }] });
    expect(vi.mocked(chatJson).mock.calls.map(call => call[1].name)).toEqual(["article_outline", "article_outline_review"]);
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
  it("gives the independent reviewer the same approved scope and evidence limits as the planner", async () => {
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    const subject = "School colors. Scope: recorded origins and sporting uses only.";
    await buildOutline({ apiKey: "test" }, knowledge, { subject });
    const request = vi.mocked(chatJson).mock.calls[1]![1];
    expect(JSON.parse(String(request.messages[1]!.content))).toMatchObject({ articleSubject: subject });
    expect(JSON.parse(String(request.messages[2]!.content))).toEqual({ plan: good });
    expect(String(request.messages[0]!.content)).toContain("Do not demand definitions");
    expect(String(request.messages[0]!.content)).toContain("must NOT be repeated");
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

describe("outline prompt caching", () => {
  it("sends the unchanged claims first and cached in every draft and review attempt", async () => {
    const critique = { ...review(2), blockingIssues: ["Move C2 to origins"], fixes: ["Keep C3 in sports"] };
    const replies = [draft(), critique, draft(), review()];
    // The draft's message list grows after each call, so keep each request as it was sent.
    const requests: { name: string; messages: ChatMessage[] }[] = [];
    vi.mocked(chatJson).mockImplementation(async (_settings, request) => {
      requests.push({ name: request.name, messages: request.messages.map(message => ({ ...message }) as ChatMessage) });
      return answer(replies.shift());
    });
    await buildOutline({ apiKey: "test" }, knowledge, { subject: "School colors" });
    const drafts = requests.filter(request => request.name === "article_outline");
    const reviews = requests.filter(request => request.name === "article_outline_review");
    // Drafts: the repair is appended after the cached claims, which stay word for word the same.
    expect(drafts[0]!.messages.map(message => [message.role, message.cache === true])).toEqual([["system", false], ["user", true]]);
    expect(drafts[1]!.messages.map(message => [message.role, message.cache === true])).toEqual([["system", false], ["user", true], ["user", false]]);
    expect(drafts[1]!.messages[1]).toEqual(drafts[0]!.messages[1]);
    // Reviews: cached claims and subject, then the plan and earlier findings.
    for (const request of reviews) {
      expect(request.messages.map(message => [message.role, message.cache === true])).toEqual([["system", false], ["user", true], ["user", false]]);
      expect(Object.keys(JSON.parse(String(request.messages[1]!.content)))).toEqual(["subject", "claims", "articleSubject"]);
    }
    expect(reviews[1]!.messages[1]).toEqual(reviews[0]!.messages[1]);
    expect(Object.keys(JSON.parse(String(reviews[1]!.messages[2]!.content)))).toEqual(["plan", "priorReviewFindings"]);
  });
  it("keeps the saved attempt keys of uploads planned before caching", async () => {
    const keys: string[] = [];
    const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
      if (name === "start_upload_step") keys.push(String(args.p_key));
      return (name === "start_upload_step" ? { done: false } : undefined) as T;
    } };
    vi.mocked(chatJson).mockResolvedValueOnce(answer(draft())).mockResolvedValueOnce(answer(review()));
    await uploadExecution.run({ eventId: "upload", token: "lease", db }, () => buildOutline({ apiKey: "test" }, knowledge, { subject: "School colors" }));
    expect(keys.map(key => key.replace(/:\d+:.*$/, ""))).toEqual([PRE_CACHE_CHECKPOINT, PRE_CACHE_CHECKPOINT]);
  });
});
// The checkpoint this input produced before messages carried a cache flag.
const PRE_CACHE_CHECKPOINT = "outline-v1:bce9d257f03ff3f81ae364b4b74f6ab8e1e625e5f64b06f42c0d6cfd3cf99667";
