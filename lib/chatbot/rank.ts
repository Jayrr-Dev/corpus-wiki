import "server-only";
import type { Embedder } from "@/lib/ai/embeddings";
import { getReranker, type Reranker } from "@/lib/ai/rerank";
import type { DbRpc } from "@/lib/db/rpc";
import { savedVectors, similarUnits } from "@/lib/knowledge/embeddingStore";
import { cosine } from "@/lib/knowledge/similarity";
import type { ServerSupabase } from "@/lib/supabase/server";
import { reciprocalRankFusion } from "./fusion";
import { searchFilter } from "./validation";

// =====================================================================
// CLAIM RANKING FOR CHAT: which claims a question should see, best first.
// Each search (an "arm") makes its own list; "hybrid" fuses the capped
// lists with reciprocal rank fusion, "legacy" keeps the old glued order
// for comparison and as the fallback. Hybrid is the default whenever the
// reranker (VOYAGE_API_KEY) is configured; it re-sorts the fused top claims.
// Ids only: callers recheck every id through the user's session.
// =====================================================================

export type SearchMode = "legacy" | "hybrid";
export type RankDeps = {
  db: DbRpc;
  client: ServerSupabase;
  embedder: Embedder;
  // The selected entity: its claims are searched before any global limit
  entity?: { type: string; key: string };
  // The question's vector when the caller already has it; null when embedding failed
  vector?: number[] | null;
  mode?: SearchMode;
  // Defaults to the one the environment switches on; null turns reranking off
  reranker?: Reranker | null;
};
// rerankedBy is the reranker's model when it re-sorted the list, else null
export type RankResult = { unitIds: string[]; arms: Record<string, string[]>; mode: SearchMode; rerankedBy: string | null; warning: string | null };

// Longest list each arm brings into the fusion
export const ARM_CAP = 20;
// Top meaning and top keyword matches whose links are followed
export const LINK_SEEDS = 5;
// With an entity selected, its own arms count this many times, so global matches cannot outvote them
export const SCOPED_WEIGHT = 2;
// How many of the fused claims the reranker re-sorts
export const RERANK_DEPTH = 40;
const MIN_SIMILARITY = 0.35;
const SEMANTIC_WARNING = "Semantic search is unavailable; this answer uses text matches only.";

// Hybrid plus rerank beats legacy (hit@5 100% vs 90%, docs/progress-2026-10-29.md), but the
// fused order alone measured worse (58%), so hybrid never runs without a reranker: no key, legacy.
// Callers that pass `mode` explicitly (evals, tests) still get exactly the mode they ask for.
export function searchMode(env: NodeJS.ProcessEnv = process.env): SearchMode {
  return getReranker(env) ? "hybrid" : "legacy";
}

export async function rankUnits(question: string, deps: RankDeps): Promise<RankResult> {
  const { db, client, embedder, entity } = deps;
  const mode = deps.mode ?? searchMode();
  const hybrid = mode === "hybrid";
  let warning: string | null = null;
  let vector = deps.vector;
  if (vector === undefined) {
    try {
      [vector] = await embedder.embed([question]);
      if (!vector) throw new Error("No query embedding returned.");
    } catch { vector = null; warning = SEMANTIC_WARNING; }
  }
  let meaning: string[] = [];
  if (vector) {
    try { meaning = (await similarUnits(db, embedder.model, vector, hybrid ? ARM_CAP : 12, MIN_SIMILARITY)).map(match => match.unitId); }
    catch { warning = SEMANTIC_WARNING; }
  }
  const filter = searchFilter(["content", "title"], question);
  // Unranked word matches anywhere: legacy's last list, and hybrid's only when its rerank fails
  const wordMatches = async () => {
    if (!filter) return [];
    const lexical = await client.from("revisions").select("unit_id").or(filter).limit(20);
    if (lexical.error) throw lexical.error;
    return (lexical.data ?? []).map(row => row.unit_id);
  };
  const words = hybrid ? [] : await wordMatches();
  let keyword: string[] = [];
  if (hybrid) {
    try { keyword = (await db.call<{ unit_id: string }[]>("search_units_text", { p_query: question, p_limit: ARM_CAP })).map(row => row.unit_id); }
    catch { warning = warning ?? "Keyword search is temporarily unavailable; other matches are still included."; }
  }
  let link: string[] = [];
  const seeds = [...new Set([...meaning.slice(0, LINK_SEEDS), ...keyword.slice(0, LINK_SEEDS)])];
  if (hybrid && seeds.length) {
    try { link = (await db.call<{ unit_id: string }[]>("linked_units", { p_unit_ids: seeds, p_limit: ARM_CAP })).map(row => row.unit_id); }
    catch { warning = warning ?? "Linked claims are temporarily unavailable; other matches are still included."; }
  }
  // Search inside the chosen entity before applying result limits. Otherwise global
  // top matches from larger companies can crowd out every relevant scoped claim.
  const scoped: { unitId: string; score: number }[] = [];
  const scopedWords: string[] = [];
  if (entity) {
    const scopeIds = await db.call<string[]>("living_page_query_units", { p_query: { entity: { type: entity.type, key: entity.key } } });
    for (let start = 0; start < scopeIds.length; start += 200) {
      const scopeUnits = await client.from("units").select("id,current_revision_id").in("id", scopeIds.slice(start, start + 200)).is("retired_at", null);
      if (scopeUnits.error) throw scopeUnits.error;
      const current = scopeUnits.data ?? [];
      const currentIds = current.map(unit => unit.current_revision_id);
      if (!currentIds.length) continue;
      if (filter) {
        const scopedLexical = await client.from("revisions").select("unit_id").in("id", currentIds).or(filter).limit(20);
        if (scopedLexical.error) throw scopedLexical.error;
        scopedWords.push(...(scopedLexical.data ?? []).map(row => row.unit_id));
      }
      if (vector) {
        try {
          const vectors = await savedVectors(db, embedder.model, currentIds);
          for (const unit of current) {
            const saved = vectors.get(unit.current_revision_id);
            if (!saved || saved.length !== vector.length) continue;
            const score = cosine(vector, saved);
            if (score >= MIN_SIMILARITY) scoped.push({ unitId: unit.id, score });
          }
        } catch { warning = "Some scoped semantic matches are unavailable; text matches are still included."; }
      }
    }
  }
  const scopedMeaning = scoped.sort((a, b) => b.score - a.score).slice(0, hybrid ? ARM_CAP : 12).map(item => item.unitId);
  // Legacy keeps the top 12 by meaning; hybrid fetched up to 20 in the same order, so its top 12 match
  const legacyOrder = (words: string[]) => [...new Set([...[...scopedMeaning.slice(0, 12), ...scopedWords].slice(0, 32), ...meaning.slice(0, 12), ...words])];
  if (!hybrid) return { unitIds: legacyOrder(words), arms: { meaning, words, scopedMeaning, scopedWords }, mode, rerankedBy: null, warning };
  const arms = { meaning, keyword, link, scopedMeaning, scopedWords: scopedWords.slice(0, ARM_CAP) };
  const scopedArms = Array.from({ length: SCOPED_WEIGHT }, () => [arms.scopedMeaning, arms.scopedWords]).flat();
  const fused = reciprocalRankFusion([meaning, keyword, link, ...scopedArms], { cap: ARM_CAP });
  const reranker = deps.reranker === undefined ? getReranker() : deps.reranker;
  if (reranker) {
    try {
      const reranked = await rerankTop(question, fused.slice(0, RERANK_DEPTH), client, reranker);
      return { unitIds: [...reranked, ...fused.slice(RERANK_DEPTH)], arms: { ...arms, reranked }, mode, rerankedBy: reranker.model, warning };
    } catch {
      // The fused order without the reranker measured worse than legacy (docs/hindsight-ideas.md),
      // so a failed rerank falls back to legacy. The user still gets an answer; no warning needed.
      const words = await wordMatches();
      return { unitIds: legacyOrder(words), arms: { ...arms, words }, mode, rerankedBy: null, warning };
    }
  }
  return { unitIds: fused, arms, mode, rerankedBy: null, warning };
}

// Re-sorts ids by their current title and wording; ids whose text the client cannot read keep their place after the rest
async function rerankTop(question: string, ids: string[], client: ServerSupabase, reranker: Reranker): Promise<string[]> {
  if (!ids.length) return [];
  const units = await client.from("units").select("id,current_revision_id").in("id", ids).is("retired_at", null);
  if (units.error) throw units.error;
  const revisions = await client.from("revisions").select("id,unit_id,title,content").in("id", (units.data ?? []).map(unit => unit.current_revision_id));
  if (revisions.error) throw revisions.error;
  const text = new Map((revisions.data ?? []).map(revision => [revision.unit_id, [revision.title, revision.content].filter(Boolean).join("\n")]));
  const readable = ids.filter(id => text.get(id));
  const order = await reranker.rerank(question, readable.map(id => text.get(id)!));
  if (order.length !== readable.length || new Set(order).size !== order.length || order.some(index => !readable[index])) throw new Error(`${reranker.model} returned an invalid ranking`);
  return [...order.map(index => readable[index]!), ...ids.filter(id => !text.get(id))];
}
