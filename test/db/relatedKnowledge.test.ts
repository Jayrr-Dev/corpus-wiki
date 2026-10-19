import { afterAll, beforeAll, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import { recordUpload } from "@/lib/ingest/pipeline";
import { submitChangeSet, commitChangeSet } from "@/lib/change-control";
import type { ReconciliationInput } from "@/lib/ai/types";

let fixture: Awaited<ReturnType<typeof portablePostgres>>;
const owner = "30000000-0000-4000-8000-000000000001";
const spaces = ["30000000-0000-4000-8000-000000000002", "30000000-0000-4000-8000-000000000003"];
const vector = (similarity: number) => JSON.stringify([similarity, Math.sqrt(1 - similarity ** 2), ...Array(1022).fill(0)]);
type Match = { unit_id: string; revision_id: string; content: string; similarity: number };

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
  await fixture.pg.query("insert into auth.users(id,email) values($1,'related@example.test')", [owner]);
  for (const [index, space] of spaces.entries()) {
    await fixture.pg.query("insert into spaces(id,owner_id,name) values($1,$2,$3)", [space, owner, `Related ${index}`]);
    await request(space!, async () => {
      const upload = await recordUpload(fixture.db, { title: "Search fixture", mimeType: "text/plain", sourceDate: "2026-10-18T00:00:00Z", hash: "related-fixture", storagePath: "test.txt",
        passages: [{ position: 0, text: "Search fixture evidence", hash: "related-passage", speakerLabel: null, location: {} }] });
      if (upload.kind !== "started") throw new Error("Expected upload");
      const input = await fixture.db.call<ReconciliationInput>("reconciliation_input", { p_event_id: upload.eventId });
      const labels = index === 0 ? ["Best", "Second", "Below threshold", "Retired", "Obsolete", "Other model"] : ["Other space"];
      const { changeSetId } = await submitChangeSet(fixture.db, { eventId: upload.eventId, cause: "upload", actor: "ai" }, {
        summary: "Search fixture", trace: { modelVersion: "test", promptVersion: "test", tokensIn: 0, tokensOut: 0 },
        actions: labels.map(content => ({ type: "add_claim", targetId: null, expectedRevisionId: null, passageIds: [input.passages[0]!.id], speechAct: "stated",
          input: { content, kind: "fact", epistemicStatus: "supported", validFrom: "2026-10-18T00:00:00Z", entities: [], domainPaths: [] } })),
      });
      expect((await commitChangeSet(fixture.db, changeSetId)).status).toBe("applied");
      const { rows } = await fixture.pg.query<{ id: string; current_revision_id: string; content: string }>("select u.id,u.current_revision_id,r.content from units u join revisions r on r.id=u.current_revision_id");
      for (const row of rows) {
        const score = row.content === "Best" ? 0.95 : row.content === "Second" ? 0.85 : row.content === "Below threshold" ? 0.5 : 1;
        await fixture.pg.query("insert into unit_embeddings(unit_id,revision_id,model,embedding) values($1,$2,$3,$4::extensions.vector)", [row.id, row.current_revision_id, row.content === "Other model" ? "other-model" : "test-model", vector(score)]);
        if (row.content === "Retired") await fixture.pg.query("update units set retired_at=now() where id=$1", [row.id]);
        if (row.content === "Obsolete") {
          const replacement = await fixture.pg.query<{ id: string }>("insert into revisions(unit_id,content,source_date,event_id,author) values($1,'Replacement without a vector',now(),$2,'ai') returning id", [row.id, upload.eventId]);
          await fixture.pg.query("update units set current_revision_id=$1 where id=$2", [replacement.rows[0]!.id, row.id]);
        }
      }
    });
  }
});
afterAll(async () => { await fixture?.pg.close(); });

it("ranks only current live vectors of the selected model and space before limiting content reads", async () => {
  const read = async (limit = 16, minimum = 0.8) => (await fixture.pg.query<Match>("select * from public.similar_units($1,'test-model',$2,$3)", [vector(1), limit, minimum])).rows;
  await request(spaces[0]!, async () => {
    const result = await read();
    expect(result.map(row => row.content)).toEqual(["Best", "Second"]);
    expect(result[0]!.similarity).toBeCloseTo(0.95);
    expect((await read(1)).map(row => row.content)).toEqual(["Best"]);
    expect(await read(16, 0.96)).toEqual([]);
    expect(await read(0)).toEqual([]);
  });
  await request(spaces[1]!, async () => {
    expect((await read()).map(row => row.content)).toEqual(["Other space"]);
  });
});
