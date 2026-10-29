import { roleForPurpose } from "./roles";
import { processingMetric } from "@/lib/processing/metrics";
import { creditsForCall } from "@/lib/billing/credits";

// =====================================================================
// AI CALL LOG: what one call to the AI provider cost and how it went.
// chatJson builds one record per attempt and hands it to the settings'
// `logCall` (the app writes it to public.ai_calls; tests leave it unset).
// =====================================================================

export type AiCallStatus = "ok" | "cut_off" | "error";

export type AiCallRecord = {
  role?: string | null;
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
  usageDetails?: CompletionUsage | null;
  // Credits the call cost (1 credit = $0.001 of estimateCallCost), fixed at write time; null when unpriced
  credits?: number | null;
};

export type AiCallLogger = (call: AiCallRecord) => Promise<void>;

// THE PROVIDER'S USAGE FIELD (OpenAI-compatible; reasoning tokens sit in one of two places)
export type CompletionUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
  billing_rounds?: CompletionUsage[];
};

// Token counts from a usage field (all null when the provider sent none)
export function usageTokens(usage: CompletionUsage | undefined): Pick<AiCallRecord, "promptTokens" | "completionTokens" | "reasoningTokens" | "usageDetails"> {
  return {
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? usage?.reasoning_tokens ?? null,
    usageDetails: usage ?? null,
  };
}

// Writes a record without ever failing the AI call (a lost log line beats a lost upload)
export async function logSafely(logger: AiCallLogger | undefined, call: AiCallRecord): Promise<void> {
  processingMetric(`ai.${call.purpose}`, call.durationMs, { failed: call.status !== "ok", tokensIn: call.promptTokens, tokensOut: call.completionTokens });
  if (!logger) return;
  try {
    const credits = call.credits !== undefined
      ? call.credits
      : creditsForCall({ model: call.model, prompt_tokens: call.promptTokens, completion_tokens: call.completionTokens, usage_details: call.usageDetails });
    await logger({ ...call, credits, role: call.role ?? roleForPurpose(call.purpose) });
  } catch (error) {
    console.error("Could not log the AI call:", error);
  }
}
