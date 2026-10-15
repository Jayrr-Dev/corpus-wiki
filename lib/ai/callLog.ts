// =====================================================================
// AI CALL LOG: what one call to the AI provider cost and how it went.
// chatJson builds one record per attempt and hands it to the settings'
// `logCall` (the app writes it to public.ai_calls; tests leave it unset).
// =====================================================================

export type AiCallStatus = "ok" | "cut_off" | "error";

export type AiCallRecord = {
  purpose: string; // the request name: 'reconciliation', 'section_lines'
  subject: string | null; // which file or section, in words
  model: string;
  reasoningEffort: string;
  promptTokens: number | null;
  completionTokens: number | null; // includes reasoning tokens
  reasoningTokens: number | null;
  durationMs: number;
  status: AiCallStatus;
  error: string | null;
};

export type AiCallLogger = (call: AiCallRecord) => Promise<void>;

// THE PROVIDER'S USAGE FIELD (OpenAI-compatible; reasoning tokens sit in one of two places)
export type CompletionUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
};

// Token counts from a usage field (all null when the provider sent none)
export function usageTokens(usage: CompletionUsage | undefined): Pick<AiCallRecord, "promptTokens" | "completionTokens" | "reasoningTokens"> {
  return {
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? usage?.reasoning_tokens ?? null,
  };
}

// Writes a record without ever failing the AI call (a lost log line beats a lost upload)
export async function logSafely(logger: AiCallLogger | undefined, call: AiCallRecord): Promise<void> {
  if (!logger) return;
  try {
    await logger(call);
  } catch (error) {
    console.error("Could not log the AI call:", error);
  }
}
