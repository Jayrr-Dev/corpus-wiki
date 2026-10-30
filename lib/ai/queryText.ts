// =====================================================================
// QUERY TEXT FOR EMBEDDINGS: Qwen3-Embedding is instruction-aware. A
// search query is embedded as "Instruct: <task>\nQuery: <text>", while
// stored documents (claims, passages, glossary entries) are embedded as
// plain text. Only query paths use this; stored vectors don't change.
// =====================================================================

// THE SEARCHES THAT EMBED A QUERY, each with the task line the model reads
export const QUERY_TASKS = {
  knowledge: "Given a question, retrieve knowledge claims and source passages that answer it",
  glossary: "Given a meaning or question, retrieve glossary definitions that match it",
} as const;

export type QueryTask = keyof typeof QUERY_TASKS;

// True for embedding models trained with query instructions (the Qwen3-Embedding family)
export function usesQueryInstruction(model: string): boolean {
  return /qwen3-embedding/i.test(model);
}

// The text to embed for a search query: instructed for models that expect it, unchanged otherwise
export function queryText(model: string, task: QueryTask, text: string): string {
  return usesQueryInstruction(model) ? `Instruct: ${QUERY_TASKS[task]}\nQuery: ${text}` : text;
}
