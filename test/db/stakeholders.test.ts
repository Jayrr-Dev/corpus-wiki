import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { KnowledgeContext } from "@/lib/knowledge/context";

// Entity merges, housekeeping retires and stakeholder cards, against the full migration chain
describe("stakeholder entities in PostgreSQL", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); }, 60000);
  afterAll(async () => { await store?.pg.close(); });

  async function submit(actor: "ai" | "person", type: string, input: unknown, targetId: string | null = null, expectedRevisionId: string | null = null) {
    const draft = await store.db.call<{ changeSetId: string; eventId: string }>("submit_change_set", {
      p_event_id: null, p_cause: actor === "ai" ? "upload" : "edit", p_actor: actor, p_summary: "Stakeholder test", p_trace: {},
      p_actions: [{ type, input, targetId, expectedRevisionId, passageIds: [], speechAct: "stated" }],
    });
    const result = await store.db.call<{ status: string; exceptions: number }>("commit_change_set", { p_change_set_id: draft.changeSetId });
    const action = (await store.pg.query<{ target_id: string; after_revision_id: string }>("select target_id, after_revision_id from actions where change_set_id=$1", [draft.changeSetId])).rows[0]!;
    return { ...draft, ...action, ...result };
  }
  const about = (type: string, key: string, role = "subject"): KnowledgeContext => ({
    entities: [{ type, key, role: role as "subject" }], applicability: { status: "unspecified", entities: [], conditions: null },
  });
  const addClaim = (content: string, context: KnowledgeContext) =>
    submit("person", "add_claim", { content, kind: "fact", epistemicStatus: "supported", entities: context.entities, domainPaths: [], context });
  const entityId = async (type: string, key: string) =>
    (await store.pg.query<{ id: string }>("select id from entities where type=$1 and key=$2", [type, key])).rows[0]!.id;
  const links = async (unitId: string) =>
    (await store.pg.query<{ entity_id: string; role: string }>("select entity_id, role from unit_entities where unit_id=$1 order by entity_id", [unitId])).rows;

  it("merges a duplicate into the entity that stays, resolves its key everywhere, and undoes", async () => {
    await store.pg.exec("insert into entities(type,key,name) values ('company','epcor','EPCOR'),('organization','epcor','EPCOR Utilities')");
    const into = await entityId("company", "epcor"), from = await entityId("organization", "epcor");
    const a = await addClaim("EPCOR runs the URW process", about("organization", "epcor"));
    const both = await addClaim("EPCOR signs URW documents", { ...about("company", "epcor", "object"), entities: [{ type: "company", key: "epcor", role: "object" }, { type: "organization", key: "epcor", role: "subject" }] });

    const merged = await submit("ai", "merge_entity", { intoEntityId: into, reason: "Same utility", autoMerge: true }, from);
    expect(merged.status).toBe("applied");
    expect(await links(a.target_id)).toEqual([{ entity_id: into, role: "subject" }]);
    expect(await links(both.target_id)).toEqual([{ entity_id: into, role: "subject" }]);
    expect((await store.pg.query<{ aliases: string[] }>("select aliases from entities where id=$1", [into])).rows[0]!.aliases).toContain("EPCOR Utilities");

    // The old type and key still validate, project onto the entity that stays, and match its sections
    const later = await addClaim("EPCOR approves locations", about("organization", "epcor"));
    expect(later.status).toBe("applied");
    expect(await links(later.target_id)).toEqual([{ entity_id: into, role: "subject" }]);
    const query = async (type: string) => (await store.pg.query<{ id: string }>("select public.living_page_query_units($1) id", [JSON.stringify({ entity: { type, key: "epcor" } })])).rows.map((row) => row.id);
    expect(await query("company")).toEqual(expect.arrayContaining([a.target_id, both.target_id, later.target_id]));
    expect(await query("organization")).toEqual(expect.arrayContaining([a.target_id]));

    // The later claim stays with the entity that stays; the merge's own links go back
    await store.db.call("revert_change_set", { p_change_set_id: merged.changeSetId });
    expect((await store.pg.query("select 1 from entities where id=$1 and merged_into_id is null", [from])).rows).toHaveLength(1);
    expect(await links(a.target_id)).toEqual([{ entity_id: from, role: "subject" }]);
    expect(await links(both.target_id)).toEqual([into, from].sort().map((id) => ({ entity_id: id, role: id === into ? "object" : "subject" })));
  });

  it("refuses to merge away an entity that owns a page", async () => {
    await store.pg.exec("insert into entities(type,key,name) values ('company','acme','Acme'),('organization','acme','Acme')");
    const into = await entityId("organization", "acme"), from = await entityId("company", "acme");
    await store.pg.query("insert into pages(title,slug,entity_id) values('Acme','acme',$1)", [from]);
    expect((await submit("ai", "merge_entity", { intoEntityId: into, reason: "Same", autoMerge: true }, from)).status).toBe("rejected");
  });

  it("lets the AI retire an unused entity without asking, holds a used one, and revives on reuse", async () => {
    await store.pg.exec("insert into entities(type,key,name) values ('role','land-agent','Land Agent'),('role','designer','Designer')");
    const unused = await entityId("role", "land-agent"), used = await entityId("role", "designer");
    await addClaim("The Designer pulls title", about("role", "designer"));
    const retired = await submit("ai", "retire_entity", { reason: "Nothing uses it", housekeeping: true }, unused);
    expect(retired.status).toBe("applied");
    const held = await submit("ai", "retire_entity", { reason: "Nothing uses it", housekeeping: true }, used);
    expect(held.exceptions).toBe(1);

    const created = await submit("ai", "create_entity", { type: "role", key: "land-agent", name: "Land Agent", aliases: [] });
    expect(created.status).toBe("applied");
    expect((await store.pg.query("select 1 from entities where id=$1 and retired_at is null", [unused])).rows).toHaveLength(1);
  });

  it("lists stakeholder cards with live counts and a stale flag", async () => {
    await store.pg.exec("insert into entities(type,key,name) values ('government_body','faa','FAA'),('concept','qa','Quality')");
    const faa = await entityId("government_body", "faa"), qa = await entityId("concept", "qa");
    await addClaim("The FAA fined Boeing", about("government_body", "faa"));
    await store.pg.query("insert into entity_profiles(entity_id,is_stakeholder,kind,relation,generated_at) values ($1,true,'regulator','Regulates aircraft makers',now() - interval '1 day'),($2,false,null,null,now())", [faa, qa]);
    const cards = await store.db.call<{ entityId: string; kind: string; claimCount: number; stale: boolean }[]>("stakeholder_cards");
    expect(cards.map((card) => card.entityId)).toEqual([faa]);
    expect(cards[0]).toMatchObject({ kind: "regulator", claimCount: 1, stale: true });
  });
});
