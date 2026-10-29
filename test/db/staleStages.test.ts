import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { KnowledgeContext } from "@/lib/knowledge/context";

type Mark = { kind: string; key: string; version: number };
const STAGE_KINDS = ["section", "topic_placement", "entity_description", "entity_profile"];

// Sections, filing and entity text find their work from marks set by the same commit (or Undo)
describe("stale marks for sections, filing and entities in PostgreSQL", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  let ids: Record<string, string> = {};
  beforeAll(async () => {
    store = await portablePostgres();
    await store.pg.exec("alter table sections disable trigger guard_empty_section_completion");
    await store.pg.exec("insert into entities(type,key,name) values ('company','mark-a','Mark A'),('company','mark-b','Mark B')");
    ids = Object.fromEntries((await store.pg.query<{ key: string; id: string }>("select key, id from entities where key like 'mark-%'")).rows.map((row) => [row.key, row.id]));
  }, 60000);
  afterAll(async () => { await store?.pg.close(); });

  const about = (key: string): KnowledgeContext => ({ entities: [{ type: "company", key, role: "subject" }], applicability: { status: "unspecified", entities: [], conditions: null } });
  const marks = async (kinds = STAGE_KINDS) => (await store.db.call<Mark[]>("read_stale_marks", { p_kinds: kinds })).map(({ kind, key }) => `${kind}:${key}`).sort();
  const clear = async () => store.db.call("clear_stale_marks", { p_marks: await store.db.call<Mark[]>("read_stale_marks", { p_kinds: STAGE_KINDS }) });
  async function submit(type: string, input: unknown, targetId: string | null = null, expectedRevisionId: string | null = null) {
    const draft = await store.db.call<{ changeSetId: string; eventId: string }>("submit_change_set", {
      p_event_id: null, p_cause: "edit", p_actor: "person", p_summary: "Stage marks", p_trace: {},
      p_actions: [{ type, input, targetId, expectedRevisionId, passageIds: [], speechAct: "stated" }],
    });
    await store.db.call("commit_change_set", { p_change_set_id: draft.changeSetId });
    const action = (await store.pg.query<{ target_id: string; after_revision_id: string }>(
      "select target_id, after_revision_id from actions where change_set_id=$1", [draft.changeSetId])).rows[0]!;
    return { ...action, ...draft };
  }
  const addClaim = (content: string, key: string) => submit("add_claim", { content, kind: "fact", epistemicStatus: "supported", entities: about(key).entities, domainPaths: [], context: about(key) });
  const section = async (key: string, cites?: { unitId: string; revisionId: string }) => {
    const page = (await store.pg.query<{ id: string }>("insert into pages(title,slug) values($1,$1) returning id", [`${key}-${Math.random()}`])).rows[0]!.id;
    const id = (await store.pg.query<{ id: string }>("insert into sections(page_id,position,title,query,status) values($1,0,$2,$3,'current') returning id",
      [page, key, JSON.stringify({ entity: { type: "company", key } })])).rows[0]!.id;
    if (cites) await store.pg.query("insert into section_inputs(section_id,unit_id,revision_id) values($1,$2,$3)", [id, cites.unitId, cites.revisionId]);
    return id;
  };
  const stale = async (eventId: string) => (await store.db.call<{ sectionId: string }[]>("list_stale_sections", { p_event_id: eventId })).map((s) => s.sectionId).sort();
  const affected = async (eventId: string) => (await store.db.call<{ sectionId: string }[]>("list_affected_sections", { p_event_id: eventId })).map((s) => s.sectionId).sort();

  it("marks a new claim's filing and entity until it is filed, and again when it loses its topic", async () => {
    await clear();
    const added = await addClaim("Mark A inspects ladders", "mark-a");
    expect(await marks()).toEqual([`entity_description:${ids["mark-a"]}`, `entity_profile:${ids["mark-a"]}`, `topic_placement:${added.target_id}`]);
    const unplaced = await store.db.call<{ claims: { unitId: string }[] }>("upload_unplaced_claims", { p_event_id: added.eventId });
    expect(unplaced.claims.map((claim) => claim.unitId)).toEqual([added.target_id]);

    const domain = (await store.pg.query<{ id: string }>("insert into domains(name,path,proposed_by) values('Marks','marks','person') returning id")).rows[0]!.id;
    await store.pg.query("insert into unit_domains(unit_id,domain_id) values($1,$2)", [added.target_id, domain]);
    expect(await marks(["topic_placement"])).toEqual([]);
    expect((await store.db.call<{ claims: unknown[] }>("upload_unplaced_claims", { p_event_id: added.eventId })).claims).toEqual([]);
    await store.pg.query("delete from unit_domains where unit_id=$1", [added.target_id]);
    expect(await marks(["topic_placement"])).toEqual([`topic_placement:${added.target_id}`]);
    await submit("retire_claim", { reason: "Superseded" }, added.target_id);
    expect(await marks(["topic_placement"])).toEqual([]);
  });

  it("marks the sections citing a revised claim and the entities it leaves and joins, and Undo marks the same", async () => {
    const added = await addClaim("Mark A rents scaffolds", "mark-a");
    const cited = await section("mark-a", { unitId: added.target_id, revisionId: added.after_revision_id });
    const other = await section("mark-b");
    await clear();
    await store.pg.exec("update sections set status='current'");

    const moved = await submit("revise_claim", { content: "Mark B rents scaffolds", context: about("mark-b") }, added.target_id, added.after_revision_id);
    const afterRevise = await marks(["section", "entity_description", "entity_profile"]);
    expect(afterRevise).toEqual(expect.arrayContaining([`section:${cited}`, `section:${other}`,
      `entity_description:${ids["mark-a"]}`, `entity_description:${ids["mark-b"]}`, `entity_profile:${ids["mark-a"]}`, `entity_profile:${ids["mark-b"]}`]));
    // The pages stage picks every section the old search found
    expect(await stale(moved.eventId)).toEqual(expect.arrayContaining(await affected(moved.eventId)));

    await clear();
    await store.pg.exec("update sections set status='current'");
    await store.db.call("revert_upload_knowledge", { p_change_set_id: moved.changeSetId });
    expect(await marks(["section", "entity_description", "entity_profile"])).toEqual(expect.arrayContaining(afterRevise));
  });

  it("clears a section's mark when its build finishes, and keeps entity marks a stage did not read", async () => {
    const added = await addClaim("Mark A trains crews", "mark-a");
    const built = await section("mark-a", { unitId: added.target_id, revisionId: added.after_revision_id });
    await store.db.call("mark_section_stale", { p_section_id: built });
    expect(await marks(["section"])).toContain(`section:${built}`);
    await store.pg.query("update sections set status='current' where id=$1", [built]);
    expect(await marks(["section"])).not.toContain(`section:${built}`);

    const read = await store.db.call<{ entityIds: string[]; marks: Mark[] }>("read_stale_entities", { p_kind: "entity_description" });
    expect(read.entityIds).toContain(ids["mark-a"]);
    await submit("revise_claim", { content: "Mark A trains crews yearly" }, added.target_id, added.after_revision_id);
    await store.db.call("clear_stale_marks", { p_marks: read.marks });
    expect(await marks(["entity_description"])).toEqual([`entity_description:${ids["mark-a"]}`]);
  });

  it("rebuilds section and filing marks from canonical data", async () => {
    const added = await addClaim("Mark B audits cranes", "mark-b");
    const cited = await section("mark-b", { unitId: added.target_id, revisionId: added.after_revision_id });
    await submit("revise_claim", { content: "Mark B audits tower cranes" }, added.target_id, added.after_revision_id);
    const live = await marks(["section", "topic_placement"]);
    expect(live).toEqual(expect.arrayContaining([`section:${cited}`, `topic_placement:${added.target_id}`]));
    await store.pg.exec("delete from stale_marks where kind in ('section','topic_placement')");
    await store.db.call("rebuild_stale_marks", { p_kinds: ["section", "topic_placement"] });
    expect(await marks(["section", "topic_placement"])).toEqual(expect.arrayContaining(live));
  });
});
