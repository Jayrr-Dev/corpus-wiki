import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { portablePostgres } from "./portablePostgres";
import { EMBEDDING_DIMENSIONS, type Embedder } from "@/lib/ai/embeddings";
import { dbNeighborhoodStore } from "@/lib/ai/tokenFactory/neighborhood";
import { dbExtractionCache, SplitReconciliationClient } from "@/lib/ai/tokenFactory/splitClient";
import type { ExistingUnit, ReconciliationInput } from "@/lib/ai/types";
import { revertChangeSet } from "@/lib/change-control";
import { reconcileUpload, recordUpload, type PipelineDeps } from "@/lib/ingest/pipeline";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import { embedMissingPassages, embedMissingUnits } from "@/lib/knowledge/embeddingStore";
import { wordSet } from "@/lib/knowledge/similarity";
import { getSectionWriter } from "@/lib/living-page";

// =====================================================================
// THE SPLIT CLIENT THROUGH THE REAL UPLOAD PIPELINE AND CHANGE CONTROL
// (PostgreSQL in WASM, a scripted model, a word-hash embedder; no network).
// Checks passages are embedded before reconcile, a repeated sentence
// becomes more evidence for the stored claim, Undo restores it, a failed
// resolution resumes from the extraction checkpoint, and the cache and
// neighbor reads stay in their space.
// =====================================================================

type Body = { messages: { content: string }[]; response_format: { json_schema: { name: string } } };
const reply = (value: unknown) => new Response(JSON.stringify({
  model: "scripted", usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
}));
const acme = { type: "company", key: "acme", name: "Acme", role: "subject" } as const;

// One claim per passage; resolution answers "same" for a neighbor with the same words
function scriptedModel(failResolution = false) {
  const names: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body)) as Body;
    const name = body.response_format.json_schema.name;
    names.push(name);
    const payload = JSON.parse(body.messages.at(-1)!.content);
    if (name === "reconciliation") return reply({ summary: "Read", links: [], claims: (payload.passages as { ref: string; text: string }[]).map((passage) => ({
      action: "add", unit: null, content: passage.text, title: "Rule", kind: "fact", epistemicStatus: "supported", speechAct: "stated",
      passages: [passage.ref], entities: [acme], domainPaths: [], reason: "Rule" })) });
    if (name === "reconciliation_resolution") {
      if (failResolution) return new Response(JSON.stringify({ error: { message: "Bad request" } }), { status: 400 });
      const neighbors = payload.neighbors as { ref: string; content: string }[];
      return reply({ links: [], decisions: (payload.claims as { ref: string; content: string; neighbors: string[] }[]).map((claim) => {
        const same = claim.neighbors.find((ref) => neighbors.find((neighbor) => neighbor.ref === ref)?.content === claim.content);
        return { claim: claim.ref, decision: same ? "same" : "new", target: same ?? null, reason: "Checked." };
      }) });
    }
    return reply({ duplicateOf: null, reason: "Different." });
  }));
  return names;
}

// Words hashed into a full-size vector: the same sentence gives the same vector
const embedder: Embedder = { model: "word-hash", embed: async (texts) => texts.map((text) => {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[0] = 0.01;
  for (const word of wordSet(text)) vector[[...word].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % EMBEDDING_DIMENSIONS, 7)]! += 1;
  return vector;
}) };

describe("split reconciliation in PostgreSQL", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  let deps: PipelineDeps;
  beforeAll(async () => {
    store = await portablePostgres();
    await store.pg.exec("insert into entities(type,key,name) values ('company','acme','Acme')");
    deps = {
      db: store.db, writer: getSectionWriter({ NODE_ENV: "test" }),
      reconciler: new SplitReconciliationClient({ apiKey: "test" }, () => {
        const db = uploadExecution.getStore()?.db;
        return db ? { store: dbNeighborhoodStore(db, embedder), cache: dbExtractionCache(db) } : null;
      }),
      claimEmbedder: async () => { await embedMissingUnits(store.db, embedder); await embedMissingPassages(store.db, embedder); },
    };
  }, 60000);
  afterAll(async () => { await store?.pg.close(); });
  afterEach(() => vi.unstubAllGlobals());

  async function record(title: string, texts: string[]) {
    const started = await recordUpload(store.db, { title, mimeType: "text/markdown", sourceDate: "2026-11-24T00:00:00Z", hash: title, storagePath: `test/${title}`,
      passages: texts.map((text, position) => ({ position, text, location: {}, hash: `${title}-${position}`, speakerLabel: null })) });
    if (started.kind !== "started") throw new Error("The upload was skipped");
    return started.eventId;
  }
  const citations = async (content: string) => (await store.pg.query<{ texts: string[] }>(
    `select array(select p.text from passages p where p.id = any(r.passage_ids) order by p.text) texts
     from units u join revisions r on r.id = u.current_revision_id where r.content = $1 and u.retired_at is null`, [content])).rows;
  const RULES = ["Acme requires hard hats on site.", "Acme checks ladders every week.", "Acme keeps training records for five years."];

  it("embeds passages before reconcile and saves each claim with its citation", async () => {
    const names = scriptedModel();
    const eventId = await record("rules-v1.md", RULES);
    const result = await reconcileUpload(deps, eventId, "knowledge");
    expect(result.error).toBeNull();
    for (const rule of RULES) expect(await citations(rule)).toEqual([{ texts: [rule] }]);
    const embedded = await store.pg.query("select 1 from passage_embeddings e join passages p on p.id = e.passage_id join sources s on s.id = p.source_id where s.title = 'rules-v1.md'");
    expect(embedded.rows).toHaveLength(3);
    const order = await store.pg.query<{ key: string; state: string }>("select key, state from upload_steps where event_id = $1 and key in ('embed-passages','extraction') order by updated_at, key", [eventId]);
    expect(order.rows).toEqual([{ key: "embed-passages", state: "succeeded" }, { key: "extraction", state: "succeeded" }]);
    // An empty store: nothing to resolve against
    expect(names.filter((name) => name === "reconciliation_resolution")).toHaveLength(0);
    expect((await store.pg.query("select 1 from extraction_cache")).rows).toHaveLength(1);
  });

  it("cites a repeated sentence on the stored claim, and Undo takes the citation back", async () => {
    const names = scriptedModel();
    const eventId = await record("rules-v2.md", [RULES[1]!, "Acme bans phones on the shop floor."]);
    const result = await reconcileUpload(deps, eventId, "knowledge");
    expect(result.error).toBeNull();
    expect(names).toContain("reconciliation_resolution");
    expect(await citations(RULES[1]!)).toEqual([{ texts: [RULES[1]!, RULES[1]!] }]);
    expect(await citations("Acme bans phones on the shop floor.")).toHaveLength(1);
    await revertChangeSet(store.db, result.changeSetId!);
    expect(await citations(RULES[1]!)).toEqual([{ texts: [RULES[1]!] }]);
  });

  it("resumes a failed resolution from the extraction checkpoint", async () => {
    const eventId = await record("rules-v3.md", [RULES[2]!]);
    scriptedModel(true);
    const failed = await reconcileUpload(deps, eventId, "knowledge");
    expect(failed.error).toBeTruthy();
    const names = scriptedModel();
    const resumed = await reconcileUpload(deps, eventId, "knowledge");
    expect(resumed.error).toBeNull();
    expect(names).not.toContain("reconciliation");
    expect(await citations(RULES[2]!)).toEqual([{ texts: [RULES[2]!, RULES[2]!] }]);
  });

  it("reads neighbors in the shape reconciliation_input gives, and keeps the cache in its space", async () => {
    const eventId = await record("rules-v4.md", ["Unrelated passage."]);
    const input = await store.db.call<ReconciliationInput>("reconciliation_input", { p_event_id: eventId });
    const ids = input.existingUnits.map((unit) => unit.unitId);
    const byId = (units: ExistingUnit[]) => [...units].sort((a, b) => a.unitId.localeCompare(b.unitId));
    expect(byId(await store.db.call<ExistingUnit[]>("reconciliation_units", { p_unit_ids: ids }))).toEqual(byId(input.existingUnits));
    await store.db.call("save_extraction_cache", { p_key: "extract:test", p_answer: { value: { claims: [] } } });
    expect(await store.db.call("read_extraction_cache", { p_key: "extract:test" })).toEqual({ value: { claims: [] } });
    await store.pg.exec(`insert into auth.users(id,email) values ('41000000-0000-4000-8000-000000000001','split@example.test');
      insert into spaces(id,owner_id,name) values ('41000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001','Other')`);
    await store.pg.exec(`select set_config('request.headers','{"x-space-id":"41000000-0000-4000-8000-000000000002"}',false)`);
    try {
      expect(await store.db.call("read_extraction_cache", { p_key: "extract:test" })).toBeNull();
      expect(await store.db.call("reconciliation_units", { p_unit_ids: ids })).toEqual([]);
    } finally { await store.pg.exec("select set_config('request.headers','',false)"); }
  });
});
