import "server-only";

import type { z } from "zod";
import { type AiCallLogger, type AiCallStatus, type CompletionUsage, logSafely, usageTokens } from "./callLog";
import { DEFAULT_AI_MODEL, TOKEN_FACTORY_BASE_URL } from "./config";

// =====================================================================
// TOKEN FACTORY CHAT CALL: one OpenAI-compatible chat completion that must
// answer with JSON matching a zod schema. The schema is sent as
// `response_format: json_schema`, so the server constrains the output,
// and the reply is parsed again here, so a bad answer can never pass.
// Shared by reconciliation (lib/ai) and section writing (lib/living-page).
// =====================================================================

// `logCall` records every attempt's token usage (the app's server deps set it)
export type TokenFactorySettings = { apiKey: string; model?: string; baseUrl?: string; logCall?: AiCallLogger };

export type ChatMessage = { role: "system" | "user"; content: string };

export type ChatJsonResult<T> = { value: T; model: string; tokensIn: number | null; tokensOut: number | null };

// REASONING EFFORTS, tried in order. Reasoning models think before they answer, and the
// thinking counts against max_tokens. On a 169-passage PDF, GLM-5.3-Flash at its default
// effort thought through 8,000, then 32,000 tokens and never wrote the JSON. Measured on that PDF:
//   GLM-5.3-Flash  low: 19 actions in 14 s   medium: 64 actions in 134 s, or cut off after 160 s
//   Nemotron Super low:  4 actions in 3 s    medium: 26 actions in 18 s
// "medium" reads the whole file when it finishes; when it runs out of room, "low" still answers.
const REASONING_EFFORTS = ["medium", "low"] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

// AN ANSWER CUT OFF BY THE TOKEN BUDGET: the one failure a lower reasoning effort can fix
export class AnswerCutOffError extends Error {}

// ANSWER TOKEN BUDGET (max_tokens): room for a long file's full answer plus any thinking.
// It is only a ceiling; a call is billed for the tokens it uses.
export const ANSWER_TOKEN_BUDGET = 32_000;

export type CompletionResponse = {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: CompletionUsage;
};

// The model AI calls use: the one picked on /settings, else AI_MODEL, else the Nemotron default
export function resolveModel(chosenModel: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return chosenModel || env.AI_MODEL || DEFAULT_AI_MODEL;
}

// Reads the Token Factory settings from server env (+ the picked model and the usage logger); null when there is no key
export function tokenFactoryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  chosenModel: string | null = null,
  logCall?: AiCallLogger,
): TokenFactorySettings | null {
  if (!env.NEBIUS_API_KEY) return null;
  return { apiKey: env.NEBIUS_API_KEY, model: resolveModel(chosenModel, env), logCall };
}

// `subject` names what the call is about (a file title, a section) for the usage log
type ChatJsonRequest<S extends z.ZodType> = {
  name: string;
  subject?: string;
  schema: S;
  jsonSchema: object;
  messages: ChatMessage[];
  maxTokens?: number;
};

// Sends the messages and returns the parsed, validated JSON answer. An answer cut off by
// the token budget is asked again at the next lower reasoning effort; other errors stop at once.
export async function chatJson<S extends z.ZodType>(settings: TokenFactorySettings, request: ChatJsonRequest<S>): Promise<ChatJsonResult<z.infer<S>>> {
  let cutOff: AnswerCutOffError | null = null;
  for (const effort of REASONING_EFFORTS) {
    try {
      return await chatJsonOnce(settings, request, effort);
    } catch (error) {
      if (!(error instanceof AnswerCutOffError)) throw error;
      cutOff = error;
    }
  }
  throw cutOff ?? new AnswerCutOffError("The model ran out of room.");
}

// ONE COMPLETION at one reasoning effort, logged whether it worked or not
async function chatJsonOnce<S extends z.ZodType>(
  settings: TokenFactorySettings,
  request: ChatJsonRequest<S>,
  effort: ReasoningEffort,
): Promise<ChatJsonResult<z.infer<S>>> {
  const model = settings.model || DEFAULT_AI_MODEL;
  const startedAt = Date.now();
  let body: CompletionResponse | undefined;
  const log = (status: AiCallStatus, error: string | null) =>
    logSafely(settings.logCall, {
      purpose: request.name,
      subject: request.subject ?? null,
      model: body?.model ?? model,
      reasoningEffort: effort,
      ...usageTokens(body?.usage),
      durationMs: Date.now() - startedAt,
      status,
      error,
    });
  try {
    body = await requestCompletion(settings, request, model, effort);
    const value = parseContent(body, request.schema);
    await log("ok", null);
    return { value, model: body.model ?? model, tokensIn: body.usage?.prompt_tokens ?? null, tokensOut: body.usage?.completion_tokens ?? null };
  } catch (error) {
    await log(error instanceof AnswerCutOffError ? "cut_off" : "error", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// THE HTTP CALL: an OpenAI-compatible chat completion constrained to the JSON schema
async function requestCompletion(settings: TokenFactorySettings, request: ChatJsonRequest<z.ZodType>, model: string, effort: ReasoningEffort): Promise<CompletionResponse> {
  const response = await fetch(new URL("chat/completions", settings.baseUrl ?? TOKEN_FACTORY_BASE_URL), {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: request.messages,
      temperature: 0,
      max_tokens: request.maxTokens ?? ANSWER_TOKEN_BUDGET,
      reasoning_effort: effort,
      response_format: { type: "json_schema", json_schema: { name: request.name, schema: request.jsonSchema } },
    }),
  });
  if (!response.ok) throw new Error(`Token Factory ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return (await response.json()) as CompletionResponse;
}

// Pulls the message text out of the completion and validates it against the schema.
// Each way an answer can be unusable gets its own message, so the Upload screen says what happened.
export function parseContent<S extends z.ZodType>(body: CompletionResponse, schema: S): z.infer<S> {
  const choice = body.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (choice?.finish_reason === "length") {
    throw new AnswerCutOffError(
      `The model ran out of room after ${body.usage?.completion_tokens ?? "its"} tokens before finishing its answer. Try again, or pick another model in Settings.`,
    );
  }
  if (!content) throw new Error(`The model returned no answer (finish reason: ${choice?.finish_reason ?? "unknown"}).`);
  const parsed = schema.safeParse(parseJson(content));
  if (!parsed.success) throw new Error(`The model's answer did not match the expected shape: ${parsed.error.message}`);
  return parsed.data;
}

// JSON.parse with a message a person can act on instead of "Unexpected end of JSON input"
function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`The model's answer was not valid JSON (it ends with: "${content.slice(-80)}").`);
  }
}
