import { createServer } from "vite";
import { resolve, join } from "node:path";
import type { AdminSupabase } from "../lib/supabase/admin";
const root = resolve(".");
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { "@": root, "server-only": join(root, "test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const client = getAdminSupabase() as AdminSupabase;
  console.log(JSON.stringify(await client.from("error_log").select("created_at,message").order("created_at", { ascending: false }).limit(3), null, 2));
  console.log(JSON.stringify(await client.from("ai_calls").select("created_at,purpose,subject,status,error").order("created_at", { ascending: false }).limit(8), null, 2));
  console.log(JSON.stringify(await client.from("change_sets").select("created_at,status,summary").order("created_at", { ascending: false }).limit(8), null, 2));
} finally { await runtime.close(); }
