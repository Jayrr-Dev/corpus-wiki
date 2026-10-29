import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

type Mark = { kind: string; key: string; version: number };

// Every committed claim change marks what was built from the claim, in the same transaction
describe("stale marks in PostgreSQL", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); }, 60000);
  afterAll(async () => { await store?.pg.close(); });

  const glossaryKinds = ["glossary_claim", "glossary_entry"];
  const marks = async () => (await store.db.call<Mark[]>("read_stale_marks", { p_kinds: glossaryKinds }))
    .map(({ kind, key }) => `${kind}:${key}`).sort();
  const clearAll = async () => store.db.call("clear_stale_marks", { p_marks: await store.db.call<Mark[]>("read_stale_marks", { p_kinds: glossaryKinds }) });
  async function submit(type: string, input: unknown, targetId: string | null = null, expectedRevisionId: string | null = null) {
    const draft = await store.db.call<{ changeSetId: string }>("submit_change_set", {
      p_event_id: null, p_cause: "edit", p_actor: "person", p_summary: "Stale marks", p_trace: {},
      p_actions: [{ type, input, targetId, expectedRevisionId, passageIds: [], speechAct: "stated" }],
    });
    await store.db.call("commit_change_set", { p_change_set_id: draft.changeSetId });
    const action = (await store.pg.query<{ target_id: string; after_revision_id: string }>(
      "select target_id, after_revision_id from actions where change_set_id=$1", [draft.changeSetId])).rows[0]!;
    return { ...action, changeSetId: draft.changeSetId };
  }
  const entry = (meaningId: string, unitId: string, revisionId: string) => ({
    meaningId, term: meaningId, expansion: null, aliases: [], category: "general term", definition: "A definition backed by a claim.",
    context: null, scopeKey: "[null]", usageNotes: [], citations: [{ unitId, revisionId, sourceId: "source", sourceTitle: "Source" }],
  });
  async function publish(entries: unknown[], considered: { unitId: string; revisionId: string | null }[], cleared: Mark[] = []) {
    await store.pg.exec("update glossary_state set lease_token=null, lease_until=null, status='idle'");
    const token = await store.db.call<string>("claim_glossary_generation", { p_hash: `publish-${Math.random()}`, p_force: true });
    await store.db.call("publish_glossary_meanings", { p_token: token, p_hash: "published", p_entries: entries, p_pending: [], p_registry: {}, p_batches: {},
      p_considered: considered, p_complete: false, p_marks: cleared });
  }

  it("marks a new claim, then its entries on revise, and the same items on Undo", async () => {
    await clearAll();
    const added = await submit("add_claim", { content: "A torque wrench sets bolt tension", kind: "fact", epistemicStatus: "supported", entities: [], domainPaths: [] });
    expect(await marks()).toEqual([`glossary_claim:${added.target_id}`]);

    // The glossary read the claim and cites it from one meaning
    await publish([entry("meaning-torque", added.target_id, added.after_revision_id)], [{ unitId: added.target_id, revisionId: added.after_revision_id }],
      await store.db.call<Mark[]>("read_stale_marks", { p_kinds: glossaryKinds }));
    expect(await marks()).toEqual([]);
    const deps = await store.pg.query<{ kind: string; item_key: string }>("select kind, item_key from claim_dependencies where unit_id=$1 order by kind", [added.target_id]);
    expect(deps.rows).toEqual([{ kind: "glossary_claim", item_key: added.target_id }, { kind: "glossary_entry", item_key: "meaning-torque" }]);

    // An unrelated claim marks only itself
    const other = await submit("add_claim", { content: "Ladders are inspected monthly", kind: "fact", epistemicStatus: "supported", entities: [], domainPaths: [] });
    expect(await marks()).toEqual([`glossary_claim:${other.target_id}`]);
    await clearAll();

    const revised = await submit("revise_claim", { content: "A torque wrench sets and checks bolt tension" }, added.target_id, added.after_revision_id);
    const afterRevise = await marks();
    expect(afterRevise).toEqual([`glossary_claim:${added.target_id}`, "glossary_entry:meaning-torque"]);

    // Undo restores the old revision and marks exactly the same items
    await clearAll();
    await store.db.call("revert_upload_knowledge", { p_change_set_id: revised.changeSetId });
    expect(await marks()).toEqual(afterRevise);
  });

  it("keeps a mark set again after a stage read it", async () => {
    await clearAll();
    const added = await submit("add_claim", { content: "A gas detector warns of leaks", kind: "fact", epistemicStatus: "supported", entities: [], domainPaths: [] });
    const read = await store.db.call<Mark[]>("read_stale_marks", { p_kinds: glossaryKinds });
    await submit("revise_claim", { content: "A gas detector warns of leaks early" }, added.target_id, added.after_revision_id);
    await store.db.call("clear_stale_marks", { p_marks: read });
    expect(await marks()).toEqual([`glossary_claim:${added.target_id}`]);
  });

  it("rebuilds the same marks from canonical data", async () => {
    await clearAll();
    const added = await submit("add_claim", { content: "A harness arrests a fall", kind: "fact", epistemicStatus: "supported", entities: [], domainPaths: [] });
    await publish([entry("meaning-harness", added.target_id, added.after_revision_id)], [{ unitId: added.target_id, revisionId: added.after_revision_id }],
      await store.db.call<Mark[]>("read_stale_marks", { p_kinds: glossaryKinds }));
    // Every other live claim has been read at its current revision
    await store.pg.exec(`insert into claim_dependencies(space_id, kind, item_key, unit_id, revision_id)
      select space_id, 'glossary_claim', id::text, id, current_revision_id from units where retired_at is null on conflict do nothing`);
    await submit("retire_claim", { reason: "Superseded" }, added.target_id);
    const live = await marks();
    expect(live).toEqual([`glossary_claim:${added.target_id}`, "glossary_entry:meaning-harness"]);

    // Lost marks come back from the dependency rows
    await store.pg.exec("delete from stale_marks");
    await store.pg.exec("delete from claim_dependencies where kind = 'glossary_entry'");
    await store.db.call("rebuild_stale_marks");
    expect(await marks()).toEqual(live);
    const index = await store.pg.query("select 1 from claim_dependencies where kind = 'glossary_entry' and item_key = 'meaning-harness'");
    expect(index.rows).toHaveLength(1);
  });
});
