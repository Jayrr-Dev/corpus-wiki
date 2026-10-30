import { beforeEach, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { DraftAction, DraftChangeSet } from "@/lib/ai/types";
import type { SectionState } from "@/lib/living-page/types";
import { SCAFFOLD_OUTLINE_ATTEMPTS } from "@/lib/living-page/articleScaffold";

// ARTICLE REBUILD COST FIXTURE: one existing article in memory, the real coverage,
// scope, outline and scaffold code, and a deterministic model keyed by call name.
// It counts what each coverage pass asks the model for and what it rewrites.
// The outline alternates between two defensible plans, as a real model does.

type Unit = { id: string; rev: string; content: string };
type Section = { id: string; title: string; position: number; unitIds: string[]; retired: boolean };
type Line = { id: string; sectionId: string; content: string; unitIds: string[]; revs: string[]; retired: boolean };
const world = vi.hoisted(() => ({
  units: new Map<string, Unit>(), sections: [] as Section[], lines: [] as Line[], candidates: [] as string[],
  judgments: [] as Record<string, unknown>[], holds: 0, rejectOutlines: false, outlineCalls: 0, nextId: 0,
  calls: new Map<string, { calls: number; tokensIn: number }>(),
  writes: { fresh: 0, patch: 0, lines: 0 }, actions: new Map<string, number>(),
  changeSets: new Map<string, { draft: DraftChangeSet; created: string[] }>(),
}));
const count = (name: string, tokensIn: number) => {
  const entry = world.calls.get(name) ?? { calls: 0, tokensIn: 0 };
  world.calls.set(name, { calls: entry.calls + 1, tokensIn: entry.tokensIn + tokensIn });
};
const tag = (content: string) => /\{T:([^}]+)\}/.exec(content)?.[1] ?? "Overview";

vi.mock("@/lib/ai/chat", async (original) => ({ ...await original<object>(), chatJson: vi.fn(async (_settings: unknown, request: { name: string; messages: { content: string }[] }) => {
  const input = JSON.parse(request.messages.findLast(message => message.content.startsWith("{"))?.content ?? "{}") as Record<string, unknown>;
  const tokensIn = Math.round(request.messages.reduce((sum, message) => sum + message.content.length, 0) / 4);
  count(request.name, tokensIn);
  const answer = (value: unknown) => ({ value, tokensIn, tokensOut: 100, model: "fixture" });
  if (request.name === "article_update_discovery") {
    const claims = input.claims as { ref: string; content: string }[];
    const sections = new Map<string, string[]>();
    const excluded: object[] = [];
    for (const claim of claims) {
      if (claim.content.includes("[out]")) excluded.push({ claim: claim.ref, reason: "outside_scope", explanation: "Per-type detail." });
      else if (claim.content.includes("[covered]")) excluded.push({ claim: claim.ref, reason: "already_covered", explanation: "Stated in Overview." });
      else sections.set(tag(claim.content), [...(sections.get(tag(claim.content)) ?? []), claim.ref]);
    }
    return answer({ sections: [...sections].map(([title, refs]) => ({ title, claims: refs })), excluded });
  }
  if (request.name === "article_scope_review") {
    return answer({ groups: (input.groups as { ref: string; claims: { content: string }[] }[]).map(group => ({ ref: group.ref, reason: "Fits.", decision: group.claims.some(claim => claim.content.includes("[offscope]")) ? "outside_scope" : "in_scope" })) });
  }
  if (request.name === "article_outline") {
    const first = JSON.parse(request.messages[1]!.content) as { claims: { ref: string; content: string }[] };
    const groups = new Map<string, string[]>();
    for (const claim of first.claims) groups.set(tag(claim.content), [...(groups.get(tag(claim.content)) ?? []), claim.ref]);
    // Every other outline moves the last core-type claim into Levels of development.
    if (world.outlineCalls++ % 2 === 0) {
      const core = groups.get("Core types"), levels = groups.get("Levels of development");
      if (core && core.length > 1 && levels) levels.unshift(core.pop()!);
    }
    return answer({ centralMessage: "The Enneagram maps nine types.", readingOrderRationale: "Definition, types, then development.",
      plan: { title: "Enneagram", introduction: groups.get("Overview") ?? [first.claims[0]!.ref], sections: [...groups].filter(([title]) => title !== "Overview").map(([title, claims]) => ({ title, claims })) } });
  }
  if (request.name === "article_outline_review") {
    const score = { score: world.rejectOutlines ? 2 : 3, reason: "Checked." };
    return answer({ grounding: score, cohesion: score, flow: score, headings: score, balance: score, introduction: score,
      blockingIssues: world.rejectOutlines ? ["C4 belongs with its parent topic."] : [], fixes: world.rejectOutlines ? ["Move C4."] : [] });
  }
  throw new Error(`Unexpected model call ${request.name}`);
}) }));

// The writer: a fresh section costs a full draft, a kept one patches only flagged lines.
vi.mock("@/lib/living-page/index", () => ({ rebuildUploadSection: vi.fn(async (db: DbRpc, _writer: unknown, sectionId: string) => {
  const state = await db.call<SectionState>("read_section_state", { p_section_id: sectionId });
  const shown = new Set(state.units.map(unit => unit.unitId));
  const flagged = state.lines.filter(line => line.needsRewrite);
  const cited = new Set(state.lines.filter(line => !line.needsRewrite).flatMap(line => line.unitIds));
  for (const line of flagged) for (const id of line.unitIds) if (shown.has(id)) cited.add(id);
  const uncovered = state.units.filter(unit => !cited.has(unit.unitId));
  if (!flagged.length && !uncovered.length) return { sectionId, changeNoteId: null };
  if (state.lines.length) world.writes.patch++; else world.writes.fresh++;
  world.writes.lines += flagged.length + Math.ceil(uncovered.length / 2);
  for (const line of flagged) {
    const stored = world.lines.find(item => item.id === line.lineId)!;
    stored.unitIds = stored.unitIds.filter(id => shown.has(id));
    stored.revs = stored.unitIds.map(id => world.units.get(id)!.rev);
    if (!stored.unitIds.length) stored.retired = true;
  }
  for (let i = 0; i < uncovered.length; i += 2) addLine(sectionId, uncovered.slice(i, i + 2).map(unit => unit.unitId));
  return { sectionId, changeNoteId: "note" };
}) }));

vi.mock("@/lib/change-control", () => ({
  submitChangeSet: vi.fn(async (_db: DbRpc, _origin: unknown, draft: DraftChangeSet) => {
    const id = `cs-${world.nextId++}`;
    world.changeSets.set(id, { draft, created: [] });
    return { changeSetId: id, eventId: "event" };
  }),
  commitChangeSet: vi.fn(async (_db: DbRpc, id: string) => {
    const set = world.changeSets.get(id)!;
    for (const action of set.draft.actions) applyAction(action, set.created);
    return { status: "applied", applied: set.draft.actions.length, rejected: 0, exceptions: 0 };
  }),
  revertChangeSet: vi.fn(),
  autoAcceptHeld: vi.fn(async () => []),
}));

function applyAction(action: DraftAction, created: string[]) {
  world.actions.set(action.type, (world.actions.get(action.type) ?? 0) + 1);
  const live = () => world.sections.filter(section => !section.retired);
  if (action.type === "create_section") {
    const position = action.input.position ?? live().length;
    for (const section of live()) if (section.position >= position) section.position++;
    const id = `s-${world.nextId++}`;
    world.sections.push({ id, title: action.input.title, position, unitIds: action.input.query.unitIds ?? [], retired: false });
    created.push(id);
  } else if (action.type === "retire_section") {
    world.sections.find(section => section.id === action.targetId)!.retired = true;
    for (const line of world.lines) if (line.sectionId === action.targetId) line.retired = true;
  } else if (action.type === "rename_section") {
    world.sections.find(section => section.id === action.targetId)!.title = action.input.title;
  } else if (action.type === "update_section_query") {
    world.sections.find(section => section.id === action.targetId)!.unitIds = (action.input.query as { unitIds: string[] }).unitIds;
  } else throw new Error(`Unexpected action ${action.type}`);
}

function addLine(sectionId: string, unitIds: string[]) {
  world.lines.push({ id: `l-${world.nextId++}`, sectionId, content: `Paragraph citing ${unitIds.join(", ")}.`, unitIds, revs: unitIds.map(id => world.units.get(id)!.rev), retired: false });
}

function sectionState(id: string): SectionState {
  const section = world.sections.find(item => item.id === id)!;
  const shown = new Set(section.unitIds);
  return { sectionId: id, title: section.title, pageTitle: "Enneagram",
    units: section.unitIds.map(unitId => { const unit = world.units.get(unitId)!; return { unitId, revisionId: unit.rev, content: unit.content, kind: "fact", epistemicStatus: "established" }; }),
    lines: world.lines.filter(line => line.sectionId === id && !line.retired).map((line, position) => ({ lineId: line.id, lineRevisionId: `${line.id}-r`, position, content: line.content, author: "ai",
      unitIds: line.unitIds, unitRevisionIds: line.revs, needsRewrite: line.unitIds.some(unitId => !shown.has(unitId) || world.units.get(unitId)!.rev !== line.revs[line.unitIds.indexOf(unitId)]) })) };
}

const db: DbRpc = { call: async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const live = world.sections.filter(section => !section.retired).sort((a, b) => a.position - b.position);
  const result = (() => {
    switch (fn) {
      case "living_page_query_units": return ((args.p_query as { unitIds?: string[] }).unitIds ?? []).filter(id => world.units.has(id));
      case "article_knowledge_candidates": return world.candidates;
      case "read_section_state": return sectionState(args.p_section_id as string);
      case "composer_section_has_images": return false;
      case "read_article_structure": return { planned: null, applied: null, current: live.map(section => ({ sectionId: section.id, title: section.title, position: section.position, unitIds: section.unitIds })) };
      case "save_article_structure_plan": return "plan";
      case "finish_article_structure_plan": return {};
      case "list_page_sections": return live.map(section => ({ sectionId: section.id, pageId: "page" }));
      case "read_article_judgments": return world.judgments;
      case "save_article_judgments": {
        for (const judgment of args.p_judgments as Record<string, unknown>[]) {
          world.judgments = world.judgments.filter(item => !(item.stage === args.p_stage && item.subject === judgment.subject));
          world.judgments.push({ ...judgment, stage: args.p_stage });
        }
        return world.judgments.length;
      }
      case "record_outline_hold": world.holds++; return { exceptions: 1, changeSetId: "hold" };
      default: throw new Error(`Unexpected RPC ${fn}`);
    }
  })();
  return result as T;
} };

const client = { from: (table: string) => {
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  let single = false;
  const rows = (): Record<string, unknown>[] => {
    if (table === "pages") return [{ id: "page", title: "Enneagram", scope: "The Enneagram system as a whole. Per-type profiles belong in the type articles." }];
    if (table === "sections") return world.sections.map(section => ({ id: section.id, title: section.title, mode: "generated", position: section.position, page_id: "page",
      query: { unitIds: section.unitIds, article: true }, retired_at: section.retired ? "2026-10-19" : null, parent_page_id: null }));
    if (table === "section_lines") return world.lines.filter(line => !line.retired).map(line => ({ content: line.content, page_id: "page", section_id: line.sectionId, author: "ai" }));
    if (table === "units") return [...world.units.values()].map(unit => ({ id: unit.id, current_revision_id: unit.rev, kind: "fact", epistemic_status: "established", retired_at: null }));
    if (table === "revisions") return [...world.units.values()].map(unit => ({ id: unit.rev, content: unit.content, knowledge_context: null, structure: null }));
    if (table === "actions") return [...world.changeSets].flatMap(([id, set]) => set.created.map(target_id => ({ change_set_id: id, type: "create_section", outcome: "applied", target_id })));
    return [];
  };
  const chain = {
    select: () => chain, order: () => chain, range: () => chain, limit: () => chain,
    eq: (column: string, value: unknown) => { if (table !== "pages" && column !== "parent_page_id") filters.push(row => row[column] === value); else if (column === "parent_page_id") filters.push(() => false); return chain; },
    is: (column: string, value: unknown) => { filters.push(row => (row[column] ?? null) === value); return chain; },
    in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return chain; },
    single: () => { single = true; return chain; },
    then: (resolve: (result: object) => unknown) => {
      const data = rows().filter(row => filters.every(filter => filter(row)));
      return Promise.resolve(resolve({ data: single ? data[0] : data, error: null }));
    },
  };
  return chain;
} } as unknown as AdminSupabase;

function seed() {
  Object.assign(world, { sections: [], lines: [], candidates: [], judgments: [], holds: 0, rejectOutlines: false, outlineCalls: 0, nextId: 0,
    writes: { fresh: 0, patch: 0, lines: 0 } });
  world.units.clear(); world.calls.clear(); world.actions.clear(); world.changeSets.clear();
  const topics: [string, number][] = [["Overview", 2], ["Core types", 4], ["Levels of development", 4], ["Wings", 2]];
  let n = 0, position = 0;
  for (const [title, size] of topics) {
    const ids: string[] = [];
    for (let i = 0; i < size; i++) {
      const id = `u${++n}`;
      world.units.set(id, { id, rev: `${id}-r1`, content: `Enneagram fact ${n} {T:${title}}` });
      ids.push(id);
    }
    const id = `s-${world.nextId++}`;
    world.sections.push({ id, title, position: position++, unitIds: ids, retired: false });
    for (let i = 0; i < ids.length; i += 2) addLine(id, ids.slice(i, i + 2));
  }
  for (let i = 1; i <= 6; i++) world.units.set(`o${i}`, { id: `o${i}`, rev: `o${i}-r1`, content: `Type ${i} fears rejection [out]` });
  for (let i = 1; i <= 2; i++) world.units.set(`c${i}`, { id: `c${i}`, rev: `c${i}-r1`, content: `The Enneagram has nine points [covered]` });
  world.candidates = [...world.units.keys()];
}

const settings = { apiKey: "fixture", model: "fixture" };
async function pass() {
  const { expandArticleCoverage } = await import("@/lib/living-page/articleCoverage");
  try { await expandArticleCoverage(db, settings, "page", { client, writer: { name: "fixture", reviseSection: vi.fn() } }); return "ok"; }
  catch (error) { return error instanceof Error ? error.message.slice(0, 60) : "failed"; }
}
function snapshot() {
  const calls = Object.fromEntries([...world.calls].map(([name, value]) => [name, value.calls]));
  const tokensIn = [...world.calls.values()].reduce((sum, value) => sum + value.tokensIn, 0);
  return { calls, plannerAndReviewerCalls: [...world.calls.values()].reduce((sum, value) => sum + value.calls, 0), tokensIn,
    freshWrites: world.writes.fresh, patchWrites: world.writes.patch, linesWritten: world.writes.lines,
    // Each section write costs a selection, a draft, a fact-check and an editorial review.
    sectionWriteCalls: (world.writes.fresh + world.writes.patch) * 4,
    actions: Object.fromEntries(world.actions), holds: world.holds };
}
const report: Record<string, unknown> = {};

beforeEach(() => seed());

it("costs nothing after the first pass when no new knowledge arrives", async () => {
  const outcomes = [await pass(), await pass(), await pass()];
  report.unchanged = { outcomes, ...snapshot() };
  if (process.env.PROCESSING_BENCHMARK) console.info("Article rebuild, 3 passes, no new knowledge", report.unchanged);
  expect(outcomes).toEqual(["ok", "ok", "ok"]);
  // On main 811fa66: 3 discovery, 3 scope and 3+3 outline calls, and 6 sections patched.
  expect(world.calls.get("article_update_discovery")?.calls).toBe(1);
  expect(["article_scope_review", "article_outline", "article_outline_review"].some(name => world.calls.has(name))).toBe(false);
  expect(world.writes).toEqual({ fresh: 0, patch: 0, lines: 0 });
});

it("updates one section in place when one claim arrives", async () => {
  await pass();
  world.calls.clear(); world.actions.clear(); world.writes = { fresh: 0, patch: 0, lines: 0 };
  world.units.set("n1", { id: "n1", rev: "n1-r1", content: "A wing is an adjacent type {T:Wings}" });
  world.candidates.push("n1");
  const outcomes = [await pass(), await pass()];
  report.oneClaim = { outcomes, ...snapshot() };
  if (process.env.PROCESSING_BENCHMARK) console.info("Article rebuild, one new claim then one more pass", report.oneClaim);
  expect(outcomes).toEqual(["ok", "ok"]);
  // On main 811fa66: 2 scope and 2+2 outline calls, and 5 sections patched.
  expect(world.actions.has("retire_section") || world.actions.has("create_section")).toBe(false);
  expect(world.writes).toMatchObject({ fresh: 0, patch: 3 });
  expect(world.calls.get("article_outline")?.calls).toBe(1);
});

it("stops re-planning an outline the reviewer keeps rejecting", async () => {
  world.rejectOutlines = true;
  world.units.set("n1", { id: "n1", rev: "n1-r1", content: "A wing is an adjacent type {T:Wings}" });
  world.candidates.push("n1");
  const outcomes = [await pass(), await pass(), await pass()];
  report.rejected = { outcomes, ...snapshot() };
  if (process.env.PROCESSING_BENCHMARK) console.info("Article rebuild, outline review always objects, 3 passes", report.rejected);
  // On main 811fa66: 18 outline and 18 outline-review calls, and every pass failed.
  expect(outcomes).toEqual(["ok", "ok", "ok"]);
  expect(world.calls.get("article_outline")?.calls).toBe(SCAFFOLD_OUTLINE_ATTEMPTS);
  expect(world.holds).toBe(1);
});
