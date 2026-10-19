import "server-only";
import { withAiActivity } from "./inactivityTimeout";
import { withRequestSlot } from "@/lib/processing/requests";
import { processingMetric } from "@/lib/processing/metrics";

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { ChatContentPart, ChatMediaMessage, ChatMessage, ChatTool, CompletionResponse, ReasoningEffort, StreamedSoFar } from "./chat";
import type { CompletionUsage } from "./callLog";
import { addCompletionUsage, MAX_TOOL_ROUNDS, ProviderTimeoutError, runToolCalls } from "./chat";
import { ANTHROPIC_MODEL_PREFIX } from "./config";
import type { OfferedModel } from "./modelInputs";

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
  effort: ReasoningEffort;
  signal?: AbortSignal;
  onStream?: (partial: StreamedSoFar) => void;
  // Optional tools Claude may call before it answers; their results go back as tool_result blocks
  tools?: ChatTool[];
};

// ONE CLAUDE CALL constrained to the JSON schema (structured outputs). Always streamed, so a
// 32k-token budget never trips the SDK's long-request guard; onStream hears it when set.
// Thinking is adaptive (Claude decides how much); the reasoning effort becomes output_config.effort.
export async function requestClaudeCompletion(request: ClaudeRequest): Promise<CompletionResponse> {
  const client = new Anthropic({ apiKey: request.apiKey, timeout: REQUEST_TIMEOUT_MS });
  // The SDK moves unsupported constraints into descriptions; parseContent still
  // validates the answer against the original Zod schema.
  const transformedFormat = jsonSchemaOutputFormat(request.jsonSchema as { type: "object" });
  // Keep the provider's schema transformation, but leave parsing to parseContent.
  // The SDK's helper parser runs before we can inspect max_tokens and throws on
  // truncated JSON, bypassing our normal cut-off retry and losing usage details.
  // The installed SDK also moves enum/const into descriptions, although Claude
  // supports these constraints. Restore them so invalid claim classifications
  // are prevented at generation time rather than paying for a full retry.
  const format = { type: transformedFormat.type, schema: restoreValueConstraints(request.jsonSchema, transformedFormat.schema) };
  const system = request.messages.flatMap((message) => (message.role === "system" ? [message.content] : [])).join("\n\n");
  const messages: Anthropic.MessageParam[] = request.messages.flatMap((message) => (message.role === "user" ? [toClaudeMessage(message)] : []));
  let tools = request.tools?.length ? request.tools : undefined;
  let usage: CompletionUsage | undefined;
  let reasoning = "";
  const send = (round: number) => withRequestSlot("chat", "api.anthropic.com", request.apiKey, (slotSignal) => withAiActivity(async (signal, activity) => {
    // Each round streams a fresh answer; the thinking so far stays visible
    let content = "";
    const stream = client.messages.stream(
      {
        model: request.model.slice(ANTHROPIC_MODEL_PREFIX.length),
        max_tokens: request.maxTokens,
        // Book batches share the same instructions and schema. Cache that stable
        // prefix, and a user message marked cache (shared filing context) after it;
        // source passages remain specific to each request.
        ...(system ? { system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }] } : {}),
        messages,
        // Summarized thinking only when someone is watching the stream
        thinking: request.onStream ? { type: "adaptive", display: "summarized" } : { type: "adaptive" },
        output_config: { effort: request.effort, format },
        // After the last tool round the tools stay listed (earlier rounds used them) but cannot be called
        ...(tools ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters as Anthropic.Tool.InputSchema })), tool_choice: round < MAX_TOOL_ROUNDS ? { type: "auto" as const } : { type: "none" as const } } : {}),
      },
      { signal },
    );
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_delta") activity();
    });
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
    return stream.finalMessage();
  }, slotSignal), request.signal);
  try {
    for (let round = 0; ; round++) {
      let message: Anthropic.Message;
      try {
        message = await send(round);
      } catch (error) {
        // A model without tool use answers without the tools instead of failing the call
        if (!(tools && round === 0 && error instanceof Anthropic.BadRequestError)) throw error;
        console.warn(`Claude rejected tools for ${request.model}; answering without them: ${error.message.slice(0, 200)}`);
        tools = undefined;
        message = await send(round);
      }
      const completion = toCompletion(message, request.model);
      usage = addCompletionUsage(usage, completion.usage);
      const calls = message.content.flatMap((block) => (block.type === "tool_use" ? [block] : []));
      if (!tools || message.stop_reason !== "tool_use" || calls.length === 0) return { ...completion, usage };
      const results = await runToolCalls(tools, calls.map((call) => ({ id: call.id, name: call.name, arguments: JSON.stringify(call.input ?? {}) })));
      // The assistant turn goes back whole (thinking blocks included), then one user turn with every result
      messages.push({ role: "assistant", content: message.content });
      messages.push({ role: "user", content: results.map((result) => ({ type: "tool_result" as const, tool_use_id: result.id, content: result.content })) });
    }
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderTimeoutError();
    if (error instanceof Anthropic.APIError && error.status !== undefined) throw new Error(`Claude ${error.status}: ${error.message.slice(0, 300)}`);
    throw error;
  }
}

function restoreValueConstraints(original: object, transformed: object): Record<string, unknown> {
  const source = original as Record<string, unknown>;
  const target = transformed as Record<string, unknown>;
  const primitive = (value: unknown) => value === null || ["string", "number", "boolean"].includes(typeof value);
  if (Array.isArray(source.enum) && source.enum.every(primitive)) target.enum = [...source.enum];
  if (Object.hasOwn(source, "const") && primitive(source.const)) target.const = source.const;
  for (const [key, value] of Object.entries(source)) {
    const output = target[key === "oneOf" ? "anyOf" : key];
    if (Array.isArray(value) && Array.isArray(output)) {
      value.forEach((child, index) => {
        if (child && typeof child === "object" && output[index] && typeof output[index] === "object") restoreValueConstraints(child, output[index]);
      });
    } else if (value && typeof value === "object" && output && typeof output === "object") {
      restoreValueConstraints(value, output);
    }
  }
  return target;
}

// A user message in Claude's shape: plain text, or text and pictures (data URLs become base64 images)
function toClaudeMessage(message: ChatMessage | ChatMediaMessage): Anthropic.MessageParam {
  if ("cache" in message && message.cache) return { role: "user", content: [{ type: "text", text: message.content, cache_control: { type: "ephemeral" } }] };
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
  processingMetric("ai.cache.read", 0, { tokensIn: usage.cache_read_input_tokens ?? 0 });
  processingMetric("ai.cache.write", 0, { tokensIn: usage.cache_creation_input_tokens ?? 0 });
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
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_creation: usage.cache_creation,
    },
  };
}

// Every Claude model this key can use that the app's calls work on: structured outputs and adaptive thinking
export async function listClaudeModels(apiKey: string): Promise<OfferedModel[]> {
  const client = new Anthropic({ apiKey });
  const models: OfferedModel[] = [];
  for await (const model of client.models.list()) {
    const capabilities = (model as { capabilities?: { structured_outputs?: { supported?: boolean }; thinking?: { types?: { adaptive?: { supported?: boolean } } }; image_input?: { supported?: boolean } } }).capabilities;
    if (capabilities?.structured_outputs?.supported === false || capabilities?.thinking?.types?.adaptive?.supported === false) continue;
    // Claude models read images unless the listing says otherwise
    models.push({ id: model.id, inputs: capabilities?.image_input?.supported === false ? ["text"] : ["text", "image"] });
  }
  return models;
}
