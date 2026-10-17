import { createServer } from "vite";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { "@": resolve("."), "server-only": resolve("test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const client = getAdminSupabase();
  const db = supabaseRpc(client);
  const { data: actions, error } = await client.from("actions").select("change_set_id").eq("target_id", "7c9a1336-4f9e-4a6d-849c-6b2b0dcf80f5").eq("type", "create_section");
  if (error) throw error;
  assert.equal(actions.length, 1);
  const id = actions[0].change_set_id;
  const { data: change, error: changeError } = await client.from("change_sets").select("*").eq("id", id).single();
  if (changeError) throw changeError;
  console.log(JSON.stringify({ id, summary: change.summary, status: change.status }));
  assert(change.summary.includes("Utilitek"));
  if (process.argv.includes("--restore")) {
    const { revertChangeSet } = await runtime.ssrLoadModule("/lib/change-control/index.ts");
    console.log(await revertChangeSet(db, id));
    const refs = await db.call("list_page_sections", { p_page_id: "73963b81-1961-4b0d-8865-aea76fbcb3a3" });
    console.log(JSON.stringify(refs));
  }
} finally { await runtime.close(); }
