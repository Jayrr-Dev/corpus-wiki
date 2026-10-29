import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

// reconciliation_input as one plain definition (issue #48): same JSON as the old wrapper chain
const MIGRATION = "20261124100000_reconciliation_input_plain.sql";

describe("reconciliation_input without its wrapper chain", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  const events: string[] = [];
  let before: unknown[] = [];

  type Action = { type: string; input: unknown; targetId?: string | null };
  async function submit(eventId: string | null, actions: Action[]) {
    const draft = await store.db.call<{ changeSetId: string }>("submit_change_set", {
      p_event_id: eventId, p_cause: eventId ? "upload" : "edit", p_actor: eventId ? "ai" : "person", p_summary: "Plain input fixture", p_trace: {},
      p_actions: actions.map((action) => ({ targetId: null, expectedRevisionId: null, passageIds: [], speechAct: "stated", ...action })),
    });
    await store.db.call("commit_change_set", { p_change_set_id: draft.changeSetId });
    return (await store.pg.query<{ target_id: string; outcome: string }>(
      "select target_id, outcome from actions where change_set_id=$1 order by position", [draft.changeSetId])).rows;
  }
  const scoped = (key: string) => ({
    entities: [{ type: "company", key, role: "subject" }],
    applicability: { status: "scoped", entities: [{ type: "company", key }], conditions: null },
  });
  const claim = (content: string, key: string, structure?: unknown): Action => ({
    type: "add_claim",
    input: { content, kind: "fact", epistemicStatus: "supported", entities: scoped(key).entities, domainPaths: [], context: scoped(key), ...(structure === undefined ? {} : { structure }) },
  });
  const member = (from: number, to: number, position: number): Action => ({ type: "link", input: { toUnitId: null, type: "part_of", fromPosition: from, toPosition: to, memberPosition: position } });
  const upload = async (hash: string, texts: string[]) => (await store.db.call<{ eventId: string }>("ingest_source", {
    p_title: `${hash}.md`, p_mime_type: "text/markdown", p_source_date: "2026-11-24T00:00:00Z", p_hash: hash, p_storage_path: `test/${hash}.md`,
    p_passages: texts.map((text, position) => ({ position, text, location: {}, hash: `${hash}-${position}`, speakerLabel: position ? "Ana" : null })),
    p_byte_size: null, p_page_count: null,
  })).eventId;
  const read = () => Promise.all(events.map((id) => store.db.call("reconciliation_input", { p_event_id: id })));

  // Builds every case the old layers handled, reads the input, then applies the plain definition
  beforeAll(async () => {
    store = await portablePostgres({ before: MIGRATION });
    await store.pg.exec(`
      insert into entities(type,key,name) values ('company','acme','Acme'),('company','acme-old','Acme Old'),('company','gone','Gone Co'),('person','ana','Ana');
      insert into domains(name,path,proposed_by) values ('Safety','Safety','person'),('Old','Old','person');
      insert into domains(name,path,parent_id,proposed_by) select 'Ladders','Safety/Ladders',id,'person' from domains where path='Safety';
      update domains set retired_at=now() where path='Old';
      insert into domain_tabs(name,description,root_ids) select 'Work','Work topics',array_agg(id) from domains;
      insert into domain_tabs(name,description,root_ids) values ('Empty','No roots yet','{}');`);

    events.push(await upload("plain-first", ["Check the rungs.", "Then the feet."]));
    const first = await submit(events[0]!, [
      claim("Acme inspects ladders in two steps", "acme", { type: "sequence", complete: true, mode: null }),
      claim("Acme checks the rungs", "acme"), claim("Acme checks the feet", "acme"), claim("Acme logs the check", "acme"),
      member(1, 0, 2), member(2, 0, 1), member(3, 0, 3),
      claim("Acme Old trains staff", "acme-old"), claim("Gone Co sells ladders", "gone"),
    ]);
    expect(first.map((row) => row.outcome)).toEqual(Array(9).fill("applied"));
    const unit = (index: number) => first[index]!.target_id;
    // A retired member, a retired link, a retired claim, a merged and a retired entity, a claim with no context
    await store.pg.query("update units set retired_at=now() where id=$1", [unit(3)]);
    await store.pg.query("update relationships set retired_at=now() where from_unit_id=$1 and type='part_of'", [unit(2)]);
    await store.pg.query("update units set retired_at=now() where id=$1", [unit(8)]);
    await store.pg.exec(`update entities set merged_into_id=(select id from entities where key='acme') where key='acme-old';
      update entities set retired_at=now() where key='gone';`);
    const bare = await store.pg.query<{ id: string }>("insert into revisions(unit_id,content,source_date,event_id,author) values($1,'Acme checks the feet first',now(),$2,'ai') returning id", [unit(2), events[0]]);
    await store.pg.query("update units set current_revision_id=$1 where id=$2", [bare.rows[0]!.id, unit(2)]);
    await submit(null, [{ type: "set_epistemic_status", targetId: unit(1), input: { epistemicStatus: "disputed" } }]);

    events.push(await upload("plain-second", ["Acme now checks ladders weekly."]));
    events.push(await upload("plain-empty", []));
    events.push("00000000-0000-4000-8000-0000000000ff");
    before = await read();
    await store.pg.exec(await readFile(resolve("supabase/migrations", MIGRATION), "utf8"));
  }, 120_000);
  afterAll(async () => { await store?.pg.close(); });

  it("returns exactly what the wrapper chain returned", async () => {
    expect(await read()).toEqual(before);
    // Sanity: the fixture exercised every layer
    const input = before[0] as { existingUnits: { context: { entities: { key: string }[] } | null; memberUnitIds: string[] }[]; domainTabs: { rootPaths: string[] }[] };
    expect(input.existingUnits.some((unit) => unit.memberUnitIds.length === 1)).toBe(true);
    expect(input.existingUnits.some((unit) => unit.context === null)).toBe(true);
    expect(input.existingUnits.flatMap((unit) => unit.context?.entities.map((entity) => entity.key) ?? [])).not.toContain("acme-old");
    expect(input.domainTabs.map((tab) => tab.rootPaths)).toContainEqual(["Safety"]);
    expect(before[3]).toBeNull();
  });

  it("leaves no _before_ layer behind", async () => {
    const { rows } = await store.pg.query<{ proname: string }>("select proname from pg_proc where proname like 'reconciliation_input%'");
    expect(rows.map((row) => row.proname)).toEqual(["reconciliation_input"]);
  });
});
