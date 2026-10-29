import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "vite";
import type { Embedder } from "../../lib/ai/embeddings.ts";
import type { Reranker } from "../../lib/ai/rerank.ts";
import type { RankDeps, RankResult, SearchMode } from "../../lib/chatbot/rank.ts";
import type { Database } from "../../lib/database/types.ts";
import type { DbRpc } from "../../lib/db/rpc.ts";
import { queryText } from "../../lib/ai/queryText.ts";

// =====================================================================
// RETRIEVAL EVAL RUNNER (C2 of "Plan: hybrid chat search" in TODO.md)
// Asks rankUnits every question in questions.json, once per variant, and
// scores where the first expected claim lands: hit@5, hit@10 and MRR,
// overall and split into scoped (entityId set) and unscoped questions.
// READ-ONLY against the live database; embeds the questions on Nebius and,
// for hybrid-rerank, sends claim text to Voyage.
//
//   node --experimental-strip-types --env-file=<path to .env.local> evals/retrieval/run.ts [--variants legacy,hybrid,hybrid-rerank] [--rerank-pace 25]
//
// Variants: legacy; hybrid with no reranker; hybrid-rerank with the Voyage
// reranker (needs VOYAGE_API_KEY). Writes results/<date>-<variant>.json.
// =====================================================================

// TYPES
type Question = { id: string; question: string; unitIds: string[]; entityId: string | null; claimTitle: string };
type Variant = "legacy" | "hybrid" | "hybrid-rerank";
type Failure = { call: string; error: string };
type Scored = {
  id: string; question: string; claimTitle: string; entityId: string | null;
  rank: number | null; armRanks: Record<string, number | null>; top10: string[];
  ms: number; rerankedBy: string | null; warning: string | null; failures: Failure[];
};
type Metrics = { questions: number; hitAt5: number; hitAt10: number; mrr: number };

// SETTINGS
const HERE = import.meta.dirname;
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const VARIANTS: Variant[] = ["legacy", "hybrid", "hybrid-rerank"];

const env = process.env;
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
const variantsArg = process.argv.indexOf("--variants");
const variants = (variantsArg > 0 ? process.argv[variantsArg + 1]!.split(",") : VARIANTS) as Variant[];
// Seconds to wait before each reranked question: Voyage's trial tier allows 3 requests a minute
const paceArg = process.argv.indexOf("--rerank-pace");
const rerankPaceMs = paceArg > 0 ? Number(process.argv[paceArg + 1]) * 1000 : 0;
for (const variant of variants) if (!VARIANTS.includes(variant)) throw new Error(`Unknown variant ${variant}; use ${VARIANTS.join(", ")}.`);

// SCORING
// 1-based position of the first expected claim, or null when the list misses them all
function firstHit(list: string[], expected: string[]): number | null {
  const index = list.findIndex(id => expected.includes(id));
  return index < 0 ? null : index + 1;
}

function metrics(scored: Scored[]): Metrics {
  const share = (test: (item: Scored) => boolean) => (scored.length ? scored.filter(test).length / scored.length : 0);
  return {
    questions: scored.length,
    hitAt5: share(item => item.rank !== null && item.rank <= 5),
    hitAt10: share(item => item.rank !== null && item.rank <= 10),
    mrr: scored.length ? scored.reduce((sum, item) => sum + (item.rank ? 1 / item.rank : 0), 0) / scored.length : 0,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : JSON.stringify(error));
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const line = (label: string, m: Metrics) => `  ${label.padEnd(9)} ${String(m.questions).padStart(3)} questions  hit@5 ${percent(m.hitAt5).padStart(6)}  hit@10 ${percent(m.hitAt10).padStart(6)}  MRR ${m.mrr.toFixed(3)}`;

// =====================================================================
// MAIN
// =====================================================================

// rankUnits lives in server code with "@/" imports and "server-only"; vite resolves both
const runtime = await createServer({ configFile: false, appType: "custom", logLevel: "error", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": ROOT, "server-only": join(ROOT, "test/server-only.ts") } } });
try {
  const { rankUnits } = (await runtime.ssrLoadModule("/lib/chatbot/rank.ts")) as { rankUnits: (question: string, deps: RankDeps) => Promise<RankResult> };
  const { supabaseRpc } = (await runtime.ssrLoadModule("/lib/db/rpc.ts")) as { supabaseRpc: (client: RankDeps["client"]) => DbRpc };
  const { embedderFromEnv } = (await runtime.ssrLoadModule("/lib/ai/embeddings.ts")) as { embedderFromEnv: (env: NodeJS.ProcessEnv) => Embedder | null };
  const { getReranker } = (await runtime.ssrLoadModule("/lib/ai/rerank.ts")) as { getReranker: (env: NodeJS.ProcessEnv) => Reranker | null };

  const client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  // rankUnits turns a failed search into a warning and a failed rerank into silence, so the
  // runner records each failure's exact text on the way through, then rethrows it unchanged
  let failures: Failure[] = [];
  const rpc = supabaseRpc(client);
  const db: DbRpc = {
    async call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
      try { return await rpc.call<T>(fn, args); }
      catch (error) { failures.push({ call: fn, error: errorText(error) }); throw error; }
    },
  };
  // No call logger: the app's logger writes to the database, and this run stays read-only
  const embedder = embedderFromEnv(env);
  if (!embedder) throw new Error("Set NEBIUS_API_KEY to embed the questions.");
  const voyage = getReranker({ ...env, CHAT_RERANKER: "voyage" });
  if (variants.includes("hybrid-rerank") && !voyage) throw new Error("Set VOYAGE_API_KEY for hybrid-rerank.");
  const reranker: Reranker | null = voyage && {
    model: voyage.model,
    async rerank(query, documents, signal) {
      try { return await voyage.rerank(query, documents, signal); }
      catch (error) { failures.push({ call: `rerank ${voyage.model}`, error: errorText(error) }); throw error; }
    },
  };

  const questions = JSON.parse(readFileSync(join(HERE, "questions.json"), "utf8")) as Question[];
  const entityIds = [...new Set(questions.flatMap(question => (question.entityId ? [question.entityId] : [])))];
  const entityRows = entityIds.length ? await client.from("entities").select("id,type,key").in("id", entityIds) : { data: [], error: null };
  if (entityRows.error) throw entityRows.error;
  const entities = new Map((entityRows.data ?? []).map(entity => [entity.id, { type: entity.type, key: entity.key }]));
  for (const id of entityIds) if (!entities.has(id)) console.warn(`Entity ${id} is no longer live; its questions run unscoped.`);

  // Embed each question once, so variants differ only in ranking
  const vectors = await embedder.embed(questions.map(question => queryText(embedder.model, "knowledge", question.question)));
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(join(HERE, "results"), { recursive: true });

  for (const variant of variants) {
    const mode: SearchMode = variant === "legacy" ? "legacy" : "hybrid";
    const scored: Scored[] = [];
    for (const [index, question] of questions.entries()) {
      const entity = question.entityId ? entities.get(question.entityId) : undefined;
      // The pause comes before the timer, so ms still measures the search alone
      if (variant === "hybrid-rerank" && rerankPaceMs && index > 0) await new Promise(resolve => setTimeout(resolve, rerankPaceMs));
      failures = [];
      const started = performance.now();
      const result = await rankUnits(question.question, { db, client, embedder, entity, vector: vectors[index] ?? null, mode, reranker: variant === "hybrid-rerank" ? reranker : null });
      scored.push({
        id: question.id,
        question: question.question,
        claimTitle: question.claimTitle,
        entityId: question.entityId,
        rank: firstHit(result.unitIds, question.unitIds),
        armRanks: Object.fromEntries(Object.entries(result.arms).map(([arm, list]) => [arm, firstHit(list, question.unitIds)])),
        top10: result.unitIds.slice(0, 10),
        ms: Math.round(performance.now() - started),
        rerankedBy: result.rerankedBy,
        warning: result.warning,
        failures,
      });
    }
    const warned = scored.filter(item => item.warning);
    const failed = scored.filter(item => item.failures.length);
    const notReranked = variant === "hybrid-rerank" ? scored.filter(item => !item.rerankedBy) : [];
    const summary = {
      overall: metrics(scored),
      scoped: metrics(scored.filter(item => item.entityId)),
      unscoped: metrics(scored.filter(item => !item.entityId)),
      medianMs: median(scored.map(item => item.ms)),
    };
    const rerankedBy = scored.find(item => item.rerankedBy)?.rerankedBy ?? null;
    const valid = warned.length === 0 && failed.length === 0 && notReranked.length === 0;
    const output = join(HERE, "results", `${date}-${variant}.json`);
    writeFileSync(output, `${JSON.stringify({ variant, mode, rerankedBy, date, embeddingModel: embedder.model, valid, warnings: warned.length, failures: failed.length, notReranked: notReranked.length, summary, questions: scored }, null, 2)}\n`);

    console.log(`\n${variant}${rerankedBy ? ` (reranked by ${rerankedBy})` : ""}, median ${summary.medianMs} ms per question`);
    console.log(line("overall", summary.overall));
    console.log(line("scoped", summary.scoped));
    console.log(line("unscoped", summary.unscoped));
    if (!valid) console.log(`  NOT VALID: ${warned.length} warned, ${failed.length} had failed calls, ${notReranked.length} not reranked`);
    for (const item of failed) for (const failure of item.failures) console.log(`  ${item.id} ${failure.call}: ${failure.error}`);
    const misses = scored.filter(item => item.rank === null || item.rank > 10);
    if (misses.length) console.log(`  Outside the top 10: ${misses.map(item => `${item.id}${item.rank ? ` (#${item.rank})` : ""}`).join(", ")}`);
    console.log(`  Wrote ${output}`);
  }
} finally {
  await runtime.close();
}
