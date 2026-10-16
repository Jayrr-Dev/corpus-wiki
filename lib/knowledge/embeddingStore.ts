import type { Embedder } from "@/lib/ai/embeddings";
import type { DbRpc } from "@/lib/db/rpc";

// =====================================================================
// CLAIM VECTORS IN THE DATABASE (public.unit_embeddings): saving the
// vectors of live claims and finding the claims nearest to a vector.
// Through the DbRpc port, so the pipeline, scripts and tests share it.
// =====================================================================

// A LIVE CLAIM NEAR A VECTOR (similarity is cosine, 1 = same direction)
export type SimilarUnit = { unitId: string; revisionId: string; content: string; similarity: number };

type MissingRow = { unit_id: string; revision_id: string; content: string };
type SimilarRow = { unit_id: string; revision_id: string; content: string; similarity: number };

// pgvector reads "[0.1,0.2,...]", which is also a JSON array
const vectorText = (vector: readonly number[]) => JSON.stringify(vector);

// Embeds every live claim whose current wording has no vector yet; returns how many were saved
export async function embedMissingUnits(db: DbRpc, embedder: Embedder, pageSize = 256): Promise<number> {
  let saved = 0;
  for (;;) {
    const missing = await db.call<MissingRow[]>("missing_unit_embeddings", { p_model: embedder.model, p_limit: pageSize });
    if (!missing.length) return saved;
    const vectors = await embedder.embed(missing.map((row) => row.content));
    saved += await db.call<number>("save_unit_embeddings", {
      p_rows: missing.map((row, index) => ({ revisionId: row.revision_id, unitId: row.unit_id, model: embedder.model, embedding: vectors[index] })),
    });
    if (missing.length < pageSize) return saved;
  }
}

// The live claims most like a vector, most alike first
export async function similarUnits(db: DbRpc, model: string, vector: readonly number[], limit: number, minSimilarity: number): Promise<SimilarUnit[]> {
  const rows = await db.call<SimilarRow[]>("similar_units", { p_embedding: vectorText(vector), p_model: model, p_limit: limit, p_min: minSimilarity });
  return rows.map((row) => ({ unitId: row.unit_id, revisionId: row.revision_id, content: row.content, similarity: row.similarity }));
}

// Vectors of the given revisions that are already saved (revision id -> vector)
export async function savedVectors(db: DbRpc, model: string, revisionIds: readonly string[]): Promise<Map<string, number[]>> {
  if (!revisionIds.length) return new Map();
  const rows = await db.call<{ revision_id: string; embedding: string }[]>("unit_vectors", { p_model: model, p_revision_ids: revisionIds });
  return new Map(rows.map((row) => [row.revision_id, JSON.parse(row.embedding) as number[]]));
}

// =====================================================================
// SOURCE PASSAGE VECTORS (public.passage_embeddings): the text of live
// sources, so the chatbot finds what a source says by meaning even where
// no claim was drawn from it. Kept apart from claim vectors.
// =====================================================================

// A LIVE SOURCE'S PASSAGE NEAR A VECTOR
export type SimilarPassage = { passageId: string; sourceId: string; text: string; similarity: number };

type MissingPassageRow = { passage_id: string; text: string };
type SimilarPassageRow = { passage_id: string; source_id: string; text: string; similarity: number };

// Embeds every passage of a live source that has no vector yet; returns how many were saved
export async function embedMissingPassages(db: DbRpc, embedder: Embedder, pageSize = 128): Promise<number> {
  let saved = 0;
  for (;;) {
    const missing = await db.call<MissingPassageRow[]>("missing_passage_embeddings", { p_model: embedder.model, p_limit: pageSize });
    if (!missing.length) return saved;
    const vectors = await embedder.embed(missing.map((row) => row.text));
    const count = await db.call<number>("save_passage_embeddings", {
      p_rows: missing.map((row, index) => ({ passageId: row.passage_id, model: embedder.model, embedding: vectors[index] })),
    });
    saved += count;
    // A passage deleted mid-batch is skipped; stop rather than ask for the same rows again
    if (!count || missing.length < pageSize) return saved;
  }
}

// The live sources' passages most like a vector, most alike first
export async function similarPassages(db: DbRpc, model: string, vector: readonly number[], limit: number, minSimilarity: number): Promise<SimilarPassage[]> {
  const rows = await db.call<SimilarPassageRow[]>("similar_passages", { p_embedding: vectorText(vector), p_model: model, p_limit: limit, p_min: minSimilarity });
  return rows.map((row) => ({ passageId: row.passage_id, sourceId: row.source_id, text: row.text, similarity: row.similarity }));
}
