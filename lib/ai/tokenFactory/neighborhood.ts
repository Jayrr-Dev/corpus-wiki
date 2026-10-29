import type { Embedder } from "@/lib/ai/embeddings";
import type { ExistingUnit } from "@/lib/ai/types";
import type { DbRpc } from "@/lib/db/rpc";
import { similarUnits } from "@/lib/knowledge/embeddingStore";
import { cosine, wordSet } from "@/lib/knowledge/similarity";
import type { AnswerClaim } from "./schema";

// =====================================================================
// A DRAFT CLAIM'S NEIGHBORHOOD (issue #45): the few stored claims and
// earlier claims of the same upload that resolution compares it with,
// instead of the whole store. Three sources, most alike first:
//   similar   the stored claims nearest its vector (top K)
//   entities  stored claims that name one of its entities
//   upload    claims drafted from earlier batches of the same file
// The sizes below bound one resolution prompt whatever the store holds.
// =====================================================================

export const SIMILAR_LIMIT = 8;
export const SIMILAR_MIN = 0.55;
export const ENTITY_LIMIT = 6;
export const UPLOAD_LIMIT = 6;
// Below this an entity or upload neighbor is noise: it shares a name but not the subject
const WORD_MIN = 0.15;

// Shared words over all words of both (Jaccard): a longer claim that contains these words scores below an exact match
function wordLikeness(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  const all = a.size + b.size - shared;
  return all ? shared / all : 0;
}

// THE STORE, as resolution reads it: vectors for draft text, nearest claims, claims by id
export type NeighborhoodStore = {
  // Vectors for texts, in order; null when no embedder is configured (word overlap only)
  embed(texts: string[]): Promise<number[][] | null>;
  // The live claims nearest a vector, most alike first
  similar(vector: readonly number[], limit: number): Promise<{ unitId: string; similarity: number }[]>;
  // Live claims by id (a similar claim saved after the input was read is not in the input)
  units(unitIds: string[]): Promise<ExistingUnit[]>;
};

// The store through the database port (lib/knowledge/embeddingStore.ts)
export function dbNeighborhoodStore(db: DbRpc, embedder: Embedder | null): NeighborhoodStore {
  return {
    embed: async (texts) => (embedder && texts.length ? embedder.embed(texts) : null),
    similar: async (vector, limit) => embedder
      ? (await similarUnits(db, embedder.model, vector, limit, SIMILAR_MIN)).map((row) => ({ unitId: row.unitId, similarity: row.similarity }))
      : [],
    units: async (unitIds) => (unitIds.length ? db.call<ExistingUnit[]>("reconciliation_units", { p_unit_ids: unitIds }) : []),
  };
}

// AN EARLIER CLAIM OF THE SAME UPLOAD, by its place among the file's claims
export type UploadClaim = { index: number; claim: AnswerClaim; vector: readonly number[] | null };

// ONE NEIGHBOR: a stored unit or an earlier upload claim, with how alike it is
export type Neighbor = { kind: "unit"; unit: ExistingUnit; similarity: number } | { kind: "upload"; claim: UploadClaim; similarity: number };

// Every entity key a claim names (subject, object, mentioned and scope)
export function claimEntityKeys(claim: Pick<AnswerClaim, "entities" | "applicability">): Set<string> {
  return new Set([...claim.entities, ...claim.applicability?.entities ?? []].map((entity) => `${entity.type}:${entity.key}`));
}

// Every entity key a stored claim's context names
export function unitEntityKeys(unit: ExistingUnit): Set<string> {
  const context = unit.context;
  return new Set([...context?.entities ?? [], ...context?.applicability.entities ?? []].map((entity) => `${entity.type}:${entity.key}`));
}

// THE NEIGHBORHOOD of one draft claim, most alike first. similar: from the vector search;
// stored: the claims known so far (the input's, plus any fetched); earlier: this upload's claims
export function pickNeighborhood(
  claim: AnswerClaim, vector: readonly number[] | null,
  similar: { unitId: string; similarity: number }[], stored: ReadonlyMap<string, ExistingUnit>, earlier: readonly UploadClaim[],
): Neighbor[] {
  const words = wordSet(claim.content);
  const keys = claimEntityKeys(claim);
  const neighbors = new Map<string, Neighbor>();
  for (const row of similar) {
    const unit = stored.get(row.unitId);
    if (unit) neighbors.set(unit.unitId, { kind: "unit", unit, similarity: row.similarity });
  }
  // Entity neighbors have no vector score here: rank them by shared words
  const sharing = keys.size ? [...stored.values()].filter((unit) => !neighbors.has(unit.unitId) && [...unitEntityKeys(unit)].some((key) => keys.has(key))) : [];
  for (const { unit, similarity } of sharing.map((unit) => ({ unit, similarity: wordLikeness(words, wordSet(unit.content)) }))
    .filter((row) => row.similarity >= WORD_MIN).sort((a, b) => b.similarity - a.similarity).slice(0, ENTITY_LIMIT)) {
    neighbors.set(unit.unitId, { kind: "unit", unit, similarity });
  }
  const alike = (other: UploadClaim) => vector && other.vector ? cosine(vector, other.vector) : wordLikeness(words, wordSet(other.claim.content));
  const upload = earlier.map((other) => ({ other, similarity: alike(other) }))
    .filter((row) => row.similarity >= (vector && row.other.vector ? SIMILAR_MIN : WORD_MIN) || [...claimEntityKeys(row.other.claim)].some((key) => keys.has(key)) && row.similarity >= WORD_MIN)
    .sort((a, b) => b.similarity - a.similarity).slice(0, UPLOAD_LIMIT);
  for (const { other, similarity } of upload) neighbors.set(`E${other.index}`, { kind: "upload", claim: other, similarity });
  return [...neighbors.values()].sort((a, b) => b.similarity - a.similarity);
}
