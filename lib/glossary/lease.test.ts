import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { portablePostgres } from "@/test/db/portablePostgres";

describe("persistent dictionary generation", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); });
  afterAll(async () => { await store.pg.close(); });
  beforeEach(async () => { await store.pg.exec("begin"); });
  afterEach(async () => { await store.pg.exec("rollback"); });

  it("permits only one generator and skips unchanged knowledge", async () => {
    const first = await store.db.call<string>("claim_glossary_generation", { p_hash: "knowledge-1" });
    expect(first).toMatch(/^[\da-f-]+$/);
    expect(await store.db.call("claim_glossary_generation", { p_hash: "knowledge-2", p_force: true })).toBeNull();
    await store.pg.exec("update public.glossary_state set input_hash='knowledge-1',status='ready',lease_token=null,lease_until=null");
    expect(await store.db.call("claim_glossary_generation", { p_hash: "knowledge-1" })).toBeNull();
    expect(await store.db.call("claim_glossary_generation", { p_hash: "knowledge-2" })).toBeTruthy();
  });
  it("recovers an expired generator and preserves the last published dictionary", async () => {
    await store.pg.exec(`update public.glossary_state set status='generating',lease_until=now()-interval '1 minute',entries='[{"term":"PPE"}]'::jsonb`);
    expect(await store.db.call("claim_glossary_generation", { p_hash: "knowledge-3" })).toBeTruthy();
    const result = await store.pg.query<{ entries: unknown }>("select entries from public.glossary_state");
    expect(result.rows[0]?.entries).toEqual([{ term: "PPE" }]);
  });
  it("allows signed-in reads but denies browser writes and generation claims", async () => {
    const access = await store.pg.query<{ read: boolean; write: boolean; claim: boolean }>(`select
      has_table_privilege('authenticated','public.glossary_state','SELECT') as read,
      has_table_privilege('authenticated','public.glossary_state','UPDATE') as write,
      has_function_privilege('authenticated','public.claim_glossary_generation(text,boolean)','EXECUTE') as claim`);
    expect(access.rows[0]).toEqual({ read: true, write: false, claim: false });
  });

  const definition = { term: "PPE", expansion: null, aliases: [], category: "acronym", definition: "Equipment worn to reduce workplace exposure.", context: null, scopeKey: "general", citations: [] };
  async function publish() {
    await store.pg.query("update public.glossary_state set entries=$1,status='ready',input_hash='v1',generated_at=clock_timestamp() where id", [JSON.stringify([definition])]);
    return (await store.pg.query<{ id: string }>("select id from public.change_sets where summary like 'Generated glossary:%' order by created_at desc limit 1")).rows[0]!.id;
  }

  it("publishes one atomic Glossary change with the definition diff and supports Undo", async () => {
    const changeSetId = await publish();
    const action = await store.pg.query<{ type: string; input: { added: string[] } }>("select type,input from public.actions where change_set_id=$1", [changeSetId]);
    expect(action.rows[0]?.type).toBe("glossary_update");
    expect(action.rows[0]?.input.added).toEqual(["PPE"]);
    await store.db.call("revert_change_set", { p_change_set_id: changeSetId });
    const state = (await store.pg.query<{ entries: unknown[]; input_hash: string }>("select entries,input_hash from public.glossary_state")).rows[0]!;
    expect(state.entries).toEqual([]);
    expect(state.input_hash).toBe("v1");
    expect((await store.pg.query("select id from public.change_sets where summary like 'Restored glossary:%' and proposed_by='person'")).rows).toHaveLength(1);
  });

  it("audits manual edits as a person and rejects a stale edit", async () => {
    await publish();
    await store.db.call("edit_glossary_definition", { p_original: definition, p_definition: "Protective equipment worn by workers." });
    expect((await store.pg.query("select id from public.change_sets where summary like 'Updated glossary:%' and proposed_by='person'")).rows).toHaveLength(1);
    await expect(store.db.call("edit_glossary_definition", { p_original: definition, p_definition: "Overwrite a stale definition" })).rejects.toThrow("definition changed");
  });

  it("prevents an expired worker from overwriting a recovered manual edit", async () => {
    await publish();
    const token = await store.db.call<string>("claim_glossary_generation", { p_hash: "v2", p_force: true });
    await store.pg.exec("update public.glossary_state set lease_until=now()-interval '1 minute'");
    await store.db.call("edit_glossary_definition", { p_original: definition, p_definition: "The person's recovered definition." });
    const staleWrite = await store.pg.query("update public.glossary_state set entries='[]' where lease_token=$1 returning id", [token]);
    expect(staleWrite.rows).toEqual([]);
  });

  it("retrieves embedded meanings only for the active dictionary and selected embedding model", async () => {
    await publish();
    const vector = Array.from({ length: 1024 }, (_, index) => index === 0 ? 1 : 0);
    expect(await store.db.call("save_glossary_embeddings", { p_rows: [{ hash: "ppe-v1", model: "test", entry: definition, embedding: vector }] })).toBe(1);
    const search = async (model = "test") => (await store.pg.query<{ entry: typeof definition; similarity: number }>("select * from public.search_glossary($1,$2)", [model, JSON.stringify(vector)])).rows;
    expect((await search())[0]?.entry.term).toBe("PPE");
    expect(await search("another-model")).toEqual([]);
    expect(await store.db.call("missing_glossary_embeddings", { p_model: "test" })).toEqual([]);
    await store.db.call("edit_glossary_definition", { p_original: definition, p_definition: "An updated, supported meaning." });
    expect(await search()).toEqual([]);
    expect(await store.db.call("missing_glossary_embeddings", { p_model: "test" })).toHaveLength(1);
    expect(await store.db.call("save_glossary_embeddings", { p_rows: [{ hash: "stale-write", model: "test", entry: definition, embedding: vector }] })).toBe(0);
  });
});
