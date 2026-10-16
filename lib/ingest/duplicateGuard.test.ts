import type { KnowledgeContext } from "@/lib/knowledge/context";
import { describe, expect, it, vi } from "vitest";
import type { JudgeDecision, JudgeRequest } from "@/lib/ai/tokenFactory/duplicateJudge";
import type { DraftAction, DraftChangeSet, ReconciliationInput } from "@/lib/ai/types";
import { type GuardDeps, guardDuplicates } from "./duplicateGuard";

// =====================================================================
// FIXTURE: the store holds the discipline rule (u1) and a PPE rule (u2).
// A file is read again: it repeats u1, rewords u2 with a detail, adds one
// new claim, and the new claim appears twice in the file.
// =====================================================================

const context: KnowledgeContext = {
  entities: [{ type: "company", key: "utilitek", role: "subject" }],
  applicability: { status: "scoped", entities: [{ type: "company", key: "utilitek" }], conditions: null },
};

const DISCIPLINE = "Utilitek Solutions Inc. treats fighting, theft and willful endangerment as Class A violations that warrant immediate termination.";
const PPE = "Utilitek Solutions Inc. requires hard hats, safety glasses and safety footwear on every job site.";
const NEW = "Utilitek Solutions Inc. holds a documented tailgate meeting before each shift begins.";

const input: ReconciliationInput = {
  source: { id: "s1", title: "program.pdf", sourceDate: "2026-10-01T00:00:00Z" },
  passages: [],
  existingUnits: [
    { unitId: "u1", revisionId: "r1", context, content: DISCIPLINE, kind: "fact", epistemicStatus: "established", sourceDate: "2026-09-01T00:00:00Z", passageIds: ["p-old"] },
    { unitId: "u2", revisionId: "r2", context, content: PPE, kind: "fact", epistemicStatus: "established", sourceDate: "2026-09-01T00:00:00Z", passageIds: ["p-ppe"] },
  ],
  domainPaths: [],
  entities: [],
};

const add = (content: string, passageIds: string[], extra: { entity?: string; domain?: string } = {}): DraftAction => ({
  type: "add_claim",
  targetId: null,
  expectedRevisionId: null,
  passageIds,
  speechAct: "stated",
  input: {
    context, content, kind: "fact", epistemicStatus: "supported", validFrom: "2026-10-01T00:00:00Z",
    entities: extra.entity ? [{ type: "policy", key: extra.entity, role: "subject" }] : [],
    domainPaths: extra.domain ? [extra.domain] : [],
  },
});
const link = (from: number, to: number): DraftAction => ({
  type: "link", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null,
  input: { toUnitId: null, type: "related_to", fromPosition: from, toPosition: to },
});
const create = (key: string): DraftAction => ({
  type: "create_entity", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null,
  input: { type: "policy", key, name: key, aliases: [] },
});
const draftOf = (actions: DraftAction[]): DraftChangeSet => ({ summary: "", actions, trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null } });

// A judge that answers by content: the reworded PPE rule adds a detail to its stored claim
function judge(answers: Record<string, Omit<JudgeDecision, "claim">>) {
  return vi.fn(async (request: JudgeRequest) => new Map(request.claims.flatMap((claim) => {
    const answer = answers[claim.content];
    if (!answer) return [];
    const match = answer.match === "PPE" ? request.known.find((known) => known.content === PPE)?.ref ?? null : answer.match;
    return [[claim.ref, { claim: claim.ref, ...answer, match }]];
  })));
}
const deps = (overrides: Partial<GuardDeps> = {}): GuardDeps => ({
  embedder: null,
  findSimilar: async () => [],
  judge: judge({}),
  warn: () => {},
  ...overrides,
});

const PPE_REWORDED = "Utilitek Solutions Inc. requires hard hats, safety glasses, safety footwear and high-visibility vests on every job site.";
const PPE_MERGED = "Utilitek Solutions Inc. requires hard hats, safety glasses, safety footwear and high-visibility vests on every job site.";

describe("guardDuplicates", () => {
  it("embeds repeated new wording only once", async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
    const result = await guardDuplicates(deps({ embedder: { model: "m", embed } }), { ...input, existingUnits: [] }, draftOf([add(NEW, ["p1"]), add(NEW, ["p2"])]));
    expect(embed).toHaveBeenCalledWith([NEW]);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.passageIds).toEqual(["p1", "p2"]);
  });

  it("preserves independent enrichments of an earlier new claim", async () => {
    const vest = `${PPE} Workers wear vests.`;
    const glove = `${PPE} Workers wear gloves.`;
    const guard = deps({ judge: judge({
      [vest]: { verdict: "adds_detail", match: "N1", content: vest, reason: "vests" },
      [glove]: { verdict: "adds_detail", match: "N1", content: glove, reason: "gloves" },
    }) });
    const result = await guardDuplicates(guard, { ...input, existingUnits: [] }, draftOf([add(PPE, ["p1"]), add(vest, ["p2"]), add(glove, ["p3"])]));
    expect(result.actions).toMatchObject([
      { type: "add_claim", input: { content: vest }, passageIds: ["p1", "p2"] },
      { type: "add_claim", input: { content: glove }, passageIds: ["p3"] },
    ]);
  });
  it("does not embed or search exact stored repeats", async () => {
    const embed = vi.fn(async () => [[1, 0]]);
    const findSimilar = vi.fn(async () => []);
    const result = await guardDuplicates(deps({ embedder: { model: "m", embed }, findSimilar }), input, draftOf([add(DISCIPLINE, ["p1"])]));
    expect(embed).not.toHaveBeenCalled();
    expect(findSimilar).not.toHaveBeenCalled();
    expect(result.summary).toContain("1 existing claims given supporting evidence");
  });

  it("preserves competing additions to a stored claim instead of losing the second detail", async () => {
    const second = `${PPE} Workers must also wear gloves.`;
    const guard = deps({ judge: judge({
      [PPE_REWORDED]: { verdict: "adds_detail", match: "PPE", content: PPE_MERGED, reason: "adds vests" },
      [second]: { verdict: "adds_detail", match: "PPE", content: second, reason: "adds gloves" },
    }) });
    const result = await guardDuplicates(guard, input, draftOf([add(PPE_REWORDED, ["p1"]), add(second, ["p2"])]));
    expect(result.actions).toMatchObject([
      { type: "revise_claim", input: { content: PPE_MERGED } },
      { type: "add_claim", input: { content: second }, passageIds: ["p2"] },
    ]);
    expect(result.summary).toContain("Separate additions were preserved");
  });

  it("reports a failed judge in the saved summary", async () => {
    const result = await guardDuplicates(deps({ judge: async () => { throw new Error("unavailable"); } }), input, draftOf([add(PPE_REWORDED, ["p1"])]));
    expect(result.summary).toContain("Check incomplete");
    expect(result.actions[0]?.type).toBe("add_claim");
  });

  it("ranks word matches before limiting candidates", async () => {
    const content = "Workers inspect red blue green yellow orange purple tools daily";
    const store = Array.from({ length: 6 }, (_, i) => ({
      ...input.existingUnits[0]!, unitId: `rank-${i}`,
      content: i === 5 ? `${content} before use` : "Workers inspect red blue green yellow unrelated equipment monthly",
    }));
    const check = vi.fn(async (request: JudgeRequest) => {
      expect(request.known.map((known) => known.content)).toContain(store[5]!.content);
      return new Map<string, JudgeDecision>();
    });
    await guardDuplicates(deps({ judge: check }), { ...input, existingUnits: store }, draftOf([add(content, ["p1"])]));
    expect(check).toHaveBeenCalledOnce();
  });
  it("turns a word-for-word repeat into a revise that adds the new passages", async () => {
    const guard = deps();
    const result = await guardDuplicates(guard, input, draftOf([add(DISCIPLINE.toLowerCase(), ["p1"])]));
    expect(result.actions).toEqual([expect.objectContaining({
      type: "revise_claim", targetId: "u1", expectedRevisionId: "r1", passageIds: ["p-old", "p1"], input: expect.objectContaining({ content: DISCIPLINE }),
    })]);
    expect(guard.judge).not.toHaveBeenCalled();
  });

  it("drops a rerun's repeat that cites nothing new, and links name the stored unit instead", async () => {
    const result = await guardDuplicates(deps(), input, draftOf([add(DISCIPLINE, ["p-old"]), add(NEW, ["p2"]), link(1, 0)]));
    expect(result.actions.map((action) => action.type)).toEqual(["add_claim", "link"]);
    expect(result.actions[1]).toMatchObject({ targetId: null, input: { fromPosition: 0, toUnitId: "u1" } });
    expect(result.actions[1]!.input).not.toHaveProperty("toPosition");
  });

  it("asks the judge about look-alikes and folds a repeat with a detail into its stored claim", async () => {
    const guard = deps({ judge: judge({ [PPE_REWORDED]: { verdict: "adds_detail", match: "PPE", content: PPE_MERGED, reason: "adds vests" } }) });
    const result = await guardDuplicates(guard, input, draftOf([add(PPE_REWORDED, ["p3"])]));
    expect(guard.judge).toHaveBeenCalledOnce();
    expect(result.actions).toEqual([expect.objectContaining({
      type: "revise_claim", targetId: "u2", passageIds: ["p-ppe", "p3"], input: expect.objectContaining({ content: PPE_MERGED, rationale: "Matches a stored claim: adds vests" }),
    })]);
  });

  it("keeps a claim the judge calls different", async () => {
    const guard = deps({ judge: judge({ [PPE_REWORDED]: { verdict: "different", match: null, content: null, reason: "" } }) });
    const result = await guardDuplicates(guard, input, draftOf([add(PPE_REWORDED, ["p3"])]));
    expect(result.actions).toEqual([expect.objectContaining({ type: "add_claim" })]);
  });

  it("folds a claim the file states twice into its first add and renumbers links", async () => {
    const actions = [create("meetings"), add(NEW, ["p4"], { entity: "meetings" }), add(`${NEW} `, ["p5"]), add(PPE_REWORDED, ["p6"]), link(3, 2)];
    const result = await guardDuplicates(deps(), input, draftOf(actions));
    expect(result.actions.map((action) => action.type)).toEqual(["create_entity", "add_claim", "add_claim", "link"]);
    expect(result.actions[1]).toMatchObject({ passageIds: ["p4", "p5"] });
    expect(result.actions[3]).toMatchObject({ input: { fromPosition: 2, toPosition: 1 } });
  });

  it("drops creates only a folded claim needed", async () => {
    const result = await guardDuplicates(deps(), input, draftOf([create("discipline"), add(DISCIPLINE, ["p1"], { entity: "discipline" })]));
    expect(result.actions.map((action) => action.type)).toEqual(["revise_claim"]);
  });

  it("uses stored look-alikes found by meaning", async () => {
    const embedder = { model: "m", embed: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])) };
    const findSimilar = vi.fn(async () => [{ unitId: "u2", revisionId: "r2", context, content: PPE, similarity: 0.95 }]);
    const guard = deps({ embedder, findSimilar, judge: judge({ "Workers wear protective gear everywhere on site.": { verdict: "same", match: "PPE", content: null, reason: "" } }) });
    const result = await guardDuplicates(guard, input, draftOf([add("Workers wear protective gear everywhere on site.", ["p7"])]));
    expect(findSimilar).toHaveBeenCalledWith([1, 0]);
    expect(result.actions[0]).toMatchObject({ type: "revise_claim", targetId: "u2", input: { content: PPE } });
  });

  it("keeps every claim when the embedder or the judge fails", async () => {
    const warn = vi.fn();
    const failing = deps({
      warn,
      embedder: { model: "m", embed: async () => { throw new Error("down"); } },
      judge: vi.fn(async () => { throw new Error("down"); }),
    });
    const result = await guardDuplicates(failing, input, draftOf([add(PPE_REWORDED, ["p3"])]));
    expect(result.actions).toEqual([expect.objectContaining({ type: "add_claim" })]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("for web pages, drops plain repeats and keeps a repeat with a new detail as its own claim", async () => {
    const guard = deps({ judge: judge({ [PPE_REWORDED]: { verdict: "adds_detail", match: "PPE", content: PPE_MERGED, reason: "" } }) });
    const result = await guardDuplicates(guard, input, draftOf([add(DISCIPLINE, ["p1"]), add(PPE_REWORDED, ["p3"])]), { reviseStored: false });
    expect(result.actions).toEqual([expect.objectContaining({ type: "add_claim", input: expect.objectContaining({ content: PPE_REWORDED }) })]);
  });
});


describe("duplicate context boundaries", () => {
  const withContext = (value: KnowledgeContext | undefined, text = DISCIPLINE) => {
    const action = add(text, ["p-new"]) as Extract<DraftAction, { type: "add_claim" }>;
    return { ...action, input: { ...action.input, context: value } };
  };

  it.each([
    ["different company", { ...context, applicability: { ...context.applicability, entities: [{ type: "company", key: "other" }] } }],
    ["different role", { ...context, entities: [{ type: "company", key: "utilitek", role: "object" }] }],
    ["unspecified scope", { ...context, applicability: { status: "unspecified", entities: [], conditions: null } }],
    ["missing context", undefined],
  ] as [string, KnowledgeContext | undefined][])("keeps identical wording with %s", async (_, other) => {
    const guard = deps();
    const result = await guardDuplicates(guard, input, draftOf([withContext(other)]));
    expect(result.actions[0]?.type).toBe("add_claim");
    expect(guard.judge).not.toHaveBeenCalled();
  });

  it("does not fold two new companies' identical claims", async () => {
    const other: KnowledgeContext = { ...context, applicability: { ...context.applicability, entities: [{ type: "company", key: "other" }] } };
    const result = await guardDuplicates(deps(), { ...input, existingUnits: [] }, draftOf([withContext(context), withContext(other)]));
    expect(result.actions).toHaveLength(2);
  });

  it("keeps unknown scopes separate even when both are missing", async () => {
    const result = await guardDuplicates(deps(), { ...input, existingUnits: [] }, draftOf([withContext(undefined), withContext(undefined)]));
    expect(result.actions).toHaveLength(2);
  });

  it("includes structured context in judge comparisons and resulting evidence revisions", async () => {
    const guard = deps({ judge: judge({ [PPE_REWORDED]: { verdict: "same", match: "PPE", content: null, reason: "same" } }) });
    const result = await guardDuplicates(guard, input, draftOf([withContext(context, PPE_REWORDED)]));
    expect(guard.judge).toHaveBeenCalledWith(expect.objectContaining({
      claims: [expect.objectContaining({ context })], known: expect.arrayContaining([expect.objectContaining({ context })]),
    }));
    expect(result.actions[0]).toMatchObject({ type: "revise_claim", input: { context }, passageIds: ["p-ppe", "p-new"] });
  });
});
