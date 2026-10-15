import "server-only";

import type { z } from "zod";
import type { StageSkills } from "./skills/types";
import { DEFAULT_AI_MODEL, TOKEN_FACTORY_BASE_URL } from "./config";

// =====================================================================
// TOKEN FACTORY CHAT CALL: one OpenAI-compatible chat completion that must
// answer with JSON matching a zod schema. The schema is sent as
// `response_format: json_schema`, so the server constrains the output,
// and the reply is parsed again here, so a bad answer can never pass.
// Shared by reconciliation (lib/ai) and section writing (lib/living-page).
// =====================================================================

export type TokenFactorySettings = { apiKey: string; model?: string; baseUrl?: string; skills?: StageSkills };

export type ChatMessage = { role: "system" | "user"; content: string };

export type ChatJsonResult<T> = { value: T; model: string; tokensIn: number | null; tokensOut: number | null };

type CompletionResponse = {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

// The model AI calls use: the one picked on /settings, else AI_MODEL, else the Nemotron default
export function resolveModel(chosenModel: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return chosenModel || env.AI_MODEL || DEFAULT_AI_MODEL;
}

// Reads the Token Factory settings from server env (+ the picked model); null when there is no key
export function tokenFactoryFromEnv(env: NodeJS.ProcessEnv = process.env, chosenModel: string | null = null): TokenFactorySettings | null {
  if (!env.NEBIUS_API_KEY) return null;
  return { apiKey: env.NEBIUS_API_KEY, model: resolveModel(chosenModel, env) };
}

// A truncated response must never be accepted, even if its JSON happens to parse.
export class CompletionLengthError extends Error {
  constructor(readonly tokensIn: number | null, readonly tokensOut: number | null, readonly model?: string, readonly maxTokens?: number) {
    super(`${model ?? "The model"} reached its output limit${maxTokens === undefined ? "" : ` (${maxTokens} tokens requested)`} before completing the answer.`);
    this.name = "CompletionLengthError";
  }
}

// Sends the messages and returns the parsed, validated JSON answer
export async function chatJson<S extends z.ZodType>(
  settings: TokenFactorySettings,
  request: { name: string; schema: S; jsonSchema: object; messages: ChatMessage[]; maxTokens?: number },
): Promise<ChatJsonResult<z.infer<S>>> {
  const model = settings.model || DEFAULT_AI_MODEL;
  const maxTokens = request.maxTokens ?? 8000;
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
      // Nemotron otherwise can spend the entire output budget on hidden reasoning.
      ...(/^nvidia\/(?:nvidia-)?nemotron-3[\/_.-]/i.test(model)
        ? { chat_template_kwargs: { enable_thinking: false } }
        : /^zai-org\/glm-5\.3-flash$/i.test(model)
          // GLM-5.3-Flash always reasons and defaults to max effort; enable_thinking is not its control.
          ? { reasoning_effort: "low", chat_template_kwargs: { reasoning_effort: "low" } }
          : {}),
      max_tokens: maxTokens,
      response_format: { type: "json_schema", json_schema: { name: request.name, schema: request.jsonSchema, strict: true } },
    }),
  });
  if (!response.ok) throw new Error(`Token Factory ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as CompletionResponse;
  return {
    value: parseContent(body, request.schema, body.model ?? model, maxTokens),
    model: body.model ?? model,
    tokensIn: body.usage?.prompt_tokens ?? null,
    tokensOut: body.usage?.completion_tokens ?? null,
  };
}

// Pulls the message text out of the completion and validates it against the schema
function parseContent<S extends z.ZodType>(body: CompletionResponse, schema: S, model: string, maxTokens: number): z.infer<S> {
  const choice = body.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new CompletionLengthError(body.usage?.prompt_tokens ?? null, body.usage?.completion_tokens ?? null, model, maxTokens);
  }
  if (choice?.message?.refusal) throw new Error(`${model} declined the request: ${choice.message.refusal}`);
  const content = choice?.message?.content;
  if (!content) throw new Error(`The model returned no answer (finish reason: ${choice?.finish_reason ?? "unknown"}).`);
  const parsed = schema.safeParse(JSON.parse(content));
  if (!parsed.success) throw new Error(`The model's answer did not match the expected shape: ${parsed.error.message}`);
  return parsed.data;
}

// Nebius documents Retry-After for throttling. Never retry malformed requests,
// authentication failures, truncation or validation failures at this layer.
async function postCompletion(url: URL, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error("The AI provider did not respond within two minutes. Retry processing the upload.");
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
