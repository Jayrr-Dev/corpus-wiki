import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("keeps claim vectors out of the page-tree snapshot and returns at most 32", async () => {
  const store = await portablePostgres();
  try {
    const snapshot = await store.db.call<{ vectors: unknown[] }>("curator_snapshot");
    expect(snapshot.vectors).toEqual([]);
    const unit = (await store.pg.query<{ id: string; revision: string }>("select id, current_revision_id as revision from units where retired_at is null limit 1")).rows[0];
    expect(unit).toBeTruthy();
    const vector = JSON.stringify([1, ...Array(1023).fill(0)]);
    await store.pg.query("insert into unit_embeddings(revision_id, unit_id, model, embedding) values ($1,$2,'test',$3::extensions.vector)", [unit!.revision, unit!.id, vector]);
    const found = await store.db.call<{ id: string }[]>("curator_claim_vectors", { p_unit_ids: [unit!.id] });
    expect(found.map((row) => row.id)).toEqual([unit!.id]);
    const ids = Array.from({ length: 32 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    ids.push(unit!.id);
    expect(await store.db.call<unknown[]>("curator_claim_vectors", { p_unit_ids: ids })).toEqual([]);
  } finally { await store.pg.close(); }
}, 60000);
