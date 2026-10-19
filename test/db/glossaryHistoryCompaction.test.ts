import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

describe("reversible glossary history compaction", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); }, 60000);
  afterAll(async () => { await store?.pg.close(); });
  const entry = (meaningId: string, definition = "A definition with enough content. ".repeat(40)) => ({ meaningId, term: meaningId, definition });
  const entries = Array.from({ length: 30 }, (_, i) => entry(`meaning-${i}`));
  const before = { entries, inputHash: "old", generatedAt: "old", identityRegistry: { shared: "same", removed: "old" }, pendingEntries: [{ id: 1 }, { id: 2 }], definitionOverrides: {} };
  const after = { ...before, entries: [entry("new"), ...entries.slice(1).reverse()], inputHash: "new", generatedAt: "new", identityRegistry: { shared: "same", added: "new" }, pendingEntries: [], definitionOverrides: { a: null } };

  it("round-trips metadata patches including empty arrays, absent keys and JSON null", async () => {
    for (const [oldValue, newValue] of [[before, after], [{ x: null }, {}], [[], [1]], [{}, { x: null }], [[1, 2], []]]) {
      const result = await store.pg.query<{ restored: unknown }>("select change_control.history_apply_patch($2,change_control.history_restore_patch($1,$2)) restored", [JSON.stringify(oldValue), JSON.stringify(newValue)]);
      expect(result.rows[0]?.restored).toEqual(oldValue);
    }
  });

  it("preserves ordering, removals, definition history and all undo metadata", async () => {
    const input = { snapshot: after, added: ["new"], removed: ["meaning-0"], revised: [] };
    const result = await store.pg.query<{ compacted: { input: { snapshot: { entries: unknown[] }; glossaryDelta: { afterOrder: string[] } }; undo_state: unknown } }>("select change_control.compact_glossary_history($1,$2) compacted", [JSON.stringify(input), JSON.stringify(before)]);
    const compacted = result.rows[0]!.compacted;
    expect(compacted.input.glossaryDelta).toBeTruthy();
    expect(compacted.input.snapshot.entries).toEqual([entry("new")]);
    expect(compacted.input.glossaryDelta.afterOrder).toEqual(after.entries.map((entry) => entry.meaningId));
    const restored = await store.pg.query<{ snapshot: unknown }>("select change_control.expand_glossary_history($1,$2,$3) snapshot", [JSON.stringify(compacted.input), JSON.stringify(compacted.undo_state), JSON.stringify(after.entries)]);
    expect(restored.rows[0]?.snapshot).toEqual(before);
    await expect(store.pg.query("select change_control.expand_glossary_history($1,$2,'[]')", [JSON.stringify(compacted.input), JSON.stringify(compacted.undo_state)])).rejects.toThrow("dictionary changed later");
  });

  it("undoes a compacted action through the existing public change-control path", async () => {
    await store.pg.query("update public.glossary_state set entries=$1,status='ready',generated_at=clock_timestamp() where id", [JSON.stringify(entries)]);
    const next = entries.map((e, i) => i === 3 ? { ...e, definition: "Changed definition." } : e);
    await store.pg.query("update public.glossary_state set entries=$1,status='ready',generated_at=clock_timestamp() where id", [JSON.stringify(next)]);
    const action = (await store.pg.query<{ id: string; change_set_id: string }>("select id,change_set_id from public.actions where type::text='glossary_update' order by created_at desc,id desc limit 1")).rows[0]!;
    await store.pg.query(`update public.actions a set input=c.value->'input',undo_state=c.value->'undo_state' from (select id,change_control.compact_glossary_history(input,undo_state) value from public.actions where id=$1) c where a.id=c.id`, [action.id]);
    expect((await store.pg.query<{ compacted: boolean }>("select input ? 'glossaryDelta' compacted from public.actions where id=$1", [action.id])).rows[0]?.compacted).toBe(true);
    await store.db.call("revert_change_set", { p_change_set_id: action.change_set_id });
    expect((await store.pg.query<{ entries: unknown }>("select entries from public.glossary_state where id")).rows[0]?.entries).toEqual(entries);
  });

  it("keeps twenty recent full records and automatically compacts older writes", async () => {
    const set = (await store.pg.query<{ id: string }>("select id from public.change_sets limit 1")).rows[0]!.id;
    for (let i = 0; i < 23; i++) {
      await store.pg.query(`insert into public.actions(id,change_set_id,position,type,input,undo_state,outcome,created_at)
       values((left(gen_random_uuid()::text,35)||'1')::uuid,$1,100+$2,'glossary_update',$3,$4,'applied',clock_timestamp()+$2*interval '1 second')`,
      [set, i, JSON.stringify({ snapshot: after }), JSON.stringify(before)]);
    }
    const recent = await store.pg.query<{ compacted: boolean }>("select input ? 'glossaryDelta' compacted from public.actions where type='glossary_update' order by created_at desc,id desc limit 20");
    expect(recent.rows).toHaveLength(20);
    expect(recent.rows.every((row) => !row.compacted)).toBe(true);
    const older = await store.pg.query<{ count: number }>("select count(*)::int count from public.actions where type='glossary_update' and position>=100 and input ? 'glossaryDelta'");
    expect(older.rows[0]?.count).toBe(3);
  });

  it("stores reviewed decision deltas directly and preserves periodic full checkpoints", async () => {
    const definition = (await store.pg.query<{ definition: string }>("select pg_get_functiondef('change_control.compact_new_glossary_history()'::regprocedure) definition")).rows[0]!.definition;
    expect(definition).toContain("new.input->>'operation'='Reviewed'");
    const expected = (await store.pg.query<{ value: { input: { glossaryDelta?: unknown } } }>("select change_control.compact_glossary_history($1,$2) value", [JSON.stringify({ operation: "Reviewed", snapshot: after }), JSON.stringify(before)])).rows[0]!.value;
    expect(Boolean(expected.input.glossaryDelta)).toBe(true);
    const set = (await store.pg.query<{ id: string }>("select id from public.change_sets limit 1")).rows[0]!.id;
    for (const suffix of ["1", "0"]) {
      const id = (await store.pg.query<{ id: string }>("select (left(gen_random_uuid()::text,35)||$1)::uuid id", [suffix])).rows[0]!.id;
      await store.pg.query("insert into public.actions(id,change_set_id,position,type,input,undo_state,outcome) values($1,$2,$5,'glossary_update',$3,$4,'applied')", [id, set, JSON.stringify({ operation: "Reviewed", snapshot: after }), JSON.stringify(before), 200 + Number(suffix)]);
      const saved = (await store.pg.query<{ input: { glossaryDelta?: unknown }; undo_state: unknown }>("select input,undo_state from public.actions where id=$1", [id])).rows[0]!;
      expect(Boolean(saved.input.glossaryDelta)).toBe(suffix === "1");
      if (suffix === "1") {
        const restored = await store.pg.query<{ snapshot: unknown }>("select change_control.expand_glossary_history($1,$2,$3) snapshot", [JSON.stringify(saved.input), JSON.stringify(saved.undo_state), JSON.stringify(after.entries)]);
        expect(restored.rows[0]?.snapshot).toEqual(before);
      } else expect(saved.undo_state).toEqual(before);
    }
  });
});
