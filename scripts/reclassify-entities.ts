import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Moves the entities filed as "concept" onto the entity type that fits (lib/knowledge/entityReclassify.ts).
// The retypes are one AI ChangeSet, each undoable from Changes. --dry-run lists them without saving.
// node --experimental-strip-types --env-file=.env.local scripts/reclassify-entities.ts [--dry-run]
const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": root, "server-only": join(root, "test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const { tokenFactoryFromEnv } = await runtime.ssrLoadModule("/lib/ai/chat.ts");
  const { readModelChoice } = await runtime.ssrLoadModule("/lib/ai/models.ts");
  const { reclassifyConcepts } = await runtime.ssrLoadModule("/lib/knowledge/entityReclassify.ts");

  const client = getAdminSupabase();
  const db = supabaseRpc(client);
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call: unknown) => db.call("log_ai_call", { p_call: call }));
  if (!settings) throw new Error("Configure an AI provider in .env.local first.");

  const dryRun = process.argv.includes("--dry-run");
  const result = await reclassifyConcepts({ db, client, settings }, { dryRun });
  for (const retype of result.retypes) console.log(`  ${retype.name}: ${retype.from} -> ${retype.to} (${retype.reason})`);
  console.log(dryRun
    ? `Checked ${result.checked} concepts: ${result.retypes.length} would change.`
    : `Checked ${result.checked} concepts: ${result.applied} retyped, ${result.rejected} rejected.`);
} finally {
  await runtime.close();
}
