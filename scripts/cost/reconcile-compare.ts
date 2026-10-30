import { readFile, readdir } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type { AiCallRecord } from "../../lib/ai/callLog.ts";
import type { DbRpc, RpcArgs } from "../../lib/db/rpc.ts";
import type { PassageDraft } from "../../lib/ingest/passages.ts";

// =====================================================================
// RECONCILE CLIENT COMPARISON (#45 live check): the current client
// against RECONCILE_CLIENT=split, on live models, in PostgreSQL in WASM
// (PGlite, the full migration chain). Nothing touches the live database.
//
// 1. Seed: upload saved documents with the current client into an empty
//    store, embed it, and save the data directory:
//      ... reconcile-compare.ts --seed <seed-sources.json> --snapshot <seed.tgz> --out <dir>
// 2. Arm: load that snapshot, upload the test documents in order with one
//    client, and report decisions, duplicates, composites, tokens, cost and time:
//      ... reconcile-compare.ts --snapshot <seed.tgz> --tests <test-sources.json> --client current|split --out <dir>
//
// Sources files come from scripts/cost/fetch-sources.ts; --fixture adds a
// markdown file from evals/fixtures as one more test document.
// Every role runs on Haiku 5.5 (the reconciler and reviewer in use on
// 2026-10-28). Needs ANTHROPIC_API_KEY and NEBIUS_API_KEY (embeddings).
// =====================================================================

type Source = { title: string; mimeType: string; sourceDate: string; passages: PassageDraft[] };
type Spend = Record<string, { calls: number; tokensIn: number; tokensOut: number; usd: number; ms: number; failed: number }>;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MODEL = "anthropic/claude-haiku-5-5";
const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index > 0 ? process.argv[index + 1] : fallback;
  if (value === undefined) throw new Error(`Pass --${name}.`);
  return value;
};
const has = (name: string) => process.argv.includes(`--${name}`);
const outDir = arg("out");
const snapshot = arg("snapshot");
const limitUsd = Number(arg("limit-usd", "1.5"));
if (!process.env.ANTHROPIC_API_KEY || !process.env.NEBIUS_API_KEY) throw new Error("Set ANTHROPIC_API_KEY and NEBIUS_API_KEY.");
mkdirSync(outDir, { recursive: true });

// The same RPC shim as test/db/portablePostgres.ts, over a PGlite that can start from a saved data directory
async function store(loadDataDir?: Blob) {
  const pg = new PGlite({ extensions: { vector }, ...(loadDataDir ? { loadDataDir } : {}) });
  if (!loadDataDir) {
    await pg.exec(await readFile(resolve(ROOT, "test/db/supabase-stubs.sql"), "utf8"));
    for (const file of (await readdir(resolve(ROOT, "supabase/migrations"))).filter((file) => file.endsWith(".sql")).sort()) await pg.exec(await readFile(resolve(ROOT, "supabase/migrations", file), "utf8"));
    await pg.exec(await readFile(resolve(ROOT, "supabase/seed.sql"), "utf8"));
  }
  const db: DbRpc = { async call<T>(fn: string, args: RpcArgs = {}): Promise<T> {
    if (!/^[a-z_]+$/.test(fn)) throw new Error("Invalid RPC name");
    const types = await pg.query<{ name: string; type: string }>(`select p.proargnames[i] name, format_type(p.proargtypes[i-1],null) type
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace, generate_series(1,p.pronargs) i
      where n.nspname='public' and p.proname=$1 order by i`, [fn]);
    const named = types.rows.filter((a) => Object.hasOwn(args, a.name));
    const parameters = named.map((a) => `${a.name} => a.${a.name}`).join(",");
    const from = named.length ? ` from jsonb_to_record($1) as a(${named.map((a) => `${a.name} ${a.type}`).join(",")})` : "";
    const signature = await pg.query<{ returns_set: boolean; returns_table: boolean }>(`select p.proretset returns_set, coalesce('t'=any(p.proargmodes::text[]),false) returns_table
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn]);
    if (signature.rows[0]?.returns_table) {
      const rows = await pg.query<Record<string, unknown>>(`select t.* from ${from ? `${from.slice(" from ".length)}, ` : ""}public.${fn}(${parameters}) t`, named.length ? [JSON.stringify(args)] : []);
      return rows.rows as T;
    }
    const result = await pg.query<{ result: T }>(`select public.${fn}(${parameters}) as result${from}`, named.length ? [JSON.stringify(args)] : []);
    return (signature.rows[0]?.returns_set ? result.rows.map((row) => row.result) : result.rows[0]?.result) as T;
  } };
  return { pg, db };
}

const runtime = await createServer({ configFile: false, appType: "custom", logLevel: "error", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": ROOT, "server-only": join(ROOT, "test/server-only.ts") } } });
try {
  const load = <T>(path: string) => runtime.ssrLoadModule(path) as Promise<T>;
  const { tokenFactoryFromEnv } = await load<typeof import("../../lib/ai/chat.ts")>("/lib/ai/chat.ts");
  const { estimateCost } = await load<typeof import("../../lib/ai/pricing.ts")>("/lib/ai/pricing.ts");
  const { embedderFromEnv } = await load<typeof import("../../lib/ai/embeddings.ts")>("/lib/ai/embeddings.ts");
  const { getReconciliationClient } = await load<typeof import("../../lib/ai/factory.ts")>("/lib/ai/factory.ts");
  const { passageBatches } = await load<typeof import("../../lib/ai/tokenFactory/client.ts")>("/lib/ai/tokenFactory/client.ts");
  const { duplicateGuardFor } = await load<typeof import("../../lib/ingest/duplicateGuardServer.ts")>("/lib/ingest/duplicateGuardServer.ts");
  const { reconcileUpload, recordUpload } = await load<typeof import("../../lib/ingest/pipeline.ts")>("/lib/ingest/pipeline.ts");
  const { embedMissingPassages, embedMissingUnits } = await load<typeof import("../../lib/knowledge/embeddingStore.ts")>("/lib/knowledge/embeddingStore.ts");
  const { getSectionWriter } = await load<typeof import("../../lib/living-page/index.ts")>("/lib/living-page/index.ts");
  const { CONVERTERS } = await load<typeof import("../../lib/ingest/convert.ts")>("/lib/ingest/convert.ts");
  const { splitIntoPassages } = await load<typeof import("../../lib/ingest/passages.ts")>("/lib/ingest/passages.ts");
  const { sha256 } = await load<typeof import("../../lib/ingest/hash.ts")>("/lib/ingest/hash.ts");

  let spend: Spend = {};
  const spent = () => Object.values(spend).reduce((sum, row) => sum + row.usd, 0);
  const logCall = async (call: AiCallRecord) => {
    const row = (spend[call.purpose] ??= { calls: 0, tokensIn: 0, tokensOut: 0, usd: 0, ms: 0, failed: 0 });
    row.calls++; row.ms += call.durationMs;
    if (call.status !== "ok") row.failed++;
    row.tokensIn += call.promptTokens ?? 0; row.tokensOut += call.completionTokens ?? 0;
    row.usd += estimateCost(call.model, call.promptTokens ?? 0, call.completionTokens ?? 0, call.usageDetails) ?? 0;
  };
  const choice = { model: MODEL, roleModels: {} };

  const depsFor = (db: DbRpc, client: "current" | "split") => {
    const env = { ...process.env, RECONCILE_CLIENT: client === "split" ? "split" : "" };
    const settings = tokenFactoryFromEnv(env, choice, logCall)!;
    const embedder = embedderFromEnv(env, logCall);
    return {
      db, writer: getSectionWriter({ NODE_ENV: "test" }),
      reconciler: getReconciliationClient(env, choice, undefined, logCall),
      claimEmbedder: async () => { await embedMissingUnits(db, embedder!); await embedMissingPassages(db, embedder!); },
      duplicateGuard: duplicateGuardFor(db, settings, embedder),
    };
  };

  // One upload through the real pipeline, knowledge stages only (reconcile, embeddings): no pages are written
  const upload = async (db: DbRpc, deps: ReturnType<typeof depsFor>, source: Source) => {
    const started = await recordUpload(db, { title: source.title, mimeType: source.mimeType, sourceDate: source.sourceDate, hash: sha256(new TextEncoder().encode(source.passages.map((p) => p.text).join("\n"))), storagePath: `live-check/${source.title}`, passages: source.passages });
    if (started.kind !== "started") throw new Error(`${source.title} was skipped as already stored.`);
    const before = structuredClone(spend);
    const startedAt = Date.now();
    const result = await reconcileUpload(deps, started.eventId, "knowledge");
    const ms = Date.now() - startedAt;
    const calls: Spend = {};
    for (const [purpose, row] of Object.entries(spend)) {
      const was = before[purpose] ?? { calls: 0, tokensIn: 0, tokensOut: 0, usd: 0, ms: 0, failed: 0 };
      if (row.calls > was.calls) calls[purpose] = { calls: row.calls - was.calls, tokensIn: row.tokensIn - was.tokensIn, tokensOut: row.tokensOut - was.tokensOut, usd: row.usd - was.usd, ms: row.ms - was.ms, failed: row.failed - was.failed };
    }
    return { eventId: started.eventId, sourceId: started.sourceId, ms, status: result.status, error: result.error, calls };
  };

  if (has("seed")) {
    // SEED: the store every arm starts from, built once with the current client
    const seed = JSON.parse(readFileSync(arg("seed"), "utf8")) as Source[];
    const { pg, db } = await store();
    const deps = depsFor(db, "current");
    const uploads = [];
    for (const source of seed) {
      if (spent() >= limitUsd) throw new Error(`Seed stopped at the $${limitUsd} limit.`);
      const row = await upload(db, deps, source);
      uploads.push({ title: source.title, ...row });
      console.log(`seed ${source.title}: ${row.status} ${row.error ?? ""} ${(row.ms / 1000).toFixed(1)} s  ($${spent().toFixed(3)})`);
    }
    await deps.claimEmbedder();
    const counts = (await pg.query<{ units: number; embedded: number; entities: number }>("select (select count(*)::int from units where retired_at is null) units, (select count(distinct unit_id)::int from unit_embeddings) embedded, (select count(*)::int from entities) entities")).rows[0];
    const dump = await pg.dumpDataDir("gzip");
    writeFileSync(snapshot, Buffer.from(await dump.arrayBuffer()));
    writeFileSync(join(outDir, "seed.json"), JSON.stringify({ ranOn: new Date().toISOString(), model: MODEL, counts, spentUsd: spent(), spend, uploads }, null, 1));
    console.log(JSON.stringify({ counts, spentUsd: spent() }, null, 1));
    await pg.close();
  } else {
    // ARM: the test documents in order, from the seeded store
    const client = arg("client") as "current" | "split";
    const tests = JSON.parse(readFileSync(arg("tests"), "utf8")) as Source[];
    if (has("fixture")) {
      const path = arg("fixture");
      const bytes = new Uint8Array(readFileSync(path));
      tests.push({ title: path.split("/").at(-1)!, mimeType: "text/markdown", sourceDate: "2026-10-29T00:00:00Z", passages: splitIntoPassages(await CONVERTERS.markdown(bytes)) as Source["passages"] });
    }
    const { pg, db } = await store(new Blob([readFileSync(snapshot)]));
    const deps = depsFor(db, client);
    const unitsBefore = (await pg.query<{ n: number }>("select count(*)::int n from units where retired_at is null")).rows[0]!.n;
    spend = {};
    const uploads = [];
    for (const source of tests) {
      if (spent() >= limitUsd) { console.log(`Stopped at the $${limitUsd} limit.`); break; }
      const row = await upload(db, deps, source);
      // What the upload did to the store, by action type
      const actions = (await pg.query<{ type: string; outcome: string; n: number }>(`select a.type::text, a.outcome::text, count(*)::int n from actions a join change_sets cs on cs.id = a.change_set_id
        where cs.event_id = $1 group by 1, 2 order by 1, 2`, [row.eventId])).rows;
      const prompt = Object.entries(row.calls).filter(([purpose]) => purpose.startsWith("reconciliation")).reduce((sum, [, r]) => sum + r.tokensIn, 0);
      uploads.push({ title: source.title, passages: source.passages.length, chars: source.passages.reduce((sum, p) => sum + p.text.length, 0), batches: passageBatches(source.passages.map((p, i) => ({ ...p, id: String(i) })) as never).length, ...row, reconcilePromptTokens: prompt, actions });
      console.log(`${client} ${source.title}: ${row.status} ${row.error ?? ""} ${(row.ms / 1000).toFixed(1)} s, reconcile prompt ${prompt} tokens ${JSON.stringify(actions)}  ($${spent().toFixed(3)})`);
    }
    await deps.claimEmbedder();
    // Saved before the analysis, so a failed query does not lose a paid run
    writeFileSync(join(outDir, `${client}-uploads.json`), JSON.stringify({ spentUsd: spent(), spend, uploads }, null, 1));
    // pgvector's operators live in the extensions schema
    await pg.exec("set search_path = public, extensions");
    const events = uploads.map((row) => row.eventId);
    // Claims the test uploads created, each with its closest other live claim (cosine similarity of the stored vectors)
    const created = (await pg.query<{ unit_id: string; content: string; title: string; neighbor: string | null; similarity: number | null }>(`
      with created as (
        select u.id, r.content, s.title from units u join revisions r on r.id = u.current_revision_id
        join revisions first on first.unit_id = u.id and first.replaces_revision_id is null
        left join passages p on p.id = first.passage_ids[1] left join sources s on s.id = p.source_id
        where u.retired_at is null and first.event_id = any($1::uuid[]))
      select c.id unit_id, c.content, c.title, n.content neighbor, n.similarity from created c
      left join lateral (
        select r2.content, 1 - (e2.embedding <=> e1.embedding) similarity from unit_embeddings e1
        join unit_embeddings e2 on e2.unit_id <> e1.unit_id join units u2 on u2.id = e2.unit_id and u2.retired_at is null and u2.current_revision_id = e2.revision_id
        join revisions r2 on r2.id = e2.revision_id
        where e1.unit_id = c.id order by e2.embedding <=> e1.embedding limit 1) n on true
      order by n.similarity desc nulls last`, [events])).rows;
    // Composites (procedures and lists) the test uploads wrote, and whether their steps came from more than one batch of the file
    const composites = (await pg.query<{ unit_id: string; content: string; structure: unknown; members: number; member_passages: string[] }>(`
      select u.id unit_id, r.content, r.structure, count(rel.id)::int members,
        array_remove(array_agg(distinct mp.pid::text), null) member_passages
      from units u join revisions r on r.id = u.current_revision_id
      left join relationships rel on rel.to_unit_id = u.id and rel.type = 'part_of' and rel.retired_at is null
      left join units mu on mu.id = rel.from_unit_id left join revisions mr on mr.id = mu.current_revision_id
      left join lateral unnest(mr.passage_ids) mp(pid) on true
      where u.retired_at is null and r.structure is not null and r.event_id = any($1::uuid[])
      group by 1, 2, 3`, [events])).rows;
    const batchOf = new Map<string, string>();
    for (const row of uploads) {
      const passages = (await pg.query<{ id: string; text: string }>("select id::text, text from passages where source_id = $1 order by position", [row.sourceId])).rows;
      passageBatches(passages as never).forEach((batch, index) => { for (const passage of batch as { id: string }[]) batchOf.set(passage.id, `${row.title}#${index}`); });
    }
    const unitsAfter = (await pg.query<{ n: number }>("select count(*)::int n from units where retired_at is null")).rows[0]!.n;
    const summary = {
      ranOn: new Date().toISOString(), client, model: MODEL, unitsBefore, unitsAfter, spentUsd: spent(), spend,
      wholeMs: uploads.reduce((sum, row) => sum + row.ms, 0),
      reconcilePromptTokens: uploads.reduce((sum, row) => sum + row.reconcilePromptTokens, 0),
      actions: uploads.flatMap((row) => row.actions).reduce<Record<string, number>>((all, a) => ({ ...all, [`${a.type}:${a.outcome}`]: (all[`${a.type}:${a.outcome}`] ?? 0) + a.n }), {}),
      created: created.length,
      nearDuplicates: { "0.95": created.filter((row) => (row.similarity ?? 0) >= 0.95).length, "0.9": created.filter((row) => (row.similarity ?? 0) >= 0.9).length, "0.85": created.filter((row) => (row.similarity ?? 0) >= 0.85).length },
      composites: composites.map((row) => ({ ...row, batches: [...new Set(row.member_passages.map((id) => batchOf.get(id) ?? "stored"))] })),
    };
    writeFileSync(join(outDir, `${client}.json`), JSON.stringify({ summary, uploads, created }, null, 1));
    console.log(JSON.stringify({ ...summary, composites: summary.composites.map((c) => ({ content: c.content.slice(0, 80), members: c.members, batches: c.batches })) }, null, 1));
    await pg.close();
  }
} finally {
  await runtime.close();
}
