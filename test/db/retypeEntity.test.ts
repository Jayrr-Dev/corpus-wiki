import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { KnowledgeContext } from "@/lib/knowledge/context";

// The retype_entity action, against the full migration chain
describe("retyping an entity in PostgreSQL", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); }, 60000);
  afterAll(async () => { await store?.pg.close(); });

  async function submit(actor: "ai" | "person", type: string, input: unknown, targetId: string | null = null) {
    const draft = await store.db.call<{ changeSetId: string; eventId: string }>("submit_change_set", {
      p_event_id: null, p_cause: actor === "ai" ? "upload" : "edit", p_actor: actor, p_summary: "Retype test", p_trace: {},
      p_actions: [{ type, input, targetId, expectedRevisionId: null, passageIds: [], speechAct: "stated" }],
    });
    const result = await store.db.call<{ status: string; exceptions: number }>("commit_change_set", { p_change_set_id: draft.changeSetId });
    const action = (await store.pg.query<{ target_id: string }>("select target_id from actions where change_set_id=$1", [draft.changeSetId])).rows[0]!;
    return { ...draft, ...action, ...result };
  }
  const about = (type: string, key: string): KnowledgeContext => ({
    entities: [{ type, key, role: "subject" }], applicability: { status: "unspecified", entities: [], conditions: null },
  });
  const addClaim = (content: string, context: KnowledgeContext) =>
    submit("person", "add_claim", { content, kind: "fact", epistemicStatus: "supported", entities: context.entities, domainPaths: [], context });
  const entity = async (id: string) =>
    (await store.pg.query<{ type: string; key: string; merged_into_id: string | null }>("select type, key, merged_into_id from entities where id=$1", [id])).rows[0];
  const resolve = async (type: string, key: string) =>
    (await store.pg.query<{ id: string | null }>("select public.entity_id_for($1, $2) id", [type, key])).rows[0]!.id;

  it("moves an entity to a new type, keeps old references resolving, and undoes", async () => {
    await store.pg.exec("insert into entities(type,key,name) values ('concept','inspection-report-template','Inspection Report Template')");
    const id = await resolve("concept", "inspection-report-template");
    const claim = await addClaim("Inspectors fill in the inspection report template", about("concept", "inspection-report-template"));

    const retyped = await submit("ai", "retype_entity", { type: "document", fromType: "concept", reason: "It is a template" }, id);
    expect(retyped.status).toBe("applied");
    expect(await entity(id!)).toMatchObject({ type: "document", key: "inspection-report-template", merged_into_id: null });
    // The claim's stored context still names (concept, key): it resolves to the same entity
    expect(await resolve("concept", "inspection-report-template")).toBe(id);
    expect(await resolve("document", "inspection-report-template")).toBe(id);
    const links = await store.pg.query<{ entity_id: string }>("select entity_id from unit_entities where unit_id=$1", [claim.target_id]);
    expect(links.rows).toEqual([{ entity_id: id }]);
    // A new claim may name it by its new type
    expect((await addClaim("The template has five sections", about("document", "inspection-report-template"))).status).toBe("applied");

    await store.db.call("revert_change_set", { p_change_set_id: retyped.changeSetId });
    expect(await entity(id!)).toMatchObject({ type: "concept", merged_into_id: null });
    expect((await store.pg.query("select 1 from entities where type='document' and key='inspection-report-template'")).rows).toHaveLength(0);
  });

  it("takes the slot of a merged row with the same key, and gives it back on undo", async () => {
    await store.pg.exec("insert into entities(type,key,name) values ('concept','first-party-inspectors','First-Party Inspectors')");
    const id = await resolve("concept", "first-party-inspectors");
    await store.pg.query("insert into entities(type,key,name,merged_into_id) values ('role','first-party-inspectors','First-party inspector',$1)", [id]);
    const old = (await store.pg.query<{ id: string }>("select id from entities where type='role' and key='first-party-inspectors'")).rows[0]!.id;

    const retyped = await submit("ai", "retype_entity", { type: "role", fromType: "concept", reason: "A job people hold" }, id);
    expect(retyped.status).toBe("applied");
    expect(await entity(id!)).toMatchObject({ type: "role", key: "first-party-inspectors" });
    expect((await entity(old))!.key).toMatch(/^first-party-inspectors--old-/);

    await store.db.call("revert_change_set", { p_change_set_id: retyped.changeSetId });
    expect(await entity(old)).toMatchObject({ type: "role", key: "first-party-inspectors" });
    expect(await entity(id!)).toMatchObject({ type: "concept" });
  });

  it("rejects a retype onto a live entity's slot, an unknown type, or a stale fromType", async () => {
    await store.pg.exec("insert into entities(type,key,name) values ('concept','iso-9001','ISO 9001'),('standard','iso-9001','ISO 9001')");
    const id = await resolve("concept", "iso-9001");
    const raw = (await store.pg.query<{ id: string }>("select id from entities where type='concept' and key='iso-9001'")).rows[0]!.id;
    expect(id).toBe(raw);
    expect((await submit("ai", "retype_entity", { type: "standard", fromType: "concept", reason: "x" }, raw)).status).toBe("rejected");
    expect((await submit("ai", "retype_entity", { type: "widget", fromType: "concept", reason: "x" }, raw)).status).toBe("rejected");
    expect((await submit("ai", "retype_entity", { type: "document", fromType: "policy", reason: "x" }, raw)).status).toBe("rejected");
  });
});
