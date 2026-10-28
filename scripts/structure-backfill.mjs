// STRUCTURE BACKFILL: links for claims saved before structure labels (lib/knowledge/structureBackfill.ts).
// Needs migration 20261119029000. Run: node --env-file-if-exists=.env.local scripts/structure-backfill.mjs
import { createServer } from "vite";
import { resolve } from "node:path";

const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { "@": resolve("."), "server-only": resolve("test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const { readModelChoice } = await runtime.ssrLoadModule("/lib/ai/models.ts");
  const { tokenFactoryFromEnv } = await runtime.ssrLoadModule("/lib/ai/chat.ts");
  const { backfillStructure } = await runtime.ssrLoadModule("/lib/knowledge/structureBackfill.ts");
  const client = getAdminSupabase();
  const db = supabaseRpc(client);
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
  if (!settings) throw new Error("Needs the AI key in .env.local.");
  const result = await backfillStructure(client, settings, (line) => console.log(line));
  console.log(`Read ${result.claims} claims; wrote ${result.links} links on ${result.labelled} of them; ${result.failed} failed the checks.`);
} finally {
  await runtime.close();
}
