import "server-only";

import type { z } from "zod";
import { type AiCallLogger, type AiCallStatus, type CompletionUsage, logSafely, usageTokens } from "./callLog";
import type { StageSkills } from "./skills/types";
import { DEFAULT_AI_MODEL, TOKEN_FACTORY_BASE_URL } from "./config";

// =====================================================================
// TOKEN FACTORY CHAT CALL: one OpenAI-compatible chat completion that must
// answer with JSON matching a zod schema. The schema is sent as
// `response_format: json_schema`, so the server constrains the output,
// and the reply is parsed again here, so a bad answer can never pass.
// Shared by reconciliation (lib/ai) and section writing (lib/living-page).
// =====================================================================

// `logCall` records every attempt's token usage (the app's server deps set it);
// `skills` are the instructions assigned to each AI stage on /skills
export type TokenFactorySettings = { apiKey: string; model?: string; baseUrl?: string; skills?: StageSkills; logCall?: AiCallLogger };

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

// A truncated response must never be accepted, even if its JSON happens to parse. Carries
// the usage so a caller that splits its input (reconciliation batches) can still count it.
export class CompletionLengthError extends AnswerCutOffError {
  constructor(readonly tokensIn: number | null, readonly tokensOut: number | null, readonly model?: string, readonly maxTokens?: number) {
    super(
      `${model ?? "The model"} ran out of room after ${tokensOut ?? "its"} tokens${maxTokens === undefined ? "" : ` (${maxTokens} allowed)`} before finishing its answer. Try again, or pick another model in Settings.`,
    );
    this.name = "CompletionLengthError";
  }
}

// ANSWER TOKEN BUDGET (max_tokens): room for a long file's full answer plus any thinking.
// It is only a ceiling; a call is billed for the tokens it uses.
export const ANSWER_TOKEN_BUDGET = 32_000;

// HOW LONG ONE COMPLETION MAY TAKE (a slow model at medium effort needs over two minutes)
const REQUEST_TIMEOUT_MS = 180_000;

export type CompletionResponse = {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
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

// Nemotron 3 runs with thinking off, so a reasoning effort changes nothing for it
const isNemotron3 = (model: string) => /^nvidia\/(?:nvidia-)?nemotron-3[\/_.-]/i.test(model);

// Sends the messages and returns the parsed, validated JSON answer. An answer cut off by
// the token budget is asked again at the next lower reasoning effort (for models that
// reason; for the rest a retry would only repeat the cut-off); other errors stop at once.
export async function chatJson<S extends z.ZodType>(settings: TokenFactorySettings, request: ChatJsonRequest<S>): Promise<ChatJsonResult<z.infer<S>>> {
  const efforts = isNemotron3(settings.model || DEFAULT_AI_MODEL) ? REASONING_EFFORTS.slice(0, 1) : REASONING_EFFORTS;
  let cutOff: AnswerCutOffError | null = null;
  for (const effort of efforts) {
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
  const maxTokens = request.maxTokens ?? ANSWER_TOKEN_BUDGET;
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
    body = await requestCompletion(settings, request, model, maxTokens, effort);
    const value = parseContent(body, request.schema, maxTokens);
    await log("ok", null);
    return { value, model: body.model ?? model, tokensIn: body.usage?.prompt_tokens ?? null, tokensOut: body.usage?.completion_tokens ?? null };
  } catch (error) {
    await log(error instanceof AnswerCutOffError ? "cut_off" : "error", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// Per-model request fields: Nemotron 3 otherwise spends its whole budget on hidden reasoning,
// so its thinking is off; GLM-5.3-Flash only honours the effort through its chat template
function reasoningFields(model: string, effort: ReasoningEffort): Record<string, unknown> {
  if (isNemotron3(model)) return { chat_template_kwargs: { enable_thinking: false } };
  if (/^zai-org\/glm-5\.3-flash$/i.test(model)) return { reasoning_effort: effort, chat_template_kwargs: { reasoning_effort: effort } };
  return { reasoning_effort: effort };
}

// THE HTTP CALL: an OpenAI-compatible chat completion constrained to the JSON schema
async function requestCompletion(
  settings: TokenFactorySettings,
  request: ChatJsonRequest<z.ZodType>,
  model: string,
  maxTokens: number,
  effort: ReasoningEffort,
): Promise<CompletionResponse> {
  const response = await postCompletion(new URL("chat/completions", settings.baseUrl ?? TOKEN_FACTORY_BASE_URL), {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: `Return only JSON matching this schema: ${JSON.stringify(request.jsonSchema)}` },
        ...request.messages,
      ],
      temperature: 0,
      ...reasoningFields(model, effort),
      max_tokens: maxTokens,
      response_format: { type: "json_schema", json_schema: { name: request.name, schema: request.jsonSchema, strict: true } },
    }),
  });
  if (!response.ok) throw new Error(`Token Factory ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return (await response.json()) as CompletionResponse;
}

// Pulls the message text out of the completion and validates it against the schema.
// Each way an answer can be unusable gets its own message, so the Upload screen says what happened.
export function parseContent<S extends z.ZodType>(body: CompletionResponse, schema: S, maxTokens?: number): z.infer<S> {
  const choice = body.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new CompletionLengthError(body.usage?.prompt_tokens ?? null, body.usage?.completion_tokens ?? null, body.model, maxTokens);
  }
  if (choice?.message?.refusal) throw new Error(`${body.model ?? "The model"} declined the request: ${choice.message.refusal}`);
  const content = choice?.message?.content?.trim();
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

// Nebius documents Retry-After for throttling. Never retry malformed requests,
// authentication failures, truncation or validation failures at this layer.
async function postCompletion(url: URL, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error("The AI provider did not respond within three minutes. Retry processing the upload.");
      }
      throw error;
    }
    if (response.status !== 429 || attempt >= 2) return response;
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter === null ? 2 ** attempt : Number(retryAfter);
    // Long or unsupported delays are reported instead of tying up a server action.
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) return response;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}
