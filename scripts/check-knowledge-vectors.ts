import { createServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Read-only audit by default; --repair fills missing current-revision vectors.
// Does not merge claims or change their domain assignments.
const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": root, "server-only": join(root, "test/server-only.ts") } } });
try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Missing database configuration");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const { embedderFromEnv, DEFAULT_EMBEDDING_MODEL } = await runtime.ssrLoadModule("/lib/ai/embeddings.ts");
  const { embedMissingUnits } = await runtime.ssrLoadModule("/lib/knowledge/embeddingStore.ts");
  const db = supabaseRpc(client);
  const model = process.env.AI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  console.log(`Database: ${new URL(url).hostname}; model: ${model}`);
  if (process.argv.includes("--repair")) {
    const embedder = embedderFromEnv(process.env, (call: unknown) => db.call("log_ai_call", { p_call: call }));
    if (!embedder) throw new Error("Embedding provider is not configured");
    console.log(`Saved ${await embedMissingUnits(db, embedder)} missing embeddings`);
  }
  async function readAll(table: string, columns: string) {
    const rows: Record<string, unknown>[] = [];
    for (let start = 0; ; start += 500) {
      let query = client.from(table).select(columns);
      for (const column of table === "unit_domains" ? ["unit_id", "domain_id"] : [table === "unit_embeddings" ? "revision_id" : "id"]) query = query.order(column);
      const result = await query.range(start, start + 499);
      if (result.error) throw result.error;
      rows.push(...result.data as unknown as Record<string, unknown>[]);
      if (result.data.length < 500) return rows;
    }
  }
  const [units, vectors, memberships, domains] = await Promise.all([
    readAll("units", "id,current_revision_id,retired_at,kind,epistemic_status"),
    readAll("unit_embeddings", "revision_id,unit_id,model,embedding"),
    readAll("unit_domains", "unit_id,domain_id"),
    readAll("domains", "id,path"),
  ]);
  const live = units.filter(unit => !unit.retired_at);
  const embedded = new Map(vectors.filter(row => row.model === model).map(row => [row.revision_id, row.unit_id]));
  const assigned = new Set(memberships.map(row => row.unit_id));
  const missing = live.filter(unit => embedded.get(unit.current_revision_id) !== unit.id);
  const currentRevisions = new Set(live.map(unit => unit.current_revision_id));
  const invalidVectors = vectors.filter(row => row.model === model && currentRevisions.has(row.revision_id)).filter(row => {
    const values = typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding;
    return !Array.isArray(values) || values.length !== 1024 || values.some(value => !Number.isFinite(value)) || !values.some(value => value !== 0);
  });
  const uncategorized = live.filter(unit => !assigned.has(unit.id));
  const paths = new Map(domains.map(row => [row.id, row.path]));
  const counts = new Map<string, number>();
  const liveIds = new Set(live.map(unit => unit.id));
  for (const row of memberships) if (liveIds.has(row.unit_id)) {
    const path = String(paths.get(row.domain_id) ?? "UNKNOWN DOMAIN");
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  console.log(JSON.stringify({ live: live.length, embedded: live.length - missing.length, invalidVectors: invalidVectors.map(row => row.revision_id), missing: missing.map(row => row.id), uncategorized: uncategorized.map(row => row.id), domains: Object.fromEntries([...counts].sort()) }, null, 2));
  if (missing.length || uncategorized.length || invalidVectors.length) process.exitCode = 1;
} finally {
  await runtime.close();
}
