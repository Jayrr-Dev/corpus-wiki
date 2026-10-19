import { afterAll, beforeAll, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); });
afterAll(async () => { await store.pg.close(); });

it("saves multiple same-workspace vectors, replays safely, and rejects superseded definitions", async () => {
  await store.pg.exec("begin");
  try {
    const entries = [{ meaningId: "first", term: "First", definition: "First meaning" }, { meaningId: "second", term: "Second", definition: "Second meaning" }];
    await store.pg.query("update glossary_state set entries=$1", [JSON.stringify(entries)]);
    const rows = entries.map((entry, index) => ({ hash: `embedding-${index}`, model: "fixture", entry, embedding: Array.from({ length: 1024 }, () => index ? -0.01 : 0.01) }));
    expect(await store.db.call("save_glossary_embeddings", { p_rows: rows })).toBe(2);
    expect(await store.db.call("save_glossary_embeddings", { p_rows: rows })).toBe(2);
    expect((await store.pg.query<{ count: number }>("select count(*)::int count from glossary_embeddings where model='fixture'")).rows[0]?.count).toBe(2);
    expect(await store.db.call("save_glossary_embeddings", { p_rows: [{ ...rows[0], hash: "obsolete", entry: { ...entries[0], definition: "Superseded" } }] })).toBe(0);
    expect((await store.pg.query<{ present: boolean }>("select to_regclass('public.glossary_embeddings_pkey') is not null present")).rows[0]?.present).toBe(true);
    expect((await store.pg.query<{ absent: boolean }>("select to_regclass('public.glossary_embeddings_space_idx') is null absent")).rows[0]?.absent).toBe(true);
  } finally { await store.pg.exec("rollback"); }
});
