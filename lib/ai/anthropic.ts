import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { ChatContentPart, ChatMediaMessage, ChatMessage, CompletionResponse, StreamedSoFar } from "./chat";
import { ProviderTimeoutError } from "./chat";
import { ANTHROPIC_MODEL_PREFIX } from "./config";

// =====================================================================
// CLAUDE (Anthropic API, optional third provider). Its models show in the
// Settings picker as "anthropic/<id>"; picking one sends chat calls here with
// ANTHROPIC_API_KEY through the official SDK. The answer comes back in the same
// shape a Token Factory completion has, so parseContent checks it like any other.
// Embeddings stay on Token Factory (Anthropic offers none).
// =====================================================================

// HOW LONG ONE CALL MAY TAKE: the same three minutes as the OpenAI-compatible providers
const REQUEST_TIMEOUT_MS = 180_000;

// True for an "anthropic/<id>" pick, which runs on the Anthropic API
export const isAnthropicModel = (model: string) => model.startsWith(ANTHROPIC_MODEL_PREFIX);

type ClaudeRequest = {
  apiKey: string;
  model: string; // the prefixed pick
  messages: (ChatMessage | ChatMediaMessage)[];
  jsonSchema: object;
  maxTokens: number;
  effort: "low" | "medium";
  signal?: AbortSignal;
  onStream?: (partial: StreamedSoFar) => void;
};

// ONE CLAUDE CALL constrained to the JSON schema (structured outputs). Always streamed, so a
// 32k-token budget never trips the SDK's long-request guard; onStream hears it when set.
// Thinking is adaptive (Claude decides how much); the reasoning effort becomes output_config.effort.
export async function requestClaudeCompletion(request: ClaudeRequest): Promise<CompletionResponse> {
  const client = new Anthropic({ apiKey: request.apiKey, timeout: REQUEST_TIMEOUT_MS });
  const system = request.messages.flatMap((message) => (message.role === "system" ? [message.content] : [])).join("\n\n");
  let content = "";
  let reasoning = "";
  try {
    const stream = client.messages.stream(
      {
        model: request.model.slice(ANTHROPIC_MODEL_PREFIX.length),
        max_tokens: request.maxTokens,
        ...(system ? { system } : {}),
        messages: request.messages.flatMap((message) => (message.role === "user" ? [toClaudeMessage(message)] : [])),
        // Summarized thinking only when someone is watching the stream
        thinking: request.onStream ? { type: "adaptive", display: "summarized" } : { type: "adaptive" },
        output_config: { effort: request.effort, format: { type: "json_schema", schema: request.jsonSchema as Record<string, unknown> } },
      },
      { signal: request.signal },
    );
    if (request.onStream) {
      const onStream = request.onStream;
      stream.on("text", (delta) => {
        content += delta;
        onStream({ content, reasoning });
      });
      stream.on("thinking", (delta) => {
        reasoning += delta;
        onStream({ content, reasoning });
      });
    }
    return toCompletion(await stream.finalMessage(), request.model);
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderTimeoutError();
    if (error instanceof Anthropic.APIError && error.status !== undefined) throw new Error(`Claude ${error.status}: ${error.message.slice(0, 300)}`);
    throw error;
  }
}

// A user message in Claude's shape: plain text, or text and pictures (data URLs become base64 images)
function toClaudeMessage(message: ChatMessage | ChatMediaMessage): Anthropic.MessageParam {
  if (typeof message.content === "string") return { role: "user", content: message.content };
  return { role: "user", content: message.content.map(toClaudeBlock) };
}

function toClaudeBlock(part: ChatContentPart): Anthropic.TextBlockParam | Anthropic.ImageBlockParam {
  if (part.type === "text") return { type: "text", text: part.text };
  const dataUrl = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(part.image_url.url);
  if (dataUrl?.[1] && dataUrl[2]) return { type: "image", source: { type: "base64", media_type: dataUrl[1] as "image/png", data: dataUrl[2] } };
  return { type: "image", source: { type: "url", url: part.image_url.url } };
}

// Claude's reply as an OpenAI-style completion: a max_tokens stop reads as "length" (the cut-off
// retry), a refusal carries its explanation, and the logged model keeps the "anthropic/" prefix
function toCompletion(message: Anthropic.Message, pickedModel: string): CompletionResponse {
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  const usage = message.usage;
  return {
    model: pickedModel,
    choices: [
      {
        message: {
          content: text,
          refusal: message.stop_reason === "refusal" ? (message.stop_details?.explanation ?? "Claude declined the request.") : null,
        },
        finish_reason: message.stop_reason === "max_tokens" ? "length" : (message.stop_reason ?? undefined),
      },
    ],
    usage: {
      prompt_tokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      completion_tokens: usage.output_tokens,
    },
  };
}

// Every Claude model this key can use that the app's calls work on: structured outputs and adaptive thinking
export async function listClaudeModelIds(apiKey: string): Promise<string[]> {
  const client = new Anthropic({ apiKey });
  const ids: string[] = [];
  for await (const model of client.models.list()) {
    const capabilities = (model as { capabilities?: { structured_outputs?: { supported?: boolean }; thinking?: { types?: { adaptive?: { supported?: boolean } } } } }).capabilities;
    if (capabilities?.structured_outputs?.supported === false || capabilities?.thinking?.types?.adaptive?.supported === false) continue;
    ids.push(model.id);
  }
  return ids;
}
