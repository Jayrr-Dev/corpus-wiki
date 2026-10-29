import type { GlossaryEntry, PendingGlossaryEntry } from "@/lib/glossary/entries";
import { glossaryRegistry } from "@/lib/glossary/identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

const id = "f0000000-0000-4000-8000-000000000001";
const otherId = "f0000000-0000-4000-8000-000000000002";
const entry = (meaningId = id): GlossaryEntry => ({ meaningId, term: "Four-gas monitor", expansion: null, aliases: ["Four-gas detector"],
  definition: "An instrument that measures oxygen, flammable gas, carbon monoxide and hydrogen sulfide.", category: "technical term", context: null, scopeKey: "[null]",
  citations: [{ unitId: "u1", revisionId: "r1", sourceId: "s1", sourceTitle: "Safety" }], originKeys: [meaningId], historyKeys: ["four-gas monitor||[null]"],
  usageNotes: [{ context: "Brightwater", text: "The attendant monitors the atmosphere throughout entry.", citations: [{ unitId: "u1", revisionId: "r1", sourceId: "s1", sourceTitle: "Safety" }] }] });

describe("canonical glossary publication", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); }, 60000);
  afterAll(async () => { await store?.pg.close(); });
  beforeEach(async () => { await store.pg.exec("update glossary_state set entries='[]',pending_entries='[]',identity_registry='{}',definition_overrides='{}',batches='{}',input_hash=null,status='idle',lease_token=null,lease_until=null"); });
  const state = async () => (await store.pg.query<{ entries: GlossaryEntry[]; pending_entries: PendingGlossaryEntry[]; definition_overrides: Record<string, unknown>; identity_registry: Record<string, string> }>("select * from glossary_state")).rows[0]!;
  async function publish(entries = [entry()], pending: PendingGlossaryEntry[] = []) {
    const token = await store.db.call<string>("claim_glossary_generation", { p_hash: "test", p_force: true });
    await store.db.call("publish_glossary_meanings", { p_token: token, p_hash: "test", p_entries: entries, p_pending: pending,
      p_registry: glossaryRegistry([...entries, ...pending.map((item) => item.entry)], {}), p_batches: {} });
  }


  it("Auto Decide defaults off, fences stale choices and records AI changes with undo", async () => {
    const proposed = { ...entry(otherId), term: "Four-gas detector", citations: [entry().citations[0]!, { unitId: "u2", revisionId: "r2", sourceId: "s2", sourceTitle: "Instrument manual" }] };
    const pending: PendingGlossaryEntry = { entry: proposed, candidateIds: [id], reason: "Check this scope.", relationship: "uncertain" };
    await publish([entry()], [pending]);
    const args = { p_item: pending, p_candidates: [entry()], p_decision: "merge", p_target: id, p_definition: entry().definition, p_reason: "These describe the same instrument." };
    expect(await store.db.call("get_glossary_auto_decide")).toBeNull();
    expect(await store.db.call("apply_glossary_auto_decision", args)).toBe(false);
    await store.db.call("set_glossary_auto_decide", { p_enabled: true });
    expect(await store.db.call("apply_glossary_auto_decision", { ...args, p_candidates: [] })).toBe(false);
    expect(await store.db.call("apply_glossary_auto_decision", args)).toBe(true);
    expect((await state()).pending_entries).toEqual([]);
    expect((await state()).entries[0]?.personEdited).toBe(false);
    expect((await state()).entries[0]?.redirectIds).toContain(otherId);
    expect((await state()).entries[0]?.citations).toHaveLength(2);
    expect((await state()).entries[0]?.citations).toEqual(expect.arrayContaining(proposed.citations));
    expect(await store.db.call("apply_glossary_auto_decision", args)).toBe(false);
    const audit = (await store.pg.query<{ id: string; proposed_by: string; undo_state: { pendingEntries: unknown[] }; delta: boolean; stored_entries: number }>("select a.id,a.undo_state,c.proposed_by,a.input ? 'glossaryDelta' delta,jsonb_array_length(a.input->'snapshot'->'entries') stored_entries from actions a join change_sets c on c.id=a.change_set_id where a.type::text='glossary_update' order by a.applied_at desc limit 1")).rows[0]!;
    expect(audit.undo_state.pendingEntries).toHaveLength(1);
    expect(audit.delta).toBe(true);
    expect(audit.stored_entries).toBe(1);
    expect(audit.proposed_by).toBe("ai");
    const revert = "f0000000-0000-4000-8000-000000000004";
    await store.pg.query("insert into shift_events(id,cause,actor,status) values($1,'edit','person','applied')", [revert]);
    await store.pg.query("select change_control.undo_action(a,$1) from actions a where id=$2", [revert, audit.id]);
    expect((await state()).pending_entries).toEqual([pending]);
    expect((await state()).entries).toEqual([entry()]);
    await store.db.call("set_glossary_auto_decide", { p_enabled: false });
  });

  it("Auto Decide protects manual text and stops when disabled or generation is active", async () => {
    const saved = { ...entry(), personEdited: true };
    const pending: PendingGlossaryEntry = { entry: entry(otherId), candidateIds: [id], reason: "Check", relationship: "uncertain" };
    await publish([saved], [pending]);
    await store.db.call("set_glossary_auto_decide", { p_enabled: true });
    const args = { p_item: pending, p_candidates: [saved], p_decision: "merge", p_target: id, p_definition: "An unwanted replacement definition.", p_reason: "Same meaning" };
    await expect(store.db.call("apply_glossary_auto_decision", args)).rejects.toThrow("manual definition");
    await store.db.call("set_glossary_auto_decide", { p_enabled: false });
    expect(await store.db.call("apply_glossary_auto_decision", { ...args, p_decision: "keep" })).toBe(false);
    await store.db.call("set_glossary_auto_decide", { p_enabled: true });
    await store.db.call("claim_glossary_generation", { p_hash: "next", p_force: true });
    expect(await store.db.call("get_glossary_auto_decide")).toBeNull();
    expect(await store.db.call("apply_glossary_auto_decision", { ...args, p_decision: "keep" })).toBe(false);
    await store.db.call("set_glossary_auto_decide", { p_enabled: false });
  });
  it("publishes one meaning with separately cited local usage and immutable identity metadata in history", async () => {
    await publish();
    expect((await state()).entries).toEqual([entry()]);
    const audit = (await store.pg.query<{ undo_state: { identityRegistry: unknown }; snapshot: { entries: GlossaryEntry[]; identityRegistry: unknown } }>(
      "select undo_state,input->'snapshot' snapshot from actions where type::text='glossary_update' order by applied_at desc limit 1")).rows[0]!;
    expect(audit.snapshot.entries[0]?.usageNotes).toHaveLength(1);
    expect(audit.snapshot.identityRegistry).toEqual({ [id]: id });
    expect(audit.undo_state.identityRegistry).toEqual({});
  });

  it("records added, revised and removed meanings while preserving both cited snapshots", async () => {
    const removed = { ...entry(otherId), term: "Removed meaning" };
    await publish([entry(), removed]);
    const revised = { ...entry(), definition: "A revised instrument definition that preserves its original citations." };
    const added = { ...entry("f0000000-0000-4000-8000-000000000003"), term: "Added meaning" };
    await publish([revised, added]);
    const audit = (await store.pg.query<{ input: { added: string[]; revised: string[]; removed: string[]; snapshot: { entries: GlossaryEntry[] } }; undo_state: { entries: GlossaryEntry[] } }>(
      "select input,undo_state from actions where type::text='glossary_update' order by applied_at desc limit 1")).rows[0]!;
    expect(audit.input.added).toEqual([added.term]);
    expect(audit.input.revised).toEqual([revised.term]);
    expect(audit.input.removed).toEqual([removed.term]);
    expect(audit.input.snapshot.entries).toEqual([revised, added]);
    expect(audit.undo_state.entries).toEqual([entry(), removed]);
  });

  it("finalizes batch progress when publishing saved work after a recovery claim", async () => {
    await store.pg.exec("update glossary_state set total_batches=66,completed_batches=0");
    await publish();
    const progress = (await store.pg.query<{ completed_batches: number; total_batches: number }>(
      "select completed_batches,total_batches from glossary_state")).rows[0]!;
    expect(progress).toEqual({ completed_batches: 66, total_batches: 66 });
  });

  it("rejects duplicate identities and overlapping origins atomically", async () => {
    await expect(publish([entry(), entry()])).rejects.toThrow("Duplicate glossary meaning identity");
    expect((await state()).entries).toEqual([]);
    await store.pg.exec("update glossary_state set lease_token=null,lease_until=null,status='idle'");
    await expect(publish([entry(), { ...entry(otherId), originKeys: [id] }])).rejects.toThrow("One glossary origin");
    expect((await state()).entries).toEqual([]);
  });

  it("fences a late writer after another worker has claimed the glossary", async () => {
    const stale = await store.db.call<string>("claim_glossary_generation", { p_hash: "old" });
    await store.pg.exec("update glossary_state set lease_until=now()-interval '1 minute'");
    await publish();
    await expect(store.db.call("publish_glossary_meanings", { p_token: stale, p_hash: "old", p_entries: [], p_pending: [], p_registry: {}, p_batches: {} })).rejects.toThrow("Another glossary generation");
    expect((await state()).entries).toHaveLength(1);
  });

  it("keeps manual definitions and deletions through later generation", async () => {
    await publish();
    const manual = "A manually reviewed instrument definition with all four gas categories.";
    await store.db.call("edit_glossary_definition", { p_original: entry(), p_definition: manual });
    await publish();
    expect((await state()).entries[0]?.definition).toBe(manual);
    expect((await state()).entries[0]?.usageNotes).toHaveLength(1);
    await store.db.call("edit_glossary_definition", { p_original: { ...entry(), definition: manual }, p_definition: null });
    await publish();
    expect((await state()).entries).toEqual([]);
  });

  it("holds uncertainty outside published meanings and lets a person keep it distinct", async () => {
    const proposed = entry(otherId);
    const pending: PendingGlossaryEntry = { entry: proposed, candidateIds: [id], reason: "Check this scope.", relationship: "uncertain" };
    await publish([entry()], [pending]);
    expect((await state()).entries).toHaveLength(1);
    await store.db.call("resolve_glossary_pending", { p_id: otherId, p_decision: "keep" });
    expect((await state()).entries).toHaveLength(2);
    expect((await state()).pending_entries).toEqual([]);
    expect((await state()).definition_overrides[otherId]).toEqual({ separate: true });
  });

  it("merges a reviewed candidate with evidence, usage notes, and redirects intact", async () => {
    const proposed = { ...entry(otherId), term: "Four-gas detector", citations: [{ unitId: "u2", revisionId: "r2", sourceId: "s2", sourceTitle: "Instrument manual" }] };
    await publish([entry()], [{ entry: proposed, candidateIds: [id], reason: "Check equivalence.", relationship: "uncertain" }]);
    await store.db.call("resolve_glossary_pending", { p_id: otherId, p_decision: "merge", p_target: id, p_definition: "The reviewed combined meaning of this four-gas monitoring instrument.", p_expected: entry().definition });
    const saved = await state();
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]?.redirectIds).toContain(otherId);
    expect(saved.entries[0]?.usageNotes).toHaveLength(1);
    expect(saved.entries[0]?.citations).toHaveLength(2);
    expect(saved.entries[0]?.citations).toEqual(expect.arrayContaining([...entry().citations, ...proposed.citations]));
    expect(saved.identity_registry[otherId]).toBe(id);
    expect(saved.pending_entries).toEqual([]);
  });

  it("refuses to overwrite a definition edited after the review was opened", async () => {
    await publish([entry()], [{ entry: entry(otherId), candidateIds: [id], reason: "Compare meanings.", relationship: "uncertain" }]);
    await store.db.call("edit_glossary_definition", { p_original: entry(), p_definition: "A newer manual definition that must not be overwritten." });
    await expect(store.db.call("resolve_glossary_pending", { p_id: otherId, p_decision: "merge", p_target: id,
      p_definition: "A proposed combined definition of the instrument.", p_expected: entry().definition })).rejects.toThrow("target definition changed");
    expect((await state()).entries[0]?.definition).toContain("newer manual");
    expect((await state()).pending_entries).toHaveLength(1);
  });

  it("undo of a review restores the pending candidate and its original identity mapping", async () => {
    const pending: PendingGlossaryEntry = { entry: entry(otherId), candidateIds: [id], reason: "Compare meanings.", relationship: "uncertain" };
    await publish([entry()], [pending]);
    await store.db.call("resolve_glossary_pending", { p_id: otherId, p_decision: "dismiss" });
    const action = (await store.pg.query<{ id: string }>("select id from actions where input->>'operation'='Reviewed' order by applied_at desc limit 1")).rows[0]!;
    const revert = "f0000000-0000-4000-8000-000000000003";
    await store.pg.query("insert into shift_events(id,cause,actor,status) values($1,'edit','person','applied')", [revert]);
    await store.pg.query("select change_control.undo_action(a,$1) from actions a where id=$2", [revert, action.id]);
    expect((await state()).pending_entries).toEqual([pending]);
    expect((await state()).definition_overrides).toEqual({});
  });

  it("undo restores a manual edit and its override metadata together", async () => {
    await publish();
    const changeSet = await store.db.call<string>("edit_glossary_definition", { p_original: entry(), p_definition: "A manually corrected meaning for the same instrument." });
    await store.pg.query("insert into shift_events(id,cause,actor,status) values($1,'edit','person','applied')", [otherId]);
    await store.pg.query("select change_control.undo_action(a,$1) from actions a where change_set_id=$2", [otherId, changeSet]);
    expect((await state()).entries[0]?.definition).toBe(entry().definition);
    expect((await state()).definition_overrides).toEqual({});
    const snapshot = (await store.pg.query<{ value: unknown }>("select input->'snapshot'->'definitionOverrides' value from actions where type::text='glossary_update' order by applied_at desc limit 1")).rows[0]!.value;
    expect(snapshot).toEqual({});
  });

  it("does not expose mutation RPCs to browser clients", async () => {
    const result = await store.pg.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.publish_glossary_meanings(uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb)','execute') allowed");
    expect(result.rows[0]?.allowed).toBe(false);
  });
});
