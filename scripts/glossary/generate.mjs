// Backfill the generated dictionary using the same writer as the upload workflow.
import { createServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

// A stalled response used to sit for minutes without reaching Postgres.
// The timer rejects even when aborting the socket does not.
const DATABASE_CALL_TIMEOUT_MS = 90_000;
function fetchDatabase(input, init = {}) {
  const timeout = AbortSignal.timeout(DATABASE_CALL_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")), DATABASE_CALL_TIMEOUT_MS);
  });
  const request = fetch(input, { ...init, signal }).then(async (response) => {
    const body = await response.arrayBuffer();
    clearTimeout(timer);
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  });
  request.catch(() => clearTimeout(timer));
  return Promise.race([request, limit]);
}

const root = fileURLToPath(new URL("../../", import.meta.url));
const spaceFlag = process.argv.indexOf("--space");
const spaceId = spaceFlag < 0 ? null : process.argv[spaceFlag + 1];
if (spaceFlag >= 0 && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(spaceId ?? "")) throw new Error("--space requires a space UUID.");
console.log("Starting glossary runner");
const server = await createServer({
  root, configFile: false, server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
  resolve: { alias: { "@": root, "server-only": fileURLToPath(new URL("../../test/server-only.ts", import.meta.url)) } },
});
try {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: spaceId ? { "x-space-id": spaceId } : {},
      // The standalone runner must have the same bounded database calls as the
      // app; a missing HTTP response must not strand its generation lease.
      fetch: fetchDatabase,
    },
  });
  const { supabaseRpc } = await server.ssrLoadModule("/lib/db/rpc.ts");
  const { readModelChoice } = await server.ssrLoadModule("/lib/ai/models.ts");
  const { tokenFactoryFromEnv } = await server.ssrLoadModule("/lib/ai/chat.ts");
  const { generateGlossary } = await server.ssrLoadModule("/lib/glossary/generate.ts");
  const { embedMissingGlossary, similarGlossary } = await server.ssrLoadModule("/lib/glossary/embeddingStore.ts");
  const { embedderFromEnv } = await server.ssrLoadModule("/lib/ai/embeddings.ts");
  const db = supabaseRpc(client);
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), async (call) => {
    await db.call("log_ai_call", { p_call: call });
    console.log(`Dictionary ${call.purpose}: ${call.status} (${call.durationMs}ms)`);
  });
  if (!settings) throw new Error("AI provider is not configured.");
  if (!process.argv.includes("--embeddings-only")) {
  console.log("Generating dictionary from existing knowledge…");
  await generateGlossary(client, settings, process.argv.includes("--force"));
  // The glossary page can recover an expired lease first. Wait for that owner
  // rather than reporting its still-generating dictionary as a finished backfill.
  const deadline = Date.now() + 30 * 60_000;
  let reported = false;
  let readFailures = 0;
  for (;;) {
    const { data, error } = await client.from("glossary_state").select("status,error,lease_until").eq("id", true).single();
    if (error) {
      if (++readFailures >= 8 || Date.now() > deadline) throw new Error(error.message || "Could not read glossary progress.");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    readFailures = 0;
    if (data.status === "ready") break;
    if (data.status === "error") throw new Error(data.error || "Glossary generation stopped.");
    if (Date.now() > deadline) throw new Error("The glossary is still updating. Completed comparisons are saved.");
    if (!reported) { console.log("Waiting for the active glossary update…"); reported = true; }
    if (!data.lease_until || Date.parse(data.lease_until) <= Date.now()) await generateGlossary(client, settings);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  }
  const embedder = embedderFromEnv(process.env, (call) => db.call("log_ai_call", { p_call: { ...call, purpose: "glossary_embeddings", role: "dictionary_editor" } }));
  if (embedder) {
    console.log("Glossary embeddings saved:", await embedMissingGlossary(db, embedder));
    const [vector] = await embedder.embed(["checking products against specified requirements"]);
    console.log("Meaning search check:", (await similarGlossary(db, embedder.model, vector, 3)).map((match) => ({ term: match.entry.term, similarity: match.similarity })));
  }
  const { data, error } = await client.from("glossary_state").select("status, entries, completed_batches, total_batches").single();
  if (error) throw error;
  console.log(JSON.stringify({ status: data.status, entries: data.entries.length, batches: `${data.completed_batches}/${data.total_batches}`, sample: data.entries.slice(0, 6).map(({ term, definition }) => ({ term, definition })) }, null, 2));
} finally {
  await server.close();
}
