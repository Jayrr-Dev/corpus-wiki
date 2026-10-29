import "server-only";
import { fetchWithRetry } from "@/lib/processing/requests";

// =====================================================================
// RERANK: re-sorts chat search candidates (the fused top claims) by how
// well each one answers the question, using Voyage AI's reranker
// (https://docs.voyageai.com/reference/reranker-api). On whenever
// VOYAGE_API_KEY is set; without it chat search stays legacy. The model is
// VOYAGE_RERANK_MODEL, else rerank-2.5. It sits on the chat path, so it
// retries at most once and gives up after REQUEST_TIMEOUT_MS; callers keep
// their own order when it throws.
// =====================================================================

export const DEFAULT_RERANK_MODEL = "rerank-2.5";
export const VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank";
export const REQUEST_TIMEOUT_MS = 5_000;

// QUERY + DOCUMENTS -> input indices, best first
export type Reranker = { model: string; rerank(query: string, documents: string[], signal?: AbortSignal): Promise<number[]> };

type RerankResponse = { data?: { index?: unknown; relevance_score?: unknown }[]; detail?: unknown };

// The reranker from server env; null without a key
export function getReranker(env: NodeJS.ProcessEnv = process.env): Reranker | null {
  if (!env.VOYAGE_API_KEY) return null;
  const apiKey = env.VOYAGE_API_KEY;
  const model = env.VOYAGE_RERANK_MODEL || DEFAULT_RERANK_MODEL;
  return {
    model,
    rerank: async (query, documents, signal) => {
      if (documents.length === 0) return [];
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const response = await fetchWithRetry(VOYAGE_RERANK_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, documents, model, truncation: true }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      }, 2);
      const body = (await response.json().catch(() => ({}))) as RerankResponse;
      if (!response.ok) {
        const detail = typeof body.detail === "string" ? `: ${body.detail.slice(0, 200)}` : "";
        throw new Error(`Rerank request failed (${response.status})${detail}`);
      }
      const data = body.data;
      const seen = new Set<number>();
      if (!Array.isArray(data) || data.length !== documents.length || data.some(item => {
        const { index, relevance_score: score } = item ?? {};
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= documents.length || seen.has(index)) return true;
        seen.add(index);
        return typeof score !== "number" || !Number.isFinite(score);
      })) {
        throw new Error(`${model} returned an invalid ranking; expected ${documents.length} results with unique input indices and finite scores`);
      }
      return [...data]
        .sort((a, b) => (b.relevance_score as number) - (a.relevance_score as number))
        .map(item => item.index as number);
    },
  };
}
