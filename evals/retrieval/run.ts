import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "vite";
import type { Embedder } from "../../lib/ai/embeddings.ts";
import type { RankDeps, RankResult, SearchMode } from "../../lib/chatbot/rank.ts";
import type { Database } from "../../lib/database/types.ts";
import type { DbRpc } from "../../lib/db/rpc.ts";

// =====================================================================
// RETRIEVAL EVAL RUNNER (C2 of "Plan: hybrid chat search" in TODO.md)
// Asks rankUnits every question in questions.json, once per search mode,
// and scores where the first expected claim lands: hit@5, hit@10 and MRR,
// overall and split into scoped (entityId set) and unscoped questions.
// READ-ONLY against the live database; embeds the questions on Nebius.
//
//   node --experimental-strip-types --env-file=<path to .env.local> evals/retrieval/run.ts [--modes legacy,hybrid]
//
// Set CHAT_RERANKER=voyage (and VOYAGE_API_KEY) to measure hybrid with the reranker.
// Writes evals/retrieval/results/<date>-<mode>.json, one file per mode.
// =====================================================================

// TYPES
type Question = { id: string; question: string; unitIds: string[]; entityId: string | null; claimTitle: string };
type Scored = { id: string; question: string; claimTitle: string; entityId: string | null; rank: number | null; armRanks: Record<string, number | null>; top10: string[]; warning: string | null };
type Metrics = { questions: number; hitAt5: number; hitAt10: number; mrr: number };

// SETTINGS
const HERE = import.meta.dirname;
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MODES: SearchMode[] = ["legacy", "hybrid"];

const env = process.env;
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
const modesArg = process.argv.indexOf("--modes");
const modes = (modesArg > 0 ? process.argv[modesArg + 1]!.split(",") : ["legacy"]) as SearchMode[];
for (const mode of modes) if (!MODES.includes(mode)) throw new Error(`Unknown mode ${mode}; use ${MODES.join(" or ")}.`);

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

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const line = (label: string, m: Metrics) => `  ${label.padEnd(9)} ${String(m.questions).padStart(3)} questions  hit@5 ${percent(m.hitAt5).padStart(6)}  hit@10 ${percent(m.hitAt10).padStart(6)}  MRR ${m.mrr.toFixed(3)}`;

// =====================================================================
// MAIN
// =====================================================================

// rankUnits lives in server code with "@/" imports and "server-only"; vite resolves both
const runtime = await createServer({ configFile: false, appType: "custom", logLevel: "error", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": ROOT, "server-only": join(ROOT, "test/server-only.ts") } } });
try {
  const { rankUnits } = (await runtime.ssrLoadModule("/lib/chatbot/rank.ts")) as { rankUnits: (question: string, deps: RankDeps) => Promise<RankResult & { rerankedBy?: string | null }> };
  const { supabaseRpc } = (await runtime.ssrLoadModule("/lib/db/rpc.ts")) as { supabaseRpc: (client: RankDeps["client"]) => DbRpc };
  const { embedderFromEnv } = (await runtime.ssrLoadModule("/lib/ai/embeddings.ts")) as { embedderFromEnv: (env: NodeJS.ProcessEnv) => Embedder | null };

  const client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = supabaseRpc(client);
  // No call logger: the app's logger writes to the database, and this run stays read-only
  const embedder = embedderFromEnv(env);
  if (!embedder) throw new Error("Set NEBIUS_API_KEY to embed the questions.");

  const questions = JSON.parse(readFileSync(join(HERE, "questions.json"), "utf8")) as Question[];
  const entityIds = [...new Set(questions.flatMap(question => (question.entityId ? [question.entityId] : [])))];
  const entityRows = entityIds.length ? await client.from("entities").select("id,type,key").in("id", entityIds) : { data: [], error: null };
  if (entityRows.error) throw entityRows.error;
  const entities = new Map((entityRows.data ?? []).map(entity => [entity.id, { type: entity.type, key: entity.key }]));
  for (const id of entityIds) if (!entities.has(id)) console.warn(`Entity ${id} is no longer live; its questions run unscoped.`);

  // Embed each question once, so modes differ only in ranking
  const vectors = await embedder.embed(questions.map(question => question.question));
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(join(HERE, "results"), { recursive: true });

  for (const mode of modes) {
    const scored: Scored[] = [];
    let rerankedBy: string | null = null;
    for (const [index, question] of questions.entries()) {
      const entity = question.entityId ? entities.get(question.entityId) : undefined;
      const result = await rankUnits(question.question, { db, client, embedder, entity, vector: vectors[index] ?? null, mode });
      rerankedBy = rerankedBy ?? result.rerankedBy ?? null;
      scored.push({
        id: question.id,
        question: question.question,
        claimTitle: question.claimTitle,
        entityId: question.entityId,
        rank: firstHit(result.unitIds, question.unitIds),
        armRanks: Object.fromEntries(Object.entries(result.arms).map(([arm, list]) => [arm, firstHit(list, question.unitIds)])),
        top10: result.unitIds.slice(0, 10),
        warning: result.warning,
      });
    }
    const label = rerankedBy ? `${mode}-rerank` : mode;
    const warned = scored.filter(item => item.warning);
    const summary = {
      overall: metrics(scored),
      scoped: metrics(scored.filter(item => item.entityId)),
      unscoped: metrics(scored.filter(item => !item.entityId)),
    };
    const output = join(HERE, "results", `${date}-${label}.json`);
    writeFileSync(output, `${JSON.stringify({ mode, rerankedBy, date, embeddingModel: embedder.model, valid: warned.length === 0, warnings: warned.length, summary, questions: scored }, null, 2)}\n`);

    console.log(`\n${label}${rerankedBy ? ` (reranked by ${rerankedBy})` : ""}`);
    console.log(line("overall", summary.overall));
    console.log(line("scoped", summary.scoped));
    console.log(line("unscoped", summary.unscoped));
    if (warned.length) console.log(`  NOT VALID: ${warned.length} questions fell back with a warning, e.g. "${warned[0]!.warning}"`);
    const misses = scored.filter(item => item.rank === null || item.rank > 10);
    if (misses.length) console.log(`  Outside the top 10: ${misses.map(item => `${item.id}${item.rank ? ` (#${item.rank})` : ""}`).join(", ")}`);
    console.log(`  Wrote ${output}`);
  }
} finally {
  await runtime.close();
}
