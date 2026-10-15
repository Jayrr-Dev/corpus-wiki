import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Maintenance command for the duplicate system, in order:
//   1. embeds every live claim that has no vector yet
//   2. titles every live claim that has no title yet
//   3. runs the cleaning cycle over the whole store as the AI: merges the model is sure of
//      between near-identical claims apply (undoable); every other merge waits on Exceptions
// node --experimental-strip-types --env-file=.env.local scripts/clean-duplicates.ts [--no-titles] [--no-sweep]
const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": root, "server-only": join(root, "test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const { tokenFactoryFromEnv } = await runtime.ssrLoadModule("/lib/ai/chat.ts");
  const { readChosenModel } = await runtime.ssrLoadModule("/lib/ai/models.ts");
  const { embedderFromEnv } = await runtime.ssrLoadModule("/lib/ai/embeddings.ts");
  const { embedMissingUnits } = await runtime.ssrLoadModule("/lib/knowledge/embeddingStore.ts");
  const { titleUntitledClaims } = await runtime.ssrLoadModule("/lib/knowledge/claimTitles.ts");
  const { planDedupeClusters, dedupeCluster } = await runtime.ssrLoadModule("/lib/ingest/dedupe.ts");

  const client = getAdminSupabase();
  const db = supabaseRpc(client);
  const logCall = (call: unknown) => db.call("log_ai_call", { p_call: call });
  const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db), logCall);
  const embedder = embedderFromEnv(process.env, logCall);
  if (!settings || !embedder) throw new Error("Set NEBIUS_API_KEY in .env.local first.");

  console.log(`Embedded ${await embedMissingUnits(db, embedder)} claims.`);
  if (!process.argv.includes("--no-titles")) console.log(`Titled ${await titleUntitledClaims({ db, client, settings })} claims.`);
  if (!process.argv.includes("--no-sweep")) {
    const clusters: string[][] = await planDedupeClusters(client, undefined, { db, embedder });
    console.log(`${clusters.length} candidate group${clusters.length === 1 ? "" : "s"} to check.`);
    const totals = { proposed: 0, applied: 0, exceptions: 0, removed: 0 };
    for (const cluster of clusters) {
      const result = await dedupeCluster({ db, client, settings, embedder }, cluster);
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += result[key];
      console.log(`  ${cluster.length} claims: ${result.proposed} merge${result.proposed === 1 ? "" : "s"} proposed, ${result.removed} retired, ${result.exceptions} waiting on Exceptions`);
    }
    console.log(`Done: ${totals.removed} duplicate claims retired, ${totals.exceptions} merges waiting on Exceptions.`);
  }
} finally {
  await runtime.close();
}
