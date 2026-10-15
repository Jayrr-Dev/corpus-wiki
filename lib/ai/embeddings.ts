import "server-only";

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
      const response = await fetch(new URL("embeddings", TOKEN_FACTORY_BASE_URL), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.json()) as EmbeddingResponse;
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? `Embedding request failed (${response.status})`);
      promptTokens = body.usage?.prompt_tokens ?? null;
      const vectors = [...body.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
      if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
        throw new Error(`${model} returned ${vectors.length} vectors of ${vectors[0]?.length ?? 0} numbers; expected ${texts.length} of ${EMBEDDING_DIMENSIONS}`);
      }
      return vectors;
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
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += BATCH_SIZE) vectors.push(...(await embedBatch(texts.slice(start, start + BATCH_SIZE))));
      return vectors;
    },
  };
}
