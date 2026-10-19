import "server-only";
import type { Embedder } from "@/lib/ai/embeddings";
import type { DbRpc } from "@/lib/db/rpc";
import { similarUnits } from "@/lib/knowledge/embeddingStore";

// Literal subject matches complement vectors: a top-12 similarity search cannot
// establish coverage of a book's many distinct claims about the same subject.
export async function articleKnowledgeCandidates(db: DbRpc, title: string, scope?: string | null, embedder?: Embedder | null): Promise<string[]> {
  const ids = new Set(await db.call<string[]>("article_knowledge_candidates", { p_title: title, p_scope: scope ?? "" }));
  if (embedder) {
    const [vector] = await embedder.embed([`${title}\n${scope ?? ""}`.slice(0, 6000)]);
    if (!vector) throw new Error("The embedding provider returned no vector for the article coverage check.");
    for (const unit of await similarUnits(db, embedder.model, vector, 150, 0.55)) ids.add(unit.unitId);
  }
  return [...ids];
}
