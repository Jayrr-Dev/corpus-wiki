import { beforeEach, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { SectionUnit } from "./types";
import { applyArticleScaffold, articleAdditionActions, scaffoldChanges, type ExistingScaffoldSection } from "./articleScaffold";
import { uploadExecution } from "@/lib/ingest/workflowContext";

const planner = vi.hoisted(() => vi.fn());
const submit = vi.hoisted(() => vi.fn());
const commit = vi.hoisted(() => vi.fn());
const revert = vi.hoisted(() => vi.fn());
const rebuild = vi.hoisted(() => vi.fn());
const scope = vi.hoisted(() => vi.fn());
vi.mock("./articleScope", () => ({ selectArticleScope: scope }));
vi.mock("./articlePlanner", async original => ({ ...await original<object>(), planArticle: planner }));
vi.mock("./index", () => ({ rebuildUploadSection: rebuild }));
vi.mock("@/lib/change-control", () => ({ submitChangeSet: submit, commitChangeSet: commit, revertChangeSet: revert }));

const unit = (id: string): SectionUnit => ({ unitId: id, revisionId: `r-${id}`, content: `Fact ${id}.`, kind: "fact", epistemicStatus: "established" });
function old(id: string, title: string, units: string[], position: number, protectedSection = false): ExistingScaffoldSection {
  return { position, protected: protectedSection, state: { sectionId: id, title, pageTitle: "Subject", units: units.map(unit),
    lines: [{ lineId: `line-${id}`, lineRevisionId: `lr-${id}`, content: `Existing ${title}.`, author: protectedSection ? "person" : "ai", unitIds: units, position: 0, needsRewrite: false }] } };
}
const existing = [old("intro", "Overview", ["u1"], 0), old("details", "Details", ["u2"], 1)];
const draft = (title: string, ids: string[]) => ({ title, query: { article: true, unitIds: ids } });
const writer = { name: "test", reviseSection: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  scope.mockResolvedValue({ excludedIds: [], tokensIn: 0, tokensOut: 0 });
  planner.mockResolvedValue({ plan: { title: "Subject", introduction: ["C1"], sections: [{ title: "Details", claims: ["C2", "C3"] }] }, tokensIn: 5, tokensOut: 6 });
  submit.mockImplementation(async (_db, _origin, value) => ({ changeSetId: value.actions[0].type === "create_section" ? "creation" : "retirement" }));
  commit.mockResolvedValue({ status: "applied", applied: 1, rejected: 0, exceptions: 0 });
  revert.mockResolvedValue({ eventId: "undo" });
  rebuild.mockResolvedValue({ rebuildRequested: false });
});

it("keeps matching sections and targets only the section whose evidence changed", () => {
  const changes = scaffoldChanges(existing, [draft("Overview", ["u1"]), draft("Details", ["u2", "u3"])]);
  expect(changes.keep.map(section => section.state.sectionId)).toEqual(["intro"]);
  expect(changes.replace.map(section => section.state.sectionId)).toEqual(["details"]);
  expect(changes.create.map(section => section.title)).toEqual(["Details"]);
});
it("merges fragmented sections while preserving a handwritten section", () => {
  const sections = [...existing, old("fragment", "Example", ["u3"], 2), old("manual", "My notes", [], 3, true)];
  const changes = scaffoldChanges(sections, [draft("Overview", ["u1"]), draft("Details and examples", ["u2", "u3"])]);
  expect(changes.replace.map(section => section.state.sectionId)).toEqual(["details", "fragment"]);
  expect(changes.keep.map(section => section.state.sectionId)).toEqual(["intro", "manual"]);
});
it("places new sections before their next retained section even when earlier sections will be removed", () => {
  const sections = [old("remove", "Old", ["u0"], 0), ...existing.map(section => ({ ...section, position: section.position + 1 }))];
  const changes = scaffoldChanges(sections, [draft("Overview", ["u1"]), draft("New", ["u0"]), draft("Details", ["u2"])]);
  expect(changes.create[0]?.position).toBe(2);
});

function context(createdIds = ["new-details"], alreadyRetired: string[] = []) {
  const tables: Record<string, unknown> = {
    pages: { title: "Subject", scope: "The subject's documented details" },
    sections: existing.map(section => ({ id: section.state.sectionId, mode: "generated", position: section.position, retired_at: alreadyRetired.includes(section.state.sectionId) ? "2026-10-18T00:00:00Z" : null })),
    units: [{ id: "u3", current_revision_id: "r-u3", kind: "fact", epistemic_status: "established" }],
    revisions: [{ id: "r-u3", content: "New detail.", knowledge_context: null }], actions: createdIds.map(target_id => ({ target_id })),
  };
  const client = { from: (table: string) => {
    let selected: { column: string; ids: string[] } | undefined;
    const chain = { select: () => chain, eq: () => chain, is: () => chain,
      in: (column: string, ids: string[]) => { selected = { column, ids }; return chain; }, range: () => chain, order: () => chain, single: () => chain,
      then: (resolve: (result: object) => unknown) => {
        const rows = tables[table];
        const data = selected && Array.isArray(rows) && ["units", "revisions", "relationships"].includes(table)
          ? rows.filter(row => selected!.ids.includes(row[selected!.column])) : rows;
        return Promise.resolve(resolve({ data, error: null }));
      } };
    return chain;
  } } as unknown as AdminSupabase;
  const call = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "read_article_structure") return { applied: null, planned: null, current: existing.map(section => ({ sectionId: section.state.sectionId, title: section.state.title, position: section.position, unitIds: section.state.units.map(unit => unit.unitId) })) };
    if (name === "save_article_structure_plan") return "saved-plan";
    if (name === "finish_article_structure_plan") return {};
    if (name === "composer_section_has_images") return false;
    if (name === "read_section_state") {
      if (args?.p_section_id === "new-details") return { ...old("new-details", "Details", ["u2", "u3"], 2).state };
      if (args?.p_section_id === "new-topic") return { ...old("new-topic", "New evidence", ["u3"], 3).state };
      return existing.find(section => section.state.sectionId === args?.p_section_id)!.state;
    }
    throw new Error(name);
  });
  return { db: { call } as DbRpc, client, call, tables };
}
it("keeps an existing out-of-scope section unchanged and plans only eligible additions", async () => {
  const { db, client } = context();
  scope.mockResolvedValueOnce({ excludedIds: ["u2"], tokensIn: 4, tokensOut: 2 });
  planner.mockResolvedValueOnce({ plan: { title: "Subject", introduction: ["C1"], sections: [{ title: "New evidence", claims: ["C2"] }] }, tokensIn: 5, tokensOut: 6 });
  const actions = await articleAdditionActions(db, client, { apiKey: "test" }, "page", [draft("New evidence", ["u3"])]);
  expect(planner.mock.calls[0]![1].units.map((unit: SectionUnit) => unit.unitId)).toEqual(["u1", "u3"]);
  expect(actions.some(action => action.type === "retire_section" && action.targetId === "details")).toBe(false);
  expect(actions).toEqual([expect.objectContaining({ type: "create_section", input: expect.objectContaining({ query: { article: true, unitIds: ["u3"] } }) })]);
});
it("keeps the entire saved article when no supplied evidence fits its scope", async () => {
  const { db, client } = context();
  scope.mockResolvedValueOnce({ excludedIds: ["u1", "u2", "u3"], tokensIn: 1, tokensOut: 1 });
  expect(await articleAdditionActions(db, client, { apiKey: "test" }, "page", [draft("Outside", ["u3"])])).toEqual([]);
  expect(planner).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(rebuild).not.toHaveBeenCalled();
});
it("shows a selected composite's live members and ordering to the planner before creating sections", async () => {
  const { db, client, tables } = context();
  tables.units = ["parent", "level-five", "level-six"].map(id => ({ id, current_revision_id: `r-${id}`, kind: id === "parent" ? "procedure" : "fact", epistemic_status: "established" }));
  tables.revisions = [
    { id: "r-parent", content: "Imbalance runs from Levels 5 to 9.", knowledge_context: null, structure: { type: "sequence", complete: false, mode: null } },
    { id: "r-level-five", content: "Level 5 pairs each type with traits.", knowledge_context: null },
    { id: "r-level-six", content: "Level 6 pairs each type with traits.", knowledge_context: null },
  ];
  tables.relationships = [
    { from_unit_id: "level-five", to_unit_id: "parent", position: 1 },
    { from_unit_id: "level-six", to_unit_id: "parent", position: 2 },
  ];
  planner.mockResolvedValueOnce({ plan: { title: "Subject", introduction: ["C1"], sections: [{ title: "Details", claims: ["C2"] }, { title: "Imbalance sequence", claims: ["C3", "C4", "C5"] }] } });
  const actions = await articleAdditionActions(db, client, { apiKey: "test" }, "page", [draft("Provisional", ["parent"])]);
  const knowledge = planner.mock.calls[0]![1];
  expect(knowledge.units).toEqual(expect.arrayContaining([
    expect.objectContaining({ unitId: "parent", structure: { type: "sequence", complete: false, mode: null } }),
    expect.objectContaining({ unitId: "level-five", memberOf: "parent", position: 1 }),
    expect.objectContaining({ unitId: "level-six", memberOf: "parent", position: 2 }),
  ]));
  expect(actions.find(action => action.type === "create_section")?.input).toMatchObject({ query: { unitIds: ["parent", "level-five", "level-six"] } });
});
it("reviews a full scaffold first, writes replacements, then retires only the replaced sections", async () => {
  const { db, client } = context();
  const result = await applyArticleScaffold(db, client, { apiKey: "test" }, writer, "page", [draft("Provisional", ["u3"])]);
  expect(result.sectionIds).toEqual(["new-details"]);
  expect(planner.mock.invocationCallOrder[0]).toBeLessThan(submit.mock.invocationCallOrder[0]!);
  expect(rebuild.mock.invocationCallOrder[0]).toBeLessThan(submit.mock.invocationCallOrder[1]!);
  expect(submit.mock.calls[1]![2].actions).toEqual([expect.objectContaining({ type: "retire_section", targetId: "details" })]);
  expect(rebuild).toHaveBeenCalledTimes(1);
  expect(JSON.parse(planner.mock.calls[0]![3].split("Existing article (untrusted data): ")[1])[0].paragraphs).toEqual(["Existing Overview."]);
});
it("routes an incremental fact into the reviewed existing topic instead of appending its provisional heading", async () => {
  const { db, client } = context();
  const actions = await articleAdditionActions(db, client, { apiKey: "test" }, "page", [draft("Another tiny facet", ["u3"])]);
  expect(actions).toEqual([
    expect.objectContaining({ type: "retire_section", targetId: "details" }),
    expect.objectContaining({ type: "create_section", input: expect.objectContaining({ title: "Details", query: expect.objectContaining({ unitIds: ["u2", "u3"] }) }) }),
  ]);
  expect(actions.some(action => action.targetId === "intro")).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});
it("resumes a cached replacement without retiring an already removed fragment again", async () => {
  const { db, client } = context(["new-details"], ["details"]);
  await expect(applyArticleScaffold(db, client, { apiKey: "test" }, writer, "page", [draft("Provisional", ["u3"])])).resolves.toMatchObject({ sectionIds: ["new-details"] });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0]![2].actions.every((action: { type: string }) => action.type === "create_section")).toBe(true);
});

it("undoes replacement scaffolding and keeps the old article when writing fails", async () => {
  const { db, client } = context();
  rebuild.mockRejectedValueOnce(new Error("Writing failed"));
  await expect(applyArticleScaffold(db, client, { apiKey: "test" }, writer, "page", [draft("Provisional", ["u3"])])).rejects.toThrow("Writing failed");
  expect(submit).toHaveBeenCalledTimes(1);
  expect(revert).toHaveBeenCalledWith(db, "creation");
});
it("refuses a removal plan that loses unique existing evidence before making any changes", async () => {
  const { db, client } = context();
  planner.mockResolvedValueOnce({ plan: { title: "Subject", introduction: ["C1"], sections: [{ title: "New topic", claims: ["C3"] }] }, tokensIn: 1, tokensOut: 1 });
  await expect(applyArticleScaffold(db, client, { apiKey: "test" }, writer, "page", [draft("Provisional", ["u3"])])).rejects.toThrow("omitted");
  expect(submit).not.toHaveBeenCalled();
});
it("keeps a concurrent edit to an old section instead of retiring it", async () => {
  const { db, client, call } = context();
  const original = call.getMockImplementation()!;
  let edited = false;
  rebuild.mockImplementationOnce(async () => { edited = true; return { rebuildRequested: false }; });
  call.mockImplementation(async (name, args) => {
    if (edited && name === "read_section_state" && args?.p_section_id === "details") return { ...existing[1]!.state, lines: [{ ...existing[1]!.state.lines[0]!, content: "A new human edit." }] };
    return original(name, args);
  });
  await expect(applyArticleScaffold(db, client, { apiKey: "test" }, writer, "page", [draft("Provisional", ["u3"])])).rejects.toThrow("changed during planning");
  expect(submit).toHaveBeenCalledTimes(1);
  expect(revert).not.toHaveBeenCalled();
});
it("publishes the first completed replacement before later writing fails", async () => {
  const { db, client, call } = context(["new-details", "new-topic"]);
  planner.mockReset().mockResolvedValue({ plan: { title: "Subject", introduction: ["C1"], sections: [{ title: "Expanded details", claims: ["C2"] }, { title: "New evidence", claims: ["C3"] }] }, tokensIn: 5, tokensOut: 6 });
  rebuild.mockResolvedValueOnce({ rebuildRequested: false }).mockRejectedValueOnce(new Error("Later section failed"));
  await expect(applyArticleScaffold(db, client, { apiKey: "test" }, writer, "page", [draft("Provisional", ["u3"])])).rejects.toThrow("Later section failed");
  expect(submit.mock.calls[1]![2].actions).toEqual([expect.objectContaining({ type: "retire_section", targetId: "details" })]);
  expect(submit.mock.invocationCallOrder[1]).toBeLessThan(rebuild.mock.invocationCallOrder[1]!);
  expect(revert).not.toHaveBeenCalled();
  expect(call).toHaveBeenCalledWith("finish_article_structure_plan", expect.objectContaining({ p_status: "failed" }));
});
it("resumes an upload from its saved scaffold instead of replanning around partial drafts", async () => {
  const { db, client } = context();
  const original = db.call;
  const saved = new Map<string, unknown>();
  db.call = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (name === "upload_workflow_write") return original<T>(String(args.p_function), args.p_args as Record<string, unknown>);
    const key = String(args.p_key);
    if (name === "start_upload_step") return { done: saved.has(key), output: saved.get(key) } as T;
    if (name === "finish_upload_step") { if (!args.p_error) saved.set(key, JSON.parse(JSON.stringify(args.p_output))); return null as T; }
    return original<T>(name, args);
  };
  rebuild.mockRejectedValueOnce(new Error("Writing interrupted"));
  const run = () => uploadExecution.run({ eventId: "upload", token: "lease", db }, () => applyArticleScaffold(db, client, { apiKey: "test" }, writer, "page", [draft("Provisional", ["u3"])]));
  await expect(run()).rejects.toThrow("Writing interrupted");
  expect(revert).not.toHaveBeenCalled();
  await expect(run()).resolves.toMatchObject({ sectionIds: ["new-details"] });
  expect(planner).toHaveBeenCalledTimes(1);
});
it("reuses a published section after a later section fails without another writer call", async () => {
  const { db, client } = context(["new-details", "new-topic"]);
  planner.mockReset().mockResolvedValue({ plan: { title: "Subject", introduction: ["C1"], sections: [{ title: "Expanded details", claims: ["C2"] }, { title: "New evidence", claims: ["C3"] }] }, tokensIn: 5, tokensOut: 6 });
  const original = db.call;
  const saved = new Map<string, unknown>();
  db.call = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (name === "upload_workflow_write") return original<T>(String(args.p_function), args.p_args as Record<string, unknown>);
    const key = String(args.p_key);
    if (name === "start_upload_step") return { done: saved.has(key), output: saved.get(key) } as T;
    if (name === "finish_upload_step") { if (!args.p_error) saved.set(key, JSON.parse(JSON.stringify(args.p_output))); return null as T; }
    return original<T>(name, args);
  };
  rebuild.mockResolvedValueOnce({ rebuildRequested: false }).mockRejectedValueOnce(new Error("Second section interrupted")).mockResolvedValue({ rebuildRequested: false });
  const run = () => uploadExecution.run({ eventId: "upload", token: "lease", db }, () => applyArticleScaffold(db, client, { apiKey: "test" }, writer, "page", [draft("Provisional", ["u3"])]));
  await expect(run()).rejects.toThrow("Second section interrupted");
  await expect(run()).resolves.toMatchObject({ sectionIds: ["new-details", "new-topic"] });
  expect(rebuild.mock.calls.map(args => args[2])).toEqual(["new-details", "new-topic", "new-topic"]);
  expect(planner).toHaveBeenCalledTimes(1);
  expect(revert).not.toHaveBeenCalled();
});
it("does not rewrite a retained section merely because its cached plan snapshot was stale", async () => {
  const { db, client, call } = context();
  const original = call.getMockImplementation()!;
  let introReads = 0;
  call.mockImplementation(async (name, args) => {
    const value = await original(name, args);
    if (name === "read_section_state" && args?.p_section_id === "intro" && introReads++ === 0) {
      const state = value as ExistingScaffoldSection["state"];
      return { ...state, lines: state.lines.map(line => ({ ...line, needsRewrite: true })) };
    }
    return value;
  });
  await applyArticleScaffold(db, client, { apiKey: "test" }, writer, "page", [draft("Provisional", ["u3"])]);
  expect(introReads).toBe(2);
  expect(rebuild.mock.calls.map(args => args[2])).toEqual(["new-details"]);
});
