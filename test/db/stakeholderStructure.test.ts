import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { KnowledgeContext } from "@/lib/knowledge/context";
import { SENIORITIES, STRUCTURE_LINK_TYPES, type StructureLabel, type StructureRelation } from "@/lib/stakeholders/structure";

// Structure labels projected into entity_relations and read back by stakeholder_structure()
describe("stakeholder structure in PostgreSQL", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); }, 60000);
  afterAll(async () => { await store?.pg.close(); });

  type StructuredContext = KnowledgeContext & { structure?: StructureLabel[] };
  async function submit(actor: "ai" | "person", type: string, input: unknown, targetId: string | null = null) {
    const draft = await store.db.call<{ changeSetId: string }>("submit_change_set", {
      p_event_id: null, p_cause: actor === "ai" ? "upload" : "edit", p_actor: actor, p_summary: "Structure test", p_trace: {},
      p_actions: [{ type, input, targetId, expectedRevisionId: null, passageIds: [], speechAct: "stated" }],
    });
    const result = await store.db.call<{ status: string }>("commit_change_set", { p_change_set_id: draft.changeSetId });
    const action = (await store.pg.query<{ target_id: string }>("select target_id from actions where change_set_id=$1", [draft.changeSetId])).rows[0]!;
    return { ...draft, ...action, ...result };
  }
  const ref = (type: string, key: string) => ({ type, key });
  const label = (from: [string, string], link: StructureLabel["link"], to: [string, string], seat: Partial<StructureLabel> = {}): StructureLabel =>
    ({ from: ref(...from), link, to: ref(...to), title: null, seniority: null, share: null, current: true, ...seat });
  const context = (entities: [string, string][], structure?: StructureLabel[]): StructuredContext => ({
    entities: entities.map(([type, key], index) => ({ type, key, role: index === 0 ? "subject" : "object" })),
    applicability: { status: "unspecified", entities: [], conditions: null },
    ...(structure ? { structure } : {}),
  });
  const addClaim = (content: string, ctx: StructuredContext) =>
    submit("person", "add_claim", { content, kind: "fact", epistemicStatus: "supported", entities: ctx.entities, domainPaths: [], context: ctx });
  const entityId = async (type: string, key: string) =>
    (await store.pg.query<{ id: string }>("select id from entities where type=$1 and key=$2", [type, key])).rows[0]!.id;
  const structure = () => store.db.call<StructureRelation[]>("stakeholder_structure");

  it("projects a claim's labels, folds merged entities and drops retired claims", async () => {
    await store.pg.exec(`insert into entities(type,key,name) values ('person','jane','Jane Roe'),('company','acme','Acme'),
      ('company','acme-inc','Acme Inc'),('team','acme-water','Acme Water')`);
    const jane = await entityId("person", "jane"), acme = await entityId("company", "acme"), water = await entityId("team", "acme-water");
    const dup = await entityId("company", "acme-inc");

    const first = await addClaim("Jane Roe is CEO of Acme", context([["person", "jane"], ["company", "acme"]],
      [label(["person", "jane"], "leads", ["company", "acme"], { title: "CEO", seniority: "executive" })]));
    expect(first.status).toBe("applied");
    expect((await store.pg.query("select link, title, seniority from entity_relations where unit_id=$1", [first.target_id])).rows)
      .toEqual([{ link: "leads", title: "CEO", seniority: "executive" }]);

    // A later claim restates the seat; a third one names the duplicate company
    const later = await addClaim("Jane Roe, Chief Executive, leads Acme; Acme Water is part of it", context(
      [["person", "jane"], ["company", "acme"], ["team", "acme-water"]],
      [label(["person", "jane"], "leads", ["company", "acme"], { title: "Chief Executive", seniority: "executive" }),
        label(["team", "acme-water"], "part_of", ["company", "acme"])]));
    const viaDup = await addClaim("Acme Water sits inside Acme Inc", context([["team", "acme-water"], ["company", "acme-inc"]],
      [label(["team", "acme-water"], "part_of", ["company", "acme-inc"])]));
    expect([later.status, viaDup.status]).toEqual(["applied", "applied"]);
    expect((await structure()).map((r) => r.toId)).toContain(dup);

    // Merging the duplicate folds its link onto the entity that stays, at read time
    expect((await submit("ai", "merge_entity", { intoEntityId: acme, reason: "Same company", autoMerge: true }, dup)).status).toBe("applied");
    const merged = await structure();
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.link === "leads")).toEqual({
      fromId: jane, toId: acme, link: "leads", title: "Chief Executive", seniority: "executive", share: null, current: true,
      unitIds: [first.target_id, later.target_id].sort(),
    });
    expect(merged.find((r) => r.link === "part_of")).toMatchObject({ fromId: water, toId: acme, unitIds: [later.target_id, viaDup.target_id].sort() });

    // A retired claim stops counting
    await store.pg.query("update units set retired_at=now() where id=$1", [later.target_id]);
    const retired = await structure();
    expect(retired.find((r) => r.link === "leads")).toMatchObject({ title: "CEO", unitIds: [first.target_id] });
    expect(retired.find((r) => r.link === "part_of")).toMatchObject({ unitIds: [viaDup.target_id] });
  });

  it("rejects unknown links and seniorities and ends outside the claim, and accepts every contract value", async () => {
    await store.pg.exec("insert into entities(type,key,name) values ('person','sam','Sam'),('government_body','city','City'),('person','kim','Kim')");
    const pair: [string, string][] = [["person", "sam"], ["government_body", "city"]];
    const bad = async (seat: Partial<StructureLabel>, to: [string, string] = ["government_body", "city"]) =>
      (await addClaim("Sam works at the City", context(pair, [label(["person", "sam"], "works_in", to, seat)]))).status;
    expect(await bad({ link: "employs" as StructureLabel["link"] })).toBe("rejected");
    expect(await bad({ seniority: "boss" as StructureLabel["seniority"] })).toBe("rejected");
    expect(await bad({ share: 2 })).toBe("rejected");
    expect(await bad({}, ["person", "kim"])).toBe("rejected");
    expect((await addClaim("Sam works at the City", context(pair))).status).toBe("applied");

    // The SQL lists match the contract: the validator and the table checks take every value
    const every = [
      ...STRUCTURE_LINK_TYPES.map((link) => label(["person", "sam"], link, ["government_body", "city"])),
      ...SENIORITIES.map((seniority) => label(["person", "sam"], "works_in", ["government_body", "city"], { seniority, share: 0.5 })),
    ];
    await store.pg.query("select change_control.validate_knowledge_context($1)", [JSON.stringify(context(pair, every))]);
    const claim = await addClaim("Sam works at the City", context(pair));
    const [sam, city] = [await entityId("person", "sam"), await entityId("government_body", "city")];
    for (const link of STRUCTURE_LINK_TYPES) {
      await store.pg.query("insert into entity_relations(unit_id,from_entity_id,to_entity_id,link) values ($1,$2,$3,$4)", [claim.target_id, sam, city, link]);
    }
    for (const seniority of SENIORITIES) {
      await store.pg.query("update entity_relations set seniority=$2 where unit_id=$1", [claim.target_id, seniority]);
    }
  });
});
