import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import type { ScopeClaim } from "@/lib/knowledge/scope";
import { stubTutor, TUTOR_SETTINGS, writeQuestions } from "./fakeTutor";
import type { ClaimProgress } from "./levels";
import { answerItem, createStudySet, MAX_SET_CLAIMS, newSetSchema, rebuildStaleItems, regenerateItem, type StudyDeps } from "./service";
import type { StudyItemRow, StudySetsData } from "./types";

afterEach(() => vi.unstubAllGlobals());

// =====================================================================
// An in-memory stand-in for the study functions in the migration (the
// SQL itself runs against real Postgres in study.db.test.ts)
// =====================================================================
function fakeStudyDb(units: Map<string, { revisionId: string; content: string; retired?: boolean }>) {
  const sets: { id: string; title: string }[] = [];
  const items: StudyItemRow[] = [];
  const progress = new Map<string, ClaimProgress>();
  const attempts: { itemId: string; userId: string; response: string; result: string; feedback: string | null }[] = [];
  let next = 0;
  const id = () => `id-${++next}`;
  const claim = (unitId: string) => ({ unitId, revisionId: units.get(unitId)!.revisionId, title: null, content: units.get(unitId)!.content, createdAt: "2026-01-01", citedBy: 0 });
  const handlers: Record<string, (args: RpcArgs) => unknown> = {
    create_study_set: (args) => { const set = { id: id(), title: String(args.p_title) }; sets.push(set); return set.id; },
    add_study_items: (args) => {
      for (const item of args.p_items as Omit<StudyItemRow, "id" | "setId" | "stale">[]) items.push({ ...item, id: id(), setId: String(args.p_set_id), stale: false });
      return (args.p_items as unknown[]).length;
    },
    read_study_item: (args) => {
      const item = items.find((row) => row.id === args.p_item_id);
      return item ? { ...item, claim: { title: null, content: `content of ${item.revisionId}` } } : null;
    },
    read_study_progress: (args) => progress.get(`${args.p_user_id}:${args.p_unit_id}`) ?? null,
    record_study_attempt: (args) => {
      const item = items.find((row) => row.id === args.p_item_id)!;
      attempts.push({ itemId: item.id, userId: String(args.p_user_id), response: String(args.p_response), result: String(args.p_result), feedback: (args.p_feedback as string | null) ?? null });
      progress.set(`${args.p_user_id}:${item.unitId}`, args.p_progress as ClaimProgress);
    },
    mark_stale_study_items: () => {
      for (const item of items) if (units.get(item.unitId)?.revisionId !== item.revisionId || units.get(item.unitId)?.retired) item.stale = true;
    },
    read_study_sets: (args): StudySetsData => {
      const inSet = items.filter((item) => !args.p_set_id || item.setId === args.p_set_id);
      return { sets: [], items: inSet, progress: [], claims: [...new Set(inSet.map((item) => item.unitId))].map((unitId) => ({ unitId, title: null, content: units.get(unitId)!.content, retired: !!units.get(unitId)!.retired })) };
    },
    read_study_claims: (args) => (args.p_unit_ids as string[]).filter((unitId) => units.has(unitId) && !units.get(unitId)!.retired).map(claim),
    replace_study_item: (args) => {
      const item = items.find((row) => row.id === args.p_item_id)!;
      Object.assign(item, args.p_item, { stale: false });
    },
  };
  const db: DbRpc = { call: async <T,>(fn: string, args: RpcArgs = {}) => {
    const handler = handlers[fn];
    if (!handler) throw new Error(`Unexpected call ${fn}`);
    return handler(args) as T;
  } };
  return { db, sets, items, progress, attempts };
}

const scopeClaims = (count: number): ScopeClaim[] => Array.from({ length: count }, (_, index) => ({ unitId: `u${index}`, revisionId: `r${index}`, title: null, content: `claim ${index}`, createdAt: "2026-01-01", citedBy: count - index }));
const unitsOf = (claims: ScopeClaim[]) => new Map<string, { revisionId: string; content: string; retired?: boolean }>(claims.map((claim) => [claim.unitId, { revisionId: claim.revisionId, content: claim.content }]));

function deps(db: DbRpc, claims: ScopeClaim[], now = new Date("2026-11-02T09:00:00Z")): StudyDeps {
  return { db, tutor: async () => ({ settings: TUTOR_SETTINGS, instructions: "Tutor rules." }), loadClaims: async () => claims, now: () => now };
}

const newSet = (input: object) => newSetSchema.parse({ title: "Utility separation", scope: { kind: "topic", id: "6f1d1c9e-2f6a-4b1e-9b8a-7f6c5d4e3a21" }, coverage: 100, types: ["flashcard"], ...input });

describe("a new set", () => {
  it("writes the chosen kinds for the most central claims at the chosen coverage, saving each batch", async () => {
    const claims = scopeClaims(12);
    const fake = fakeStudyDb(unitsOf(claims));
    const tutor = stubTutor(writeQuestions);
    const progress: number[] = [];
    const result = await createStudySet(deps(fake.db, claims), "person", newSet({ coverage: 50, types: ["short_answer", "flashcard"] }), (done) => progress.push(done));
    expect(result).toEqual({ id: "id-1", items: 12 });
    // 50% of 12 claims, most cited first; kinds keep the form's order
    expect([...new Set(fake.items.map((item) => item.unitId))]).toEqual(["u0", "u1", "u2", "u3", "u4", "u5"]);
    expect(fake.items.every((item) => item.revisionId === item.unitId.replace("u", "r"))).toBe(true);
    expect(tutor.calls).toHaveLength(1);
    expect(tutor.calls[0]!.data.kinds).toEqual(["flashcard", "short_answer"]);
    expect(progress).toEqual([0, 12]);
  });

  it("covers at most the cap of claims", async () => {
    const claims = scopeClaims(MAX_SET_CLAIMS + 5);
    const fake = fakeStudyDb(unitsOf(claims));
    stubTutor(writeQuestions);
    await createStudySet(deps(fake.db, claims), "person", newSet({}));
    expect(fake.items).toHaveLength(MAX_SET_CLAIMS);
  });

  it("refuses a source with no claims before calling the Tutor", async () => {
    const fake = fakeStudyDb(new Map());
    const tutor = stubTutor(writeQuestions);
    await expect(createStudySet(deps(fake.db, []), "person", newSet({}))).rejects.toThrow("no claims");
    expect(tutor.calls).toHaveLength(0);
    expect(fake.sets).toHaveLength(0);
  });

  it("checks the form", () => {
    expect(newSetSchema.safeParse({ title: "x", scope: { kind: "glossary" }, coverage: 25, types: ["multiple_choice"] }).success).toBe(true);
    expect(newSetSchema.safeParse({ title: "x", scope: { kind: "topic", id: "nope" }, coverage: 25, types: ["flashcard"] }).success).toBe(false);
    expect(newSetSchema.safeParse({ title: "x", scope: { kind: "glossary" }, coverage: 30, types: ["flashcard"] }).success).toBe(false);
    expect(newSetSchema.safeParse({ title: "x", scope: { kind: "glossary" }, coverage: 25, types: [] }).success).toBe(false);
  });
});

describe("answering", () => {
  async function setWith(types: ("flashcard" | "multiple_choice" | "short_answer")[], now?: Date) {
    const claims = scopeClaims(1);
    const fake = fakeStudyDb(unitsOf(claims));
    stubTutor(writeQuestions);
    await createStudySet(deps(fake.db, claims), "person", newSet({ types }));
    return { fake, d: deps(fake.db, claims, now) };
  }

  it("takes the person's word on a flashcard and moves the claim to Familiar", async () => {
    const { fake, d } = await setWith(["flashcard"]);
    const outcome = await answerItem(d, "person", { itemId: fake.items[0]!.id, result: "right" });
    expect(outcome).toMatchObject({ result: "right", feedback: null, progress: { unitId: "u0", level: 1, dueAt: "2026-11-03T09:00:00.000Z" } });
    expect(fake.attempts).toEqual([{ itemId: fake.items[0]!.id, userId: "person", response: "right", result: "right", feedback: null }]);
  });

  it("checks multiple choice against the stored answer, not the browser", async () => {
    const { fake, d } = await setWith(["multiple_choice"]);
    const item = fake.items[0]!;
    expect((await answerItem(d, "person", { itemId: item.id, response: "Wrong one", result: "right" })).result).toBe("wrong");
    expect((await answerItem(d, "person", { itemId: item.id, response: item.answer })).result).toBe("right");
  });

  it("has the Tutor grade a short answer and keeps progress per person", async () => {
    const { fake, d } = await setWith(["short_answer"]);
    const tutor = stubTutor(() => ({ result: "partly", feedback: "Close, but missing the minimum." }));
    const outcome = await answerItem(d, "ana", { itemId: fake.items[0]!.id, response: "300 mm" }, "America/Denver");
    expect(outcome).toMatchObject({ result: "partly", feedback: "Close, but missing the minimum.", progress: { level: 0 } });
    expect(tutor.calls[0]!.purpose).toBe("study_grade");
    expect(tutor.calls[0]!.data.claim).toEqual({ title: null, content: "content of r0" });
    expect([...fake.progress.keys()]).toEqual(["ana:u0"]);
  });

  it("moves up only on a later day and drops on a wrong answer", async () => {
    const { fake, d } = await setWith(["flashcard"]);
    const itemId = fake.items[0]!.id;
    const at = (iso: string): StudyDeps => ({ ...d, now: () => new Date(iso) });
    await answerItem(at("2026-11-02T09:00:00Z"), "person", { itemId, result: "right" });
    expect((await answerItem(at("2026-11-02T10:00:00Z"), "person", { itemId, result: "right" })).progress.level).toBe(1);
    expect((await answerItem(at("2026-11-03T09:00:00Z"), "person", { itemId, result: "right" })).progress.level).toBe(2);
    expect((await answerItem(at("2026-11-07T09:00:00Z"), "person", { itemId, result: "wrong" })).progress).toMatchObject({ level: 1, dueAt: "2026-11-07T09:00:00.000Z" });
  });

  it("refuses a flashcard answer without a verdict", async () => {
    const { fake, d } = await setWith(["flashcard"]);
    await expect(answerItem(d, "person", { itemId: fake.items[0]!.id })).rejects.toThrow();
    expect(fake.attempts).toHaveLength(0);
  });
});

describe("stale questions", () => {
  it("are flagged when the claim gets a new revision, and rebuilt from it", async () => {
    const claims = scopeClaims(3);
    const units = unitsOf(claims);
    const fake = fakeStudyDb(units);
    stubTutor(writeQuestions);
    const d = deps(fake.db, claims);
    const { id } = await createStudySet(d, "person", newSet({ types: ["flashcard", "multiple_choice"] }));
    units.set("u1", { revisionId: "r1-new", content: "claim 1, revised" });
    units.set("u2", { revisionId: "r2", content: "claim 2", retired: true });
    const tutor = stubTutor(writeQuestions);
    expect(await rebuildStaleItems(d, "person", id)).toEqual({ rebuilt: 2, retired: 2 });
    const u1 = fake.items.filter((item) => item.unitId === "u1");
    expect(u1.map((item) => [item.revisionId, item.stale, item.prompt.includes("revised")])).toEqual([["r1-new", false, true], ["r1-new", false, true]]);
    // Retired claims stay flagged for Remove
    expect(fake.items.filter((item) => item.unitId === "u2").every((item) => item.stale)).toBe(true);
    expect(fake.items.filter((item) => item.unitId === "u0").every((item) => !item.stale && item.revisionId === "r0")).toBe(true);
    expect(tutor.calls.map((call) => call.purpose)).toEqual(["study_questions", "study_questions"]);
  });

  it("regenerate one question from the current revision", async () => {
    const claims = scopeClaims(2);
    const units = unitsOf(claims);
    const fake = fakeStudyDb(units);
    stubTutor(writeQuestions);
    const d = deps(fake.db, claims);
    await createStudySet(d, "person", newSet({ types: ["multiple_choice"] }));
    units.set("u0", { revisionId: "r0-new", content: "claim 0, revised" });
    await regenerateItem(d, "person", fake.items[0]!.id);
    expect(fake.items[0]).toMatchObject({ revisionId: "r0-new", stale: false, answer: "A claim 0, revised" });
    units.set("u1", { revisionId: "r1", content: "claim 1", retired: true });
    await expect(regenerateItem(d, "person", fake.items[1]!.id)).rejects.toThrow("retired");
  });
});
