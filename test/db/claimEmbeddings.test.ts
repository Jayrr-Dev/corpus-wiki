import { afterAll, beforeAll, expect, it } from "vitest";
import type { KnowledgeContext } from "@/lib/knowledge/context";
import { portablePostgres } from "./portablePostgres";

// Contextual claim embeddings (#39): what needs a vector, with the names its prefix uses,
// and how a renamed entity sends its claims back for a new one
let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); }, 60000);
afterAll(async () => { await store?.pg.close(); });

type Stale = { unit_id: string; revision_id: string; content: string; subjects: string[]; scope: string[]; conditions: string | null };
const stale = (version: number) => store.db.call<Stale[]>("stale_unit_embeddings", { p_model: "fixture", p_version: version, p_limit: 50 });
const vector = Array.from({ length: 1024 }, () => 0.01);

async function addClaim(content: string, context: KnowledgeContext) {
  const draft = await store.db.call<{ changeSetId: string }>("submit_change_set", { p_event_id: null, p_cause: "edit", p_actor: "person", p_summary: "Embedding test",
    p_trace: {}, p_actions: [{ type: "add_claim", input: { content, kind: "fact", epistemicStatus: "supported", entities: context.entities, domainPaths: [], context }, targetId: null, expectedRevisionId: null, passageIds: [], speechAct: "stated" }] });
  expect((await store.db.call<{ status: string }>("commit_change_set", { p_change_set_id: draft.changeSetId })).status).toBe("applied");
  return (await store.pg.query<{ target_id: string; after_revision_id: string }>("select target_id, after_revision_id from actions where change_set_id=$1", [draft.changeSetId])).rows[0]!;
}

it("lists stale claims with their prefix names, keeps one vector per revision, and re-embeds on rename", async () => {
  await store.pg.exec("begin");
  try {
    await store.pg.exec("insert into entities(type,key,name) values ('company','acme','Acme'),('company','plant-2','Plant 2'),('company','idle','Idle')");
    const scoped = await addClaim("Training is required annually", {
      entities: [{ type: "company", key: "acme", role: "subject" }],
      applicability: { status: "scoped", entities: [{ type: "company", key: "plant-2" }], conditions: "new staff" },
    });
    const general = await addClaim("Water boils at 100 degrees", { entities: [], applicability: { status: "general", entities: [], conditions: null } });

    // Both need a vector; the prefix parts come from the revision's context and the entities' names
    const byUnit = new Map((await stale(2)).map((row) => [row.unit_id, row]));
    expect(byUnit.get(scoped.target_id)).toMatchObject({ revision_id: scoped.after_revision_id, subjects: ["Acme"], scope: ["Plant 2"], conditions: "new staff" });
    expect(byUnit.get(general.target_id)).toMatchObject({ subjects: [], scope: [], conditions: null });

    // A bare-text vector (saved without a version, as before #39) is version 1: still stale for 2,
    // and listed after claims that have no vector at all
    await store.db.call("save_unit_embeddings", { p_rows: [{ revisionId: scoped.after_revision_id, unitId: scoped.target_id, model: "fixture", embedding: vector }] });
    expect((await store.pg.query("select text_version from unit_embeddings where revision_id=$1", [scoped.after_revision_id])).rows).toEqual([{ text_version: 1 }]);
    expect((await stale(1)).map((row) => row.unit_id)).not.toContain(scoped.target_id);
    const order = (await stale(2)).map((row) => row.unit_id);
    expect(order.indexOf(general.target_id)).toBeLessThan(order.indexOf(scoped.target_id));

    // Version 2 replaces it in place: one row per revision
    const rows = [scoped, general].map((claim) => ({ revisionId: claim.after_revision_id, unitId: claim.target_id, model: "fixture", embedding: vector, textVersion: 2 }));
    expect(await store.db.call("save_unit_embeddings", { p_rows: rows })).toBe(2);
    expect((await store.pg.query("select text_version from unit_embeddings where revision_id=$1", [scoped.after_revision_id])).rows).toEqual([{ text_version: 2 }]);
    const fresh = (await stale(2)).map((row) => row.unit_id);
    expect(fresh).not.toContain(scoped.target_id);
    expect(fresh).not.toContain(general.target_id);

    // Renaming a subject or scope entity marks the vector (still readable) and the new name is listed
    await store.pg.exec("update entities set name='Acme Inc.' where key='acme'");
    expect((await store.pg.query("select text_version from unit_embeddings where revision_id=$1", [scoped.after_revision_id])).rows).toEqual([{ text_version: 0 }]);
    expect((await stale(2)).find((row) => row.unit_id === scoped.target_id)).toMatchObject({ subjects: ["Acme Inc."], scope: ["Plant 2"] });
    expect((await stale(2)).map((row) => row.unit_id)).not.toContain(general.target_id);
    await store.db.call("save_unit_embeddings", { p_rows: [rows[0]] });
    await store.pg.exec("update entities set name='Plant Two' where key='plant-2'");
    expect((await stale(2)).find((row) => row.unit_id === scoped.target_id)).toMatchObject({ scope: ["Plant Two"] });

    // An entity no live claim names leaves every vector alone; so does saving the same name
    await store.db.call("save_unit_embeddings", { p_rows: [rows[0]] });
    await store.pg.exec("update entities set name='Idle Co' where key='idle'; update entities set name='Acme Inc.' where key='acme'");
    expect((await store.pg.query<{ v: number }>("select min(text_version) v from unit_embeddings where model='fixture'")).rows[0]!.v).toBe(2);
  } finally { await store.pg.exec("rollback"); }
});
