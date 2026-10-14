import "server-only";

import type { z } from "zod";
import { DEFAULT_AI_MODEL, TOKEN_FACTORY_BASE_URL } from "./config";

// =====================================================================
// TOKEN FACTORY CHAT CALL: one OpenAI-compatible chat completion that must
// answer with JSON matching a zod schema. The schema is sent as
// `response_format: json_schema`, so the server constrains the output,
// and the reply is parsed again here, so a bad answer can never pass.
// Shared by reconciliation (lib/ai) and section writing (lib/living-page).
// =====================================================================

export type TokenFactorySettings = { apiKey: string; model?: string; baseUrl?: string };

export type ChatMessage = { role: "system" | "user"; content: string };

export type ChatJsonResult<T> = { value: T; model: string; tokensIn: number | null; tokensOut: number | null };

type CompletionResponse = {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
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

// Sends the messages and returns the parsed, validated JSON answer
export async function chatJson<S extends z.ZodType>(
  settings: TokenFactorySettings,
  request: { name: string; schema: S; jsonSchema: object; messages: ChatMessage[]; maxTokens?: number },
): Promise<ChatJsonResult<z.infer<S>>> {
  const model = settings.model || DEFAULT_AI_MODEL;
  const response = await fetch(new URL("chat/completions", settings.baseUrl ?? TOKEN_FACTORY_BASE_URL), {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: request.messages,
      temperature: 0,
      max_tokens: request.maxTokens ?? 8000,
      response_format: { type: "json_schema", json_schema: { name: request.name, schema: request.jsonSchema } },
    }),
  });
  if (!response.ok) throw new Error(`Token Factory ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as CompletionResponse;
  return {
    value: parseContent(body, request.schema),
    model: body.model ?? model,
    tokensIn: body.usage?.prompt_tokens ?? null,
    tokensOut: body.usage?.completion_tokens ?? null,
  };
}

// Pulls the message text out of the completion and validates it against the schema
function parseContent<S extends z.ZodType>(body: CompletionResponse, schema: S): z.infer<S> {
  const choice = body.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new Error(`The model returned no answer (finish reason: ${choice?.finish_reason ?? "unknown"}).`);
  const parsed = schema.safeParse(JSON.parse(content));
  if (!parsed.success) throw new Error(`The model's answer did not match the expected shape: ${parsed.error.message}`);
  return parsed.data;
}
