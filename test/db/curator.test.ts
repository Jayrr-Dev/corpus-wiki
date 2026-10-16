import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

// The Curator's update_page action: merges and moves wait on Exceptions, then apply and undo as a unit
describe("Curator page structure changes in PostgreSQL", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); }, 60000);
  afterAll(async () => { await store?.pg.close(); });

  async function page(title: string, parent: string | null = null) {
    return (await store.pg.query<{ id: string }>("insert into pages(title,slug,parent_page_id) values ($1,$2,$3) returning id",
      [title, title.toLowerCase().replaceAll(" ", "-") + Math.random().toString(36).slice(2, 6), parent])).rows[0]!.id;
  }
  async function propose(targetId: string, input: Record<string, unknown>) {
    const draft = await store.db.call<{ changeSetId: string; eventId: string }>("submit_change_set", {
      p_event_id: null, p_cause: "edit", p_actor: "ai", p_summary: "Curator test", p_trace: {},
      p_actions: [{ type: "update_page", input: { curator: true, reason: "Test reason", ...input }, targetId, expectedRevisionId: null, passageIds: [], speechAct: null }],
    });
    const result = await store.db.call<{ status: string; exceptions: number }>("commit_change_set", { p_change_set_id: draft.changeSetId });
    return { ...draft, ...result };
  }
  const row = async (id: string) => (await store.pg.query<{ title: string; parent_page_id: string | null; retired_at: string | null; article_type: string | null; scope: string | null }>(
    "select title,parent_page_id,retired_at,article_type,scope from pages where id=$1", [id])).rows[0]!;
  const exceptionFor = async (changeSetId: string) => (await store.pg.query<{ id: string; reason: string }>(
    "select x.id, x.reason from exceptions x join actions a on a.id=x.action_id where a.change_set_id=$1", [changeSetId])).rows[0];

  it("holds a merge, applies it on accept, and undoes it", async () => {
    const parent = await page("Utilitek Solutions Inc.");
    const keep = await page("Health and safety program", parent);
    const dupe = await page("Health & Safety", parent);
    const child = await page("PPE", dupe);
    const held = await propose(dupe, { operation: "merge", intoPageId: keep, sectionTitle: "Extra", unitIds: ["00000000-0000-0000-0000-000000000001"], confident: true });
    expect(held.exceptions).toBe(1);
    expect((await row(dupe)).retired_at).toBeNull();
    const exception = (await exceptionFor(held.changeSetId))!;
    expect(exception.reason).toBe("page_structure_review");

    await store.db.call("resolve_exception", { p_exception_id: exception.id, p_accept: true, p_note: null });
    expect((await row(dupe)).retired_at).not.toBeNull();
    expect((await row(child)).parent_page_id).toBe(keep);
    const sections = (await store.pg.query<{ title: string; query: { unitIds: string[] } }>("select title, query from sections where page_id=$1 and retired_at is null", [keep])).rows;
    expect(sections).toEqual([{ title: "Extra", query: { unitIds: ["00000000-0000-0000-0000-000000000001"] } }]);

    await store.db.call("revert_change_set", { p_change_set_id: held.changeSetId });
    expect((await row(dupe)).retired_at).toBeNull();
    expect((await row(child)).parent_page_id).toBe(dupe);
    expect((await store.pg.query("select 1 from sections where page_id=$1 and retired_at is null", [keep])).rows).toHaveLength(0);
  });

  it("merges a parent into its own child without leaving the child under a removed page", async () => {
    const root = await page("City of Edmonton");
    const ula = await page("Utility Line Assignment", root);
    const sibling = await page("Minimum clearances", root);
    // Nothing to bring over and the Curator is sure: applied at once, still undoable
    const held = await propose(root, { operation: "merge", intoPageId: ula, unitIds: [], confident: true });
    expect(held.status).toBe("applied");
    expect((await row(ula)).parent_page_id).toBeNull();
    expect((await row(sibling)).parent_page_id).toBe(ula);
    await store.db.call("revert_change_set", { p_change_set_id: held.changeSetId });
    expect((await row(ula)).parent_page_id).toBe(root);
    expect((await row(sibling)).parent_page_id).toBe(root);
  });

  it("holds moves, refuses a move under the page's own subtree, and applies a confident type at once", async () => {
    const root = await page("EPCOR");
    const role = await page("Distribution designer role");
    const moved = await propose(role, { operation: "move", parentPageId: root, confident: true });
    expect(moved.exceptions).toBe(1);
    await store.db.call("resolve_exception", { p_exception_id: (await exceptionFor(moved.changeSetId))!.id, p_accept: true, p_note: null });
    expect((await row(role)).parent_page_id).toBe(root);

    const cycle = await propose(root, { operation: "move", parentPageId: role, confident: true });
    expect(cycle.status).toBe("rejected");

    const typed = await propose(root, { operation: "set_type", articleType: "entity", scope: "The utility company.", confident: true });
    expect(typed.status).toBe("applied");
    expect(await row(root)).toMatchObject({ article_type: "entity", scope: "The utility company." });
    const unsure = await propose(root, { operation: "rename", title: "EPCOR Utilities", confident: false });
    expect(unsure.exceptions).toBe(1);
    expect((await row(root)).title).toBe("EPCOR");
  });
  it("files pages under a new placeholder page, held for a person, and undoes it", async () => {
    const clearances = await page("Minimum clearances between power facilities");
    const crossings = await page("Pipeline crossing applications");
    const held = await propose(clearances, { operation: "group", title: "Utility separation standards", articleType: "requirement", scope: "Distances between utilities.", parentPageId: null, pageIds: [clearances, crossings], confident: true });
    expect(held.exceptions).toBe(1);
    await store.db.call("resolve_exception", { p_exception_id: (await exceptionFor(held.changeSetId))!.id, p_accept: true, p_note: null });
    const created = (await store.pg.query<{ id: string; title: string; article_type: string }>("select id, title, article_type from pages where title='Utility separation standards' and retired_at is null")).rows[0]!;
    expect(created.article_type).toBe("requirement");
    expect((await row(clearances)).parent_page_id).toBe(created.id);
    expect((await row(crossings)).parent_page_id).toBe(created.id);

    const loop = await propose(crossings, { operation: "group", title: "Bad", articleType: "concept", parentPageId: crossings, pageIds: [created.id], confident: true });
    expect(loop.status).toBe("rejected");

    await store.db.call("revert_change_set", { p_change_set_id: held.changeSetId });
    expect((await row(clearances)).parent_page_id).toBeNull();
    expect((await row(created.id)).retired_at).not.toBeNull();
  });
});
