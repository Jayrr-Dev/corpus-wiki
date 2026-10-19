import { afterAll, beforeAll, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); });
afterAll(async () => { await store.pg.close(); });

it("publishes with large manual overrides and registry while preserving deletions, identities and lease fencing", async () => {
  await store.pg.exec("begin");
  try {
    const token = await store.db.call<string>("claim_glossary_generation", { p_hash: "publication-scalars" });
    const definition = "A person's saved definition. ".repeat(400);
    const originalRegistry = { existing: "stable-identity", padding: "registry ".repeat(4000) };
    await store.pg.query("update glossary_state set definition_overrides=$1,identity_registry=$2", [JSON.stringify({ keep: { definition }, removed: { deleted: true } }), JSON.stringify(originalRegistry)]);
    const args = { p_token: token, p_hash: "publication-scalars", p_entries: [{ meaningId: "keep", term: "Kept", definition: "Generated replacement", usageNotes: [] }, { meaningId: "removed", term: "Deleted", definition: "Generated", usageNotes: [] }], p_pending: [], p_registry: { added: "new-identity" }, p_batches: {} };
    await store.pg.exec("savepoint wrong_owner");
    await expect(store.db.call("publish_glossary_meanings", { ...args, p_token: crypto.randomUUID() })).rejects.toThrow("Another glossary generation took over");
    await store.pg.exec("rollback to savepoint wrong_owner");
    await store.db.call("publish_glossary_meanings", args);
    const state = (await store.pg.query<{ entries: { definition: string; personEdited: boolean }[]; identity_registry: unknown; status: string; lease_token: string | null }>("select entries,identity_registry,status,lease_token from glossary_state")).rows[0]!;
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ definition, personEdited: true });
    expect(state.identity_registry).toEqual({ ...originalRegistry, added: "new-identity" });
    expect(state.status).toBe("ready");
    expect(state.lease_token).toBeNull();
  } finally { await store.pg.exec("rollback"); }
});
