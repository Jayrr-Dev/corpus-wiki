export const reviewProgressChannel = (runId: string) => `page-review:${runId}`;
export const REVIEW_PROGRESS_EVENT = "progress";

// Only the public answer is previewed; never stream the model's reasoning.
export function reviewStreamDetail(content: string): string | null {
  if (/"edits"\s*:/.test(content)) return "Preparing editorial fixes and checking unresolved decisions…";
  const match = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(content);
  if (!match?.[1]) return null;
  try { return `Draft review: ${JSON.parse(`"${match[1]}"`) as string}`; }
  catch { return null; } // An escape sequence may still be arriving.
}
