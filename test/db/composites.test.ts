import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { KnowledgeContext } from "@/lib/knowledge/context";

// Composite claims: a procedure and its ordered steps, a list and its items
describe("composite claims in PostgreSQL", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => {
    store = await portablePostgres();
    await store.pg.exec("insert into entities(type,key,name) values ('company','stepco','StepCo')");
  }, 60000);
  afterAll(async () => { await store?.pg.close(); });

  const context: KnowledgeContext = { entities: [{ type: "company", key: "stepco", role: "subject" }], applicability: { status: "scoped", entities: [{ type: "company", key: "stepco" }], conditions: null } };
  const sequence = { type: "sequence", complete: true, mode: null };
  type Action = { type: string; input: unknown; targetId?: string | null; expectedRevisionId?: string | null };
  async function submit(actions: Action[]) {
    const draft = await store.db.call<{ changeSetId: string; eventId: string }>("submit_change_set", {
      p_event_id: null, p_cause: "edit", p_actor: "person", p_summary: "Composite test", p_trace: {},
      p_actions: actions.map((action) => ({ targetId: null, expectedRevisionId: null, passageIds: [], speechAct: "stated", ...action })),
    });
    await store.db.call("commit_change_set", { p_change_set_id: draft.changeSetId });
    const rows = (await store.pg.query<{ target_id: string; after_revision_id: string; outcome: string }>(
      "select target_id, after_revision_id, outcome from actions where change_set_id=$1 order by position", [draft.changeSetId])).rows;
    return { ...draft, rows };
  }
  const claim = (content: string, structure?: unknown): Action => ({
    type: "add_claim", input: { content, kind: "procedure", epistemicStatus: "supported", entities: context.entities, domainPaths: [], context, ...(structure === undefined ? {} : { structure }) },
  });
  const member = (from: number, to: number, memberPosition?: number): Action => ({
    type: "link", input: { toUnitId: null, type: "part_of", fromPosition: from, toPosition: to, ...(memberPosition === undefined ? {} : { memberPosition }) },
  });
  const steps = async (composite: string) => (await store.pg.query<{ content: string; position: number | null }>(
    `select r.content, l.position from relationships l join units u on u.id=l.from_unit_id join revisions r on r.id=u.current_revision_id
     where l.to_unit_id=$1 and l.type='part_of' and l.retired_at is null order by l.position nulls last, l.created_at`, [composite])).rows;
  const structureOf = async (unit: string) => (await store.pg.query<{ structure: unknown }>(
    "select r.structure from units u join revisions r on r.id=u.current_revision_id where u.id=$1", [unit])).rows[0]!.structure;

  it("creates a procedure and its ordered steps in one ChangeSet", async () => {
    const made = await submit([
      claim("StepCo locks out a machine in three steps", sequence),
      claim("StepCo shuts the machine down"), claim("StepCo isolates its energy sources"), claim("StepCo applies its lock"),
      member(1, 0, 1), member(2, 0, 2), member(3, 0, 3),
    ]);
    expect(made.rows.map((row) => row.outcome)).toEqual(Array(7).fill("applied"));
    const composite = made.rows[0]!.target_id;
    expect(await structureOf(composite)).toEqual(sequence);
    expect((await steps(composite)).map((step) => step.position)).toEqual([1, 2, 3]);
    // The event touched the composite through its new links
    const touched = (await store.pg.query<{ id: string }>("select public.living_page_event_units($1) id", [made.eventId])).rows.map((row) => row.id);
    expect(touched).toContain(composite);
  });

  it("rejects a bad shape and a position on a set or a plain claim", async () => {
    const bad = await submit([claim("StepCo has a broken shape", { type: "tree", complete: true })]);
    expect(bad.rows[0]!.outcome).toBe("rejected");
    const made = await submit([
      claim("StepCo's kit is a helmet and gloves", { type: "set", complete: true, mode: "all" }),
      claim("StepCo's kit includes a helmet"), claim("StepCo also reviews the kit"),
      member(1, 0, 1), member(2, 0),
    ]);
    expect(made.rows.map((row) => row.outcome)).toEqual(["applied", "applied", "applied", "rejected", "applied"]);
    const plain = await submit([claim("StepCo trains staff"), claim("StepCo trains staff yearly"), member(1, 0, 1)]);
    expect(plain.rows[2]!.outcome).toBe("rejected");
  });

  it("moves and removes a step, keeps the shape through a revise, and undoes", async () => {
    const made = await submit([
      claim("StepCo restarts a machine in two steps", sequence), claim("StepCo removes its lock"), claim("StepCo starts the machine"),
      member(1, 0, 1), member(2, 0, 2),
    ]);
    const composite = made.rows[0]!.target_id, second = made.rows[2]!.target_id;
    const moved = await submit([{ type: "set_member", targetId: composite, input: { memberUnitId: second, position: 0 } }]);
    expect(moved.rows[0]!.outcome).toBe("rejected");
    const first = await submit([{ type: "set_member", targetId: composite, input: { memberUnitId: second, position: 1 } },
      { type: "set_member", targetId: composite, input: { memberUnitId: made.rows[1]!.target_id, position: 2 } }]);
    expect((await steps(composite)).map((step) => step.content)).toEqual(["StepCo starts the machine", "StepCo removes its lock"]);
    const removed = await submit([{ type: "set_member", targetId: composite, input: { memberUnitId: second, remove: true } }]);
    expect(removed.rows[0]!.outcome).toBe("applied");
    expect(await steps(composite)).toHaveLength(1);

    const revised = await submit([{ type: "revise_claim", targetId: composite, expectedRevisionId: made.rows[0]!.after_revision_id, input: { content: "StepCo restarts a machine safely" } }]);
    expect(revised.rows[0]!.outcome).toBe("applied");
    expect(await structureOf(composite)).toEqual(sequence);

    await store.db.call("revert_change_set", { p_change_set_id: removed.changeSetId });
    await store.db.call("revert_change_set", { p_change_set_id: first.changeSetId });
    expect((await steps(composite)).map((step) => step.position)).toEqual([1, 2]);
    expect((await steps(composite)).map((step) => step.content)).toEqual(["StepCo removes its lock", "StepCo starts the machine"]);
  });

  it("shows a section's composite with its steps in order, wherever the steps are filed", async () => {
    const made = await submit([
      claim("StepCo cleans a spill in three steps", sequence), claim("StepCo stops the leak"), claim("StepCo contains the spill"), claim("StepCo reports the spill"),
      member(2, 0, 2), member(3, 0, 3), member(1, 0, 1),
    ]);
    const page = (await store.pg.query<{ id: string }>("insert into pages(title,slug) values('Spills','spills') returning id")).rows[0]!.id;
    const section = (await store.pg.query<{ id: string }>("insert into sections(page_id,position,title,query,status) values($1,0,'Cleanup',$2,'current') returning id",
      [page, JSON.stringify({ unitIds: [made.rows[0]!.target_id] })])).rows[0]!.id;
    const state = await store.db.call<{ units: { content: string; structure?: unknown; memberOf?: string; position?: number }[] }>("read_section_state", { p_section_id: section });
    expect(state.units.map((unit) => unit.content)).toEqual(["StepCo cleans a spill in three steps", "StepCo stops the leak", "StepCo contains the spill", "StepCo reports the spill"]);
    expect(state.units[0]).toMatchObject({ structure: sequence });
    expect(state.units.slice(1).map((unit) => [unit.memberOf, unit.position])).toEqual([1, 2, 3].map((position) => [made.rows[0]!.target_id, position]));
  });

  it("keeps the shape when a duplicate composite is merged, and lists members for the next upload", async () => {
    const a = await submit([claim("StepCo inspects a ladder in two steps", sequence), claim("StepCo checks the rungs"), member(1, 0, 1)]);
    const b = await submit([claim("StepCo inspects a ladder in two steps.", sequence), claim("StepCo checks the feet"), member(1, 0, 2)]);
    const kept = a.rows[0]!.target_id;
    const merged = await submit([{ type: "merge_duplicates", targetId: kept, expectedRevisionId: a.rows[0]!.after_revision_id, input: { duplicateUnitIds: [b.rows[0]!.target_id], autoMerge: true } }]);
    expect(merged.rows[0]!.outcome).toBe("applied");
    expect(await structureOf(kept)).toEqual(sequence);
    expect((await steps(kept)).map((step) => step.content)).toEqual(["StepCo checks the rungs", "StepCo checks the feet"]);

    const upload = await store.db.call<{ eventId: string }>("ingest_source", {
      p_title: "ladder.md", p_mime_type: "text/markdown", p_source_date: "2026-11-09T00:00:00Z", p_hash: "composite-test",
      p_storage_path: "test/ladder.md", p_passages: [{ position: 0, text: "Check the rungs, then the feet.", location: {}, hash: "composite-passage", speakerLabel: null }], p_byte_size: null, p_page_count: null,
    });
    const input = await store.db.call<{ existingUnits: { unitId: string; structure: unknown; memberUnitIds: string[] }[] }>("reconciliation_input", { p_event_id: upload.eventId });
    const known = input.existingUnits.find((unit) => unit.unitId === kept)!;
    expect(known.structure).toEqual(sequence);
    expect(known.memberUnitIds).toEqual([a.rows[1]!.target_id, b.rows[1]!.target_id]);
  });
});
