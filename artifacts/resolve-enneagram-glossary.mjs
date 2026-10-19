import { createServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const spaceId = "21132c80-32b3-4ef2-9156-d9af60486173";
const server = await createServer({ root, configFile: false,
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
  resolve: { alias: { "@": root, "server-only": fileURLToPath(new URL("../test/server-only.ts", import.meta.url)) } },
});
try {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-space-id": spaceId }, fetch: (input, init = {}) => fetch(input, {
      ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    }) },
  });
  const { supabaseRpc } = await server.ssrLoadModule("/lib/db/rpc.ts");
  const { readModelChoice } = await server.ssrLoadModule("/lib/ai/models.ts");
  const { tokenFactoryFromEnv } = await server.ssrLoadModule("/lib/ai/chat.ts");
  const { autoDecideGlossary } = await server.ssrLoadModule("/lib/glossary/autoDecide.ts");
  const db = supabaseRpc(client);
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
  if (!settings) throw new Error("AI provider is not configured.");
  const { data: state, error } = await client.from("glossary_state").select("space_id,status,pending_entries").eq("id", true).single();
  if (error) throw error;
  if (state.space_id !== spaceId || state.status !== "ready") throw new Error("Expected the ready Enneagram glossary.");
  console.log(JSON.stringify({ space: "Enneagram", pendingBefore: state.pending_entries.length }));
  await db.call("set_glossary_auto_decide", { p_enabled: true });
  const counts = { keep: 0, merge: 0, dismiss: 0 };
  await autoDecideGlossary({ call: async (name, args) => {
    const result = await db.call(name, args);
    if (name === "apply_glossary_auto_decision") {
      if (result) counts[args.p_decision]++;
      console.log(JSON.stringify({ term: args.p_item.entry.term, decision: args.p_decision, applied: result, counts }));
    }
    return result;
  } }, settings);
  const remaining = await db.call("get_glossary_auto_decide");
  console.log(JSON.stringify({ finished: true, pendingAfter: remaining?.pending.length, counts }));
} finally {
  await server.close();
}
