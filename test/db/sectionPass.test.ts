import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { KnowledgeContext } from "@/lib/knowledge/context";

// A commit finds the sections its claims leave and join once, at its start and end
describe("sections once per commit in PostgreSQL", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => {
    store = await portablePostgres();
    await store.pg.exec("insert into entities(type,key,name) values ('company','pass-a','Pass A'),('company','pass-b','Pass B')");
  }, 60000);
  afterAll(async () => { await store?.pg.close(); });

  const about = (key: string): KnowledgeContext => ({ entities: [{ type: "company", key, role: "subject" }], applicability: { status: "unspecified", entities: [], conditions: null } });
  async function submit(type: string, input: unknown, targetId: string | null = null, expectedRevisionId: string | null = null) {
    const draft = await store.db.call<{ changeSetId: string }>("submit_change_set", {
      p_event_id: null, p_cause: "edit", p_actor: "person", p_summary: "Section pass", p_trace: {},
      p_actions: [{ type, input, targetId, expectedRevisionId, passageIds: [], speechAct: "stated" }],
    });
    await store.db.call("commit_change_set", { p_change_set_id: draft.changeSetId });
    return (await store.pg.query<{ target_id: string; after_revision_id: string; undo_state: { contextSectionIds?: string[] } }>(
      "select target_id, after_revision_id, undo_state from actions where change_set_id=$1", [draft.changeSetId])).rows[0]!;
  }
  const section = async (key: string) => {
    const page = (await store.pg.query<{ id: string }>("insert into pages(title,slug) values($1,$1) returning id", [key])).rows[0]!.id;
    return (await store.pg.query<{ id: string }>("insert into sections(page_id,position,title,query,status) values($1,0,$2,$3,'current') returning id",
      [page, key, JSON.stringify({ entity: { type: "company", key } })])).rows[0]!.id;
  };
  const status = async (id: string) => (await store.pg.query<{ status: string }>("select status from sections where id=$1", [id])).rows[0]!.status;
  const fresh = (id: string) => store.pg.query("update sections set status='current' where id=$1", [id]);

  it("marks the sections a new claim joins, and both sections when a revise moves it", async () => {
    const a = await section("pass-a"), b = await section("pass-b");
    const added = await submit("add_claim", { content: "Pass A inspects ladders", kind: "fact", epistemicStatus: "supported", entities: about("pass-a").entities, domainPaths: [], context: about("pass-a") });
    expect(await status(a)).toBe("stale");
    expect(await status(b)).toBe("current");
    expect(added.undo_state.contextSectionIds).toEqual([a]);

    await fresh(a);
    const moved = await submit("revise_claim", { content: "Pass B inspects ladders", context: about("pass-b") }, added.target_id, added.after_revision_id);
    expect(await status(a)).toBe("stale");
    expect(await status(b)).toBe("stale");
    expect([...moved.undo_state.contextSectionIds!].sort()).toEqual([a, b].sort());
    // The commit leaves no section pass running for later work in the same session
    expect((await store.pg.query<{ v: string | null }>("select current_setting('change_control.section_pass', true) v")).rows[0]!.v ?? "").toBe("");
  });
});
