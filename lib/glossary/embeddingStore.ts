import "server-only";
import { createHash } from "node:crypto";
import type { Embedder } from "@/lib/ai/embeddings";
import type { DbRpc } from "@/lib/db/rpc";
import type { GlossaryEntry } from "./entries";

export function glossaryEmbeddingText(entry: GlossaryEntry): string {
  return [entry.term, entry.expansion, entry.aliases.join("; "), entry.definition, entry.context].filter(Boolean).join("\n");
}

export async function embedMissingGlossary(db: DbRpc, embedder: Embedder): Promise<number> {
  let saved = 0;
  for (;;) {
    const entries = await db.call<GlossaryEntry[]>("missing_glossary_embeddings", { p_model: embedder.model, p_limit: 64 });
    if (!entries.length) return saved;
    const vectors = await embedder.embed(entries.map(glossaryEmbeddingText));
    if (vectors.length !== entries.length) throw new Error("The glossary embedder returned an incomplete batch.");
    const count = await db.call<number>("save_glossary_embeddings", { p_rows: entries.map((entry, index) => ({
      hash: createHash("sha256").update(JSON.stringify(entry)).digest("hex"), model: embedder.model, entry, embedding: vectors[index],
    })) });
    saved += count;
    // A concurrent dictionary replacement can make a whole old batch ineligible.
    if (!count || entries.length < 64) return saved;
  }
}

export type GlossaryMatch = { entry: GlossaryEntry; similarity: number };
export async function similarGlossary(db: DbRpc, model: string, vector: number[], limit = 8): Promise<GlossaryMatch[]> {
  return db.call<GlossaryMatch[]>("search_glossary", { p_model: model, p_embedding: JSON.stringify(vector), p_limit: limit, p_min: 0.3 });
}
