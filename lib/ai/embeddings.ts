import "server-only";
import { mapConcurrent } from "@/lib/processing/concurrency";
import { fetchWithRetry, processingLimit, withRequestSlot } from "@/lib/processing/requests";
import { uploadExecution } from "@/lib/ingest/workflowContext";

import { type AiCallLogger, logSafely } from "./callLog";
import { TOKEN_FACTORY_BASE_URL } from "./config";

// =====================================================================
// EMBEDDINGS: claim text as vectors, so claims that say the same thing in
// different words can be found (lib/knowledge/similarity.ts). Same
// provider and key as chat (Nebius Token Factory, OpenAI-compatible).
// The model is AI_EMBEDDING_MODEL, else Qwen3-Embedding-8B, cut to
// EMBEDDING_DIMENSIONS so pgvector can index it (unit_embeddings).
// =====================================================================

export const DEFAULT_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-8B";
// Must match the vector(...) column in public.unit_embeddings
export const EMBEDDING_DIMENSIONS = 1024;
// Texts per request (keeps one request well under the provider's limits)
const BATCH_SIZE = 64;
const REQUEST_TIMEOUT_MS = 60_000;

// TEXTS -> VECTORS, in the same order
export type Embedder = { model: string; embed: (texts: string[]) => Promise<number[][]> };

type EmbeddingResponse = { data?: { index: number; embedding: number[] }[]; usage?: { prompt_tokens?: number }; error?: { message?: string } };

// The embedder from server env; null without NEBIUS_API_KEY (callers then compare words only)
export function embedderFromEnv(env: NodeJS.ProcessEnv = process.env, logCall?: AiCallLogger): Embedder | null {
  if (!env.NEBIUS_API_KEY) return null;
  const apiKey = env.NEBIUS_API_KEY;
  const model = env.AI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const embedBatch = async (texts: string[]): Promise<number[][]> => {
    const started = Date.now();
    let promptTokens: number | null = null;
    let error: string | null = null;
    try {
      const signal = uploadExecution.getStore()?.signal;
      const body = await withRequestSlot("embedding", new URL(TOKEN_FACTORY_BASE_URL).host, apiKey, async (requestSignal) => {
      const response = await fetchWithRetry(new URL("embeddings", TOKEN_FACTORY_BASE_URL), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
        signal: requestSignal ? AbortSignal.any([requestSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.json()) as EmbeddingResponse;
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? `Embedding request failed (${response.status})`);
      return body;
      }, signal);
      promptTokens = body.usage?.prompt_tokens ?? null;
      const ordered = [...body.data!].sort((a, b) => a.index - b.index);
      if (ordered.length !== texts.length || ordered.some((item, index) => item.index !== index ||
        !Array.isArray(item.embedding) || item.embedding.length !== EMBEDDING_DIMENSIONS ||
        item.embedding.some(value => !Number.isFinite(value)) || !item.embedding.some(value => value !== 0))) {
        throw new Error(`${model} returned invalid embeddings; expected ${texts.length} nonzero, finite vectors of ${EMBEDDING_DIMENSIONS} numbers with unique input indices`);
      }
      return ordered.map(item => item.embedding);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      throw caught;
    } finally {
      await logSafely(logCall, {
        purpose: "embeddings",
        subject: `${texts.length} claim${texts.length === 1 ? "" : "s"}`,
        model,
        reasoningEffort: "none",
        promptTokens,
        completionTokens: 0,
        reasoningTokens: null,
        durationMs: Date.now() - started,
        status: error ? "error" : "ok",
        error,
      });
    }
  };
  return {
    model,
    embed: async (texts) => {
      const batches: string[][] = [];
      for (let start = 0; start < texts.length; start += BATCH_SIZE) batches.push(texts.slice(start, start + BATCH_SIZE));
      return (await mapConcurrent(batches, processingLimit("embedding"), embedBatch, uploadExecution.getStore()?.signal)).flat();
    },
  };
}
