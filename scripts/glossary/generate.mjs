// Backfill the generated dictionary using the same writer as the upload workflow.
import { createServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const server = await createServer({
  root, configFile: false, server: { middlewareMode: true },
  resolve: { alias: { "@": root, "server-only": fileURLToPath(new URL("../../test/server-only.ts", import.meta.url)) } },
});
try {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { supabaseRpc } = await server.ssrLoadModule("/lib/db/rpc.ts");
  const { readChosenModel } = await server.ssrLoadModule("/lib/ai/models.ts");
  const { tokenFactoryFromEnv } = await server.ssrLoadModule("/lib/ai/chat.ts");
  const { generateGlossary } = await server.ssrLoadModule("/lib/glossary/generate.ts");
  const { embedMissingGlossary, similarGlossary } = await server.ssrLoadModule("/lib/glossary/embeddingStore.ts");
  const { embedderFromEnv } = await server.ssrLoadModule("/lib/ai/embeddings.ts");
  const db = supabaseRpc(client);
  const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db), async (call) => {
    await db.call("log_ai_call", { p_call: call });
    console.log(`Dictionary AI: ${call.status} (${call.durationMs}ms)`);
  });
  if (!settings) throw new Error("AI provider is not configured.");
  console.log("Generating dictionary from existing knowledge…");
  await generateGlossary(client, settings, process.argv.includes("--force"));
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
