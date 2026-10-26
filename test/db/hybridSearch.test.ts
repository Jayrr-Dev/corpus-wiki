import { afterAll, beforeAll, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import { recordUpload } from "@/lib/ingest/pipeline";
import { submitChangeSet, commitChangeSet } from "@/lib/change-control";
import type { ReconciliationInput } from "@/lib/ai/types";

let fixture: Awaited<ReturnType<typeof portablePostgres>>;
const owner = "31000000-0000-4000-8000-000000000001";
const spaces = ["31000000-0000-4000-8000-000000000002", "31000000-0000-4000-8000-000000000003"];
const ids: Record<string, string> = {};
type TextMatch = { unit_id: string; revision_id: string; rank: number };
type LinkMatch = { unit_id: string; via_unit_id: string; type: string };

const claims = [
  "Solar panels power the house and solar panels save money",
  "The roof has panels, and the garden gets some solar heat",
  "Wind turbines spin on the hill",
  "Retired solar panels claim",
  "Obsolete solar panels wording",
  "Seed A", "Seed B", "Out of A", "Into A", "Out of B", "Shared", "Behind a retired link", "Retired neighbour",
];

async function request<T>(space: string, run: () => Promise<T>): Promise<T> {
  await fixture.pg.exec("begin");
  try {
    await fixture.pg.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.headers',$1,true)", [JSON.stringify({ "x-person-id": owner, "x-space-id": space })]);
    await fixture.pg.exec("set local role service_role; select public.scope_space_request()");
    const result = await run();
    await fixture.pg.exec("commit");
    return result;
  } catch (error) { await fixture.pg.exec("rollback"); throw error; }
}

beforeAll(async () => {
  fixture = await portablePostgres();
  await fixture.pg.query("insert into auth.users(id,email) values($1,'hybrid@example.test')", [owner]);
  for (const [index, space] of spaces.entries()) {
    await fixture.pg.query("insert into spaces(id,owner_id,name) values($1,$2,$3)", [space, owner, `Hybrid ${index}`]);
    await request(space!, async () => {
      const upload = await recordUpload(fixture.db, { title: "Hybrid fixture", mimeType: "text/plain", sourceDate: "2026-10-26T00:00:00Z", hash: "hybrid-fixture", storagePath: "test.txt",
        passages: [{ position: 0, text: "Hybrid fixture evidence", hash: "hybrid-passage", speakerLabel: null, location: {} }] });
      if (upload.kind !== "started") throw new Error("Expected upload");
      const input = await fixture.db.call<ReconciliationInput>("reconciliation_input", { p_event_id: upload.eventId });
      const labels = index === 0 ? claims : ["Solar panels in another space"];
      const { changeSetId } = await submitChangeSet(fixture.db, { eventId: upload.eventId, cause: "upload", actor: "ai" }, {
        summary: "Hybrid fixture", trace: { modelVersion: "test", promptVersion: "test", tokensIn: 0, tokensOut: 0 },
        actions: labels.map(content => ({ type: "add_claim", targetId: null, expectedRevisionId: null, passageIds: [input.passages[0]!.id], speechAct: "stated",
          input: { content, kind: "fact", epistemicStatus: "supported", validFrom: "2026-10-26T00:00:00Z", entities: [], domainPaths: [] } })),
      });
      expect((await commitChangeSet(fixture.db, changeSetId)).status).toBe("applied");
      if (index !== 0) return;
      const { rows } = await fixture.pg.query<{ id: string; content: string }>("select u.id,r.content from units u join revisions r on r.id=u.current_revision_id");
      for (const row of rows) ids[row.content] = row.id;
      await fixture.pg.query("update revisions set title='Solar farm planning' where id=(select current_revision_id from units where id=$1)", [ids["Wind turbines spin on the hill"]]);
      await fixture.pg.query("update units set retired_at=now() where id=any($1)", [[ids["Retired solar panels claim"], ids["Retired neighbour"]]]);
      const replacement = await fixture.pg.query<{ id: string }>("insert into revisions(unit_id,content,source_date,event_id,author) values($1,'Hydro dams store water',now(),$2,'ai') returning id", [ids["Obsolete solar panels wording"], upload.eventId]);
      await fixture.pg.query("update units set current_revision_id=$1 where id=$2", [replacement.rows[0]!.id, ids["Obsolete solar panels wording"]]);
      const link = (from: string, to: string, type: string, retired = false) => fixture.pg.query(
        `insert into relationships(from_unit_id,to_unit_id,type,event_id,retired_at) values($1,$2,$3,$4,${retired ? "now()" : "null"})`, [ids[from], ids[to], type, upload.eventId]);
      await link("Seed A", "Out of A", "supports");
      await link("Into A", "Seed A", "depends_on");
      await link("Seed B", "Out of B", "related_to");
      await link("Seed A", "Shared", "supports");
      await link("Seed B", "Shared", "contradicts");
      await link("Seed A", "Seed B", "related_to");
      await link("Seed A", "Behind a retired link", "supports", true);
      await link("Seed A", "Retired neighbour", "supports");
    });
  }
});
afterAll(async () => { await fixture?.pg.close(); });

const name = (id: string) => Object.keys(ids).find(key => ids[key] === id) ?? id;

it("ranks live current wording, title included, best first and within the space", async () => {
  const search = async (query: string, limit = 40) => (await fixture.pg.query<TextMatch>("select * from public.search_units_text($1,$2)", [query, limit])).rows;
  await request(spaces[0]!, async () => {
    const solar = await search("solar panels");
    expect(solar.map(row => name(row.unit_id))).toEqual([
      "Solar panels power the house and solar panels save money",
      "The roof has panels, and the garden gets some solar heat",
      "Wind turbines spin on the hill",
    ]);
    expect(solar[0]!.rank).toBeGreaterThan(solar[1]!.rank);
    expect(solar[1]!.rank).toBeGreaterThan(solar[2]!.rank);
    const current = await fixture.pg.query<{ current_revision_id: string }>("select current_revision_id from units where id=$1", [solar[0]!.unit_id]);
    expect(solar[0]!.revision_id).toBe(current.rows[0]!.current_revision_id);
    expect((await search("solar panels", 1)).map(row => name(row.unit_id))).toEqual(["Solar panels power the house and solar panels save money"]);
    const farm = await search("solar farm");
    expect(farm.map(row => name(row.unit_id))[0]).toBe("Wind turbines spin on the hill");
    expect(farm).toHaveLength(3);
    expect((await search("hydro")).map(row => name(row.unit_id))).toEqual(["Obsolete solar panels wording"]);
    expect((await search("Who must wear gloves near the turbines?")).map(row => name(row.unit_id))).toEqual(["Wind turbines spin on the hill"]);
    const words = await search("Does the house save money with panels?");
    expect(words.map(row => name(row.unit_id))).toEqual([
      "Solar panels power the house and solar panels save money",
      "The roof has panels, and the garden gets some solar heat",
    ]);
    expect(words[0]!.rank).toBeGreaterThan(words[1]!.rank);
    expect((await search("it's \"PPE\" & gloves? (garden) | !heat: <-> 'roof'")).map(row => name(row.unit_id))).toEqual(["The roof has panels, and the garden gets some solar heat"]);
    expect(await search("obsolete")).toEqual([]);
    expect((await search("retired solar panels claim")).map(row => name(row.unit_id))).not.toContain("Retired solar panels claim");
    expect(await search("")).toEqual([]);
    expect(await search("the and of")).toEqual([]);
    expect((await fixture.pg.query("select * from public.search_units_text(null)")).rows).toEqual([]);
  });
  await request(spaces[1]!, async () => {
    expect((await search("solar panels")).length).toBe(1);
  });
});

it("follows live links one hop either way, skipping seeds, ordered by seed", async () => {
  const linked = async (seeds: string[], limit = 20) => (await fixture.pg.query<LinkMatch>("select * from public.linked_units($1,$2)", [seeds.map(seed => ids[seed]), limit])).rows
    .map(row => ({ unit: name(row.unit_id), via: name(row.via_unit_id), type: row.type }));
  await request(spaces[0]!, async () => {
    const ab = await linked(["Seed A", "Seed B"]);
    expect(ab.slice(0, 3).sort((a, b) => a.unit.localeCompare(b.unit))).toEqual([
      { unit: "Into A", via: "Seed A", type: "depends_on" },
      { unit: "Out of A", via: "Seed A", type: "supports" },
      { unit: "Shared", via: "Seed A", type: "supports" },
    ]);
    expect(ab.slice(3)).toEqual([{ unit: "Out of B", via: "Seed B", type: "related_to" }]);
    const ba = await linked(["Seed B", "Seed A"]);
    expect(ba.slice(0, 2).sort((a, b) => a.unit.localeCompare(b.unit))).toEqual([
      { unit: "Out of B", via: "Seed B", type: "related_to" },
      { unit: "Shared", via: "Seed B", type: "contradicts" },
    ]);
    expect(ba.slice(2).map(row => row.unit).sort()).toEqual(["Into A", "Out of A"]);
    expect((await linked(["Seed A"])).map(row => row.unit).sort()).toEqual(["Into A", "Out of A", "Seed B", "Shared"]);
    expect(await linked(["Seed A", "Seed B"], 1)).toHaveLength(1);
    expect(await linked([])).toEqual([]);
  });
  await request(spaces[1]!, async () => {
    expect(await linked(["Seed A", "Seed B"])).toEqual([]);
  });
});
