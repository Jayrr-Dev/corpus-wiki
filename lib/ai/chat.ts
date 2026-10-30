import { processingMetric } from "@/lib/processing/metrics";
import { withRequestSlot } from "@/lib/processing/requests";
import { setTimeout as delay } from "node:timers/promises";
import "server-only";
import { AiInactivityError, withAiActivity } from "./inactivityTimeout";
import { backupCandidates, isProviderFailure, providerOf, rankedBackups, type BackupCandidate } from "./backupModels";
import {
  OPENROUTER_BASE_URL,
  isOpenRouterModel,
  openRouterModelId,
} from "./openrouterConfig";

import type { DbRpc } from "@/lib/db/rpc";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import { processingCancellation } from "@/lib/processing/cancellation";
import type { z } from "zod";
import { isAnthropicModel, requestClaudeCompletion } from "./anthropic";
import {
  type AiCallLogger,
  type AiCallStatus,
  type CompletionUsage,
  logSafely,
  usageTokens,
} from "./callLog";
import {
  CEREBRAS_BASE_URL,
  CEREBRAS_MODEL_PREFIX,
  DEFAULT_AI_MODEL,
  ROLE_DEFAULT_MODELS,
  TOKEN_FACTORY_BASE_URL,
} from "./config";
import { isNemotron3 } from "./effortSupport";
import { memoryNotes, openRoleMemory } from "./memory";
import { CONCISE_OUTPUT_INSTRUCTIONS } from "./outputStyle";
import { roleForPurpose } from "./roles";
import type { RoleInstruction, StageSkills } from "./skills/types";
import type { UsageGate } from "@/lib/billing/gate";
import { promptCharacters } from "@/lib/billing/credits";

// =====================================================================
// TOKEN FACTORY CHAT CALL: one OpenAI-compatible chat completion that must
// answer with JSON matching a zod schema. The schema is sent as
// `response_format: json_schema`, so the server constrains the output,
// and the reply is parsed again here, so a bad answer can never pass.
// Shared by reconciliation (lib/ai) and section writing (lib/living-page).
// =====================================================================

// `logCall` records every attempt's token usage (the app's server deps set it);
// `skills` are the instructions assigned to each AI stage on /skills
// `roleRoutes` sends a role's calls (roleForPurpose of the call name) to the model picked for it on /settings;
// `memoryDb` gives each role its memory (lib/ai/memory.ts); `effort` is the default reasoning effort picked on /settings,
// and `roleEfforts` a role's own effort that replaces it for that role's calls
export type TokenFactorySettings = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  contextWindowTokens?: number;
  skills?: StageSkills;
  roleInstructions?: RoleInstruction[];
  logCall?: AiCallLogger;
  roleRoutes?: Record<string, ModelRoute>;
  memoryDb?: DbRpc;
  effort?: ReasoningEffort;
  roleEfforts?: Record<string, ReasoningEffort>;
  // Meters credits before each call (lib/billing/gate.ts); it only blocks while the monetization switch is on
  usageGate?: UsageGate;
  // Models on other providers a JSON call moves to when its provider fails, ranked per role (lib/ai/backupModels.ts)
  backups?: BackupCandidate[];
};

// WHERE ONE MODEL'S CALLS GO: the provider key, the model id and (for Cerebras) the endpoint
export type ModelRoute = { apiKey: string; model: string; baseUrl?: string };

// THE MODEL PICKS ON /settings: the workspace model, plus a model per role that replaces it for that role's calls
// (`db`, when set, is where the roles' memory lives; `effort`, when set, is the default reasoning effort; `roleEfforts` a role's own effort)
export type ModelChoice = {
  model: string | null;
  roleModels: Record<string, string>;
  db?: DbRpc;
  effort?: ReasoningEffort | null;
  roleEfforts?: Record<string, ReasoningEffort>;
  // Latest AI Speed test per model (tokens per second), for ranking backup models
  speeds?: Record<string, number | null>;
};

export type ChatMessage = { role: "system" | "user"; content: string };

// A USER MESSAGE WITH A PICTURE: text plus an image as a data URL (vision models only)
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export type ChatMediaMessage = { role: "user"; content: ChatContentPart[] };

export type TokenUsage = { tokensIn: number | null; tokensOut: number | null };

export type ChatJsonResult<T> = TokenUsage & { value: T; model: string };

// Totals usage across several calls; one call without usage makes the total unknown (null)
export function addUsage(total: TokenUsage, call: TokenUsage): TokenUsage {
  return {
    tokensIn:
      total.tokensIn === null || call.tokensIn === null
        ? null
        : total.tokensIn + call.tokensIn,
    tokensOut:
      total.tokensOut === null || call.tokensOut === null
        ? null
        : total.tokensOut + call.tokensOut,
  };
}

// REASONING EFFORTS, tried in order. Reasoning models think before they answer, and the
// thinking counts against max_tokens. On a 169-passage PDF, GLM-5.3-Flash at its default
// effort thought through 8,000, then 32,000 tokens and never wrote the JSON. Measured on that PDF:
//   GLM-5.3-Flash  low: 19 actions in 14 s   medium: 64 actions in 134 s, or cut off after 160 s
//   Nemotron Super low:  4 actions in 3 s    medium: 26 actions in 18 s
// "medium" reads the whole file when it finishes; when it runs out of room, "low" still answers.
// A call starts at its stage's effort, else the default picked on /settings, else medium,
// and steps down from there; "high" is only ever a starting point someone picked.
export const REASONING_EFFORTS = ["high", "medium", "low"] as const;
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

// AN ANSWER CUT OFF BY THE TOKEN BUDGET: the one failure a lower reasoning effort can fix
export class AnswerCutOffError extends Error {}

export class InvalidStructuredAnswerError extends Error {
  constructor(
    readonly details: string,
    readonly tokensIn: number | null,
    readonly tokensOut: number | null,
  ) {
    super(
      "The AI returned invalid claim fields. Retry processing; no knowledge from this answer was saved.",
    );
    this.name = "InvalidStructuredAnswerError";
  }
}

// A truncated response must never be accepted, even if its JSON happens to parse. Carries
// the usage so a caller that splits its input (reconciliation batches) can still count it.
export class CompletionLengthError extends AnswerCutOffError {
  constructor(
    readonly tokensIn: number | null,
    readonly tokensOut: number | null,
    readonly model?: string,
    readonly maxTokens?: number,
  ) {
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

// THE PROVIDER NEVER ANSWERED: a caller that can shrink its input (reconciliation batches) retries smaller
export class ProviderTimeoutError extends Error {
  constructor() {
    super(
      "The AI provider did not respond within three minutes. Retry processing the upload.",
    );
    this.name = "ProviderTimeoutError";
  }
}

export type CompletionResponse = {
  model?: string;
  choices?: {
    message?: {
      content?: string | null;
      refusal?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }[];
  usage?: CompletionUsage;
};

// OPTIONAL TOOLS a call offers the model (like a harness): it may call them before it answers,
// or not at all. `parameters` is a JSON schema; `run` gets the parsed arguments and returns JSON.
export type ChatTool = {
  name: string;
  description: string;
  parameters: object;
  run: (args: unknown) => Promise<unknown>;
};
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// At most this many rounds of tool calls; the round after must answer
export const MAX_TOOL_ROUNDS = 4;

// Runs the model's tool calls; a failing or unknown tool answers with its error, so the model can go on
export async function runToolCalls(
  tools: ChatTool[],
  calls: { id: string; name: string; arguments: string }[],
): Promise<{ id: string; content: string }[]> {
  return Promise.all(
    calls.map(async (call) => {
      const tool = tools.find((item) => item.name === call.name);
      let result: unknown;
      try {
        if (!tool) throw new Error(`There is no tool named ${call.name}.`);
        result = await tool.run(
          call.arguments.trim() ? JSON.parse(call.arguments) : {},
        );
      } catch (error) {
        result = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
      return {
        id: call.id,
        content: JSON.stringify(result ?? null).slice(0, 20_000),
      };
    }),
  );
}

// Adds one round's token usage to the running total (a round without usage counts as zero)
export function addCompletionUsage(
  total: CompletionUsage | undefined,
  round: CompletionUsage | undefined,
): CompletionUsage | undefined {
  if (!round) return total;
  if (!total) return round;
  return {
    prompt_tokens: (total.prompt_tokens ?? 0) + (round.prompt_tokens ?? 0),
    completion_tokens:
      (total.completion_tokens ?? 0) + (round.completion_tokens ?? 0),
    reasoning_tokens:
      (total.completion_tokens_details?.reasoning_tokens ??
        total.reasoning_tokens ??
        0) +
      (round.completion_tokens_details?.reasoning_tokens ??
        round.reasoning_tokens ??
        0),
    // Keep individual requests: a context price tier applies per round, never
    // to the combined prompt count of a conversation's tool calls.
    billing_rounds: [
      ...(total.billing_rounds ?? [total]),
      ...(round.billing_rounds ?? [round]),
    ],
  };
}

// The Nemotron-first role defaults, which fill in only when nothing is picked: no workspace model
// on /settings and no AI_MODEL (they need Token Factory). A role's own pick still wins over them.
export function roleDefaultModels(
  chosenModel: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return !chosenModel && !env.AI_MODEL && env.NEBIUS_API_KEY ? ROLE_DEFAULT_MODELS : {};
}

// The model AI calls use: the one picked on /settings, else AI_MODEL, else the Nemotron default
export function resolveModel(
  chosenModel: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    chosenModel ||
    env.AI_MODEL ||
    (!env.NEBIUS_API_KEY && env.OPENROUTER_API_KEY
      ? "openrouter/openai/gpt-oss-120b"
      : DEFAULT_AI_MODEL)
  );
}

// True for a "cerebras/<id>" pick, which runs on Cerebras instead of Token Factory
export const isCerebrasModel = (model: string) =>
  model.startsWith(CEREBRAS_MODEL_PREFIX);

// Reads the AI settings from server env (+ the picked models and the usage logger); null when there is
// no NEBIUS_API_KEY. A Cerebras pick swaps in CEREBRAS_API_KEY and the Cerebras endpoint;
// a Claude ("anthropic/<id>") pick swaps in ANTHROPIC_API_KEY. A role's own model is routed the same way.
export function tokenFactoryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  chosen: string | null | ModelChoice = null,
  logCall?: AiCallLogger,
): TokenFactorySettings | null {
  if (
    !env.NEBIUS_API_KEY &&
    !env.OPENROUTER_API_KEY &&
    !env.ANTHROPIC_API_KEY &&
    !env.CEREBRAS_API_KEY
  )
    return null;
  const choice =
    typeof chosen === "object" && chosen !== null
      ? chosen
      : { model: chosen, roleModels: {} };
  const roles = Object.entries({ ...roleDefaultModels(choice.model, env), ...choice.roleModels }).filter(([, model]) => model);
  const roleRoutes = roles.length
    ? Object.fromEntries(
        roles.map(([role, model]) => [role, routeModel(env, model)]),
      )
    : undefined;
  const memoryDb = "db" in choice ? choice.db : undefined;
  const effort = "effort" in choice ? choice.effort : undefined;
  const roleEfforts =
    "roleEfforts" in choice &&
    choice.roleEfforts &&
    Object.keys(choice.roleEfforts).length
      ? choice.roleEfforts
      : undefined;
  const backups = backupCandidates(env, "speeds" in choice ? choice.speeds : undefined);
  return {
    ...routeModel(env, resolveModel(choice.model, env)),
    logCall,
    ...(backups.length ? { backups } : {}),
    ...(roleRoutes ? { roleRoutes } : {}),
    ...(memoryDb ? { memoryDb } : {}),
    ...(effort ? { effort } : {}),
    ...(roleEfforts ? { roleEfforts } : {}),
  };
}

export function routeModel(env: NodeJS.ProcessEnv, model: string): ModelRoute {
  if (isOpenRouterModel(model)) {
    if (!env.OPENROUTER_API_KEY)
      throw new Error(
        `${model} is picked in Settings, but OPENROUTER_API_KEY is not set in the server env.`,
      );
    return {
      apiKey: env.OPENROUTER_API_KEY,
      model,
      baseUrl: OPENROUTER_BASE_URL,
    };
  }
  if (isAnthropicModel(model)) {
    if (!env.ANTHROPIC_API_KEY)
      throw new Error(
        `${model} is picked in Settings, but ANTHROPIC_API_KEY is not set in the server env.`,
      );
    return { apiKey: env.ANTHROPIC_API_KEY, model };
  }
  if (!isCerebrasModel(model)) {
    if (!env.NEBIUS_API_KEY)
      throw new Error(
        `${model} needs NEBIUS_API_KEY. Choose a connected provider's model in Settings.`,
      );
    return { apiKey: env.NEBIUS_API_KEY, model };
  }
  if (!env.CEREBRAS_API_KEY)
    throw new Error(
      `${model} is picked in Settings, but CEREBRAS_API_KEY is not set in the server env.`,
    );
  return { apiKey: env.CEREBRAS_API_KEY, model, baseUrl: CEREBRAS_BASE_URL };
}

// The settings one call runs with: its role's own model and effort when picked, else the workspace ones
export function settingsForCall(
  settings: TokenFactorySettings,
  name: string,
): TokenFactorySettings {
  const role =
    settings.roleRoutes || settings.roleEfforts ? roleForPurpose(name) : null;
  const route = role ? settings.roleRoutes?.[role] : undefined;
  const effort = role ? settings.roleEfforts?.[role] : undefined;
  if (!route && !effort) return settings;
  return {
    ...settings,
    ...(route
      ? { apiKey: route.apiKey, model: route.model, baseUrl: route.baseUrl }
      : {}),
    ...(effort ? { effort } : {}),
  };
}

// `subject` names what the call is about (a file title, a section) for the usage log
type ChatJsonRequest<S extends z.ZodType> = {
  // Extraction may regenerate one invalid draft, before any changes are committed.
  retryInvalidOutput?: boolean;
  signal?: AbortSignal;
  name: string;
  subject?: string;
  schema: S;
  jsonSchema: object;
  messages: (ChatMessage | ChatMediaMessage)[];
  maxTokens?: number;
  // Stage-specific starting effort (wins over the /settings default); low has no lower-effort retry on truncation.
  reasoningEffort?: ReasoningEffort;
  // Article prose keeps its dedicated encyclopedic writing policy.
  outputStyle?: "concise" | "wiki_article" | "chat";
  // Tools the model may call before it answers (the role's memory, for one)
  tools?: ChatTool[];
  // When set, the answer is streamed and this hears the text so far (and any visible thinking)
  // after each chunk. A retry at a lower effort starts again from empty text.
  onStream?: (partial: StreamedSoFar) => void;
};

export type StreamedSoFar = { content: string; reasoning: string };

export { isNemotron3 } from "./effortSupport";

// Sends the messages and returns the parsed, validated JSON answer. An answer cut off by
// the token budget is asked again at the next lower reasoning effort (for models that
// reason; for the rest a retry would only repeat the cut-off); other errors stop at once.
// A call with a role sees that role's notes in its system message (lib/ai/memory.ts), so it stays one request
export async function chatJson<S extends z.ZodType>(
  workspace: TokenFactorySettings,
  request: ChatJsonRequest<S>,
): Promise<ChatJsonResult<z.infer<S>>> {
  const settings = settingsForCall(workspace, request.name);
  const memory = await openRoleMemory(settings.memoryDb, request.name);
  const notes = memory ? memoryNotes(memory) : null;
  const call = notes
    ? { ...request, messages: [{ role: "system" as const, content: notes }, ...request.messages] }
    : request;
  try {
    return await chatJsonAnswer(settings, call);
  } catch (error) {
    if (!isProviderFailure(error) || request.signal?.aborted) throw error;
    // The provider failed, not the request: the same call goes to a backup on another provider
    const own = providerOf(settings.model ?? DEFAULT_AI_MODEL);
    for (const model of rankedBackups(settings.backups ?? [], roleForPurpose(request.name))) {
      if (providerOf(model) === own) continue;
      let route: ModelRoute;
      try { route = routeModel(process.env, model); } catch { continue; }
      console.warn(`${request.name}: ${error instanceof Error ? error.message.slice(0, 120) : error}; trying backup ${model}`);
      processingMetric("provider.backup");
      try {
        return await chatJsonAnswer({ ...settings, apiKey: route.apiKey, model: route.model, baseUrl: route.baseUrl }, call);
      } catch (backupError) {
        if (!isProviderFailure(backupError)) throw backupError;
      }
    }
    // A stream that sent nothing for a minute (usually an overloaded provider) saved nothing, so
    // with no backup left it is asked once more; a second stall stops the call
    if (!(error instanceof AiInactivityError)) throw error;
    processingMetric("provider.stall");
    return chatJsonAnswer(settings, call);
  }
}

async function chatJsonAnswer<S extends z.ZodType>(
  settings: TokenFactorySettings,
  request: ChatJsonRequest<S>,
): Promise<ChatJsonResult<z.infer<S>>> {
  const start =
    request.reasoningEffort ?? settings.effort ?? DEFAULT_REASONING_EFFORT;
  const startingEfforts = REASONING_EFFORTS.slice(
    REASONING_EFFORTS.indexOf(start),
  );
  const efforts = isNemotron3(settings.model || DEFAULT_AI_MODEL)
    ? startingEfforts.slice(0, 1)
    : startingEfforts;
  let cutOff: AnswerCutOffError | null = null;
  let invalid: InvalidStructuredAnswerError | null = null;
  for (const effort of efforts) {
    try {
      let answer: ChatJsonResult<z.infer<S>>;
      try {
        answer = await chatJsonOnce(settings, request, effort);
      } catch (error) {
        if (
          !(error instanceof InvalidStructuredAnswerError) ||
          !request.retryInvalidOutput ||
          invalid ||
          request.tools?.length
        )
          throw error;
        invalid = error;
        request = {
          ...request,
          messages: [
            ...request.messages,
            {
              role: "user",
              content: `Your previous answer failed schema validation. Generate the complete answer again from the original evidence. Use only the exact enum values in the schema; do not invent or translate them. Validation errors: ${error.details}`,
            },
          ],
        };
        answer = await chatJsonOnce(settings, request, effort);
      }
      return invalid ? { ...answer, ...addUsage(answer, invalid) } : answer;
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
  // THE USAGE GATE: reserves this attempt's credits first; throws UsageLimitError only when enforcing
  const reservation = settings.usageGate
    ? await settings.usageGate.reserve({ purpose: request.name, model, maxTokens, promptChars: promptCharacters(request.messages) })
    : null;
  const startedAt = Date.now();
  let body: CompletionResponse | undefined;
  const log = async (status: AiCallStatus, error: string | null) => {
    const tokens = usageTokens(body?.usage);
    const credits = reservation
      ? await reservation.settle({ model: body?.model ?? model, prompt_tokens: tokens.promptTokens, completion_tokens: tokens.completionTokens, usage_details: tokens.usageDetails })
      : undefined;
    await logSafely(settings.logCall, {
      purpose: request.name,
      subject: request.subject ?? null,
      model: body?.model ?? model,
      reasoningEffort: effort,
      ...tokens,
      ...(credits !== undefined ? { credits } : {}),
      durationMs: Date.now() - startedAt,
      status,
      error,
    });
  };
  try {
    body = await requestCompletion(settings, request, model, maxTokens, effort);
    const value = parseContent(body, request.schema, maxTokens);
    await log("ok", null);
    return {
      value,
      model: body.model ?? model,
      tokensIn: body.usage?.prompt_tokens ?? null,
      tokensOut: body.usage?.completion_tokens ?? null,
    };
  } catch (error) {
    await log(
      error instanceof AnswerCutOffError ? "cut_off" : "error",
      error instanceof InvalidStructuredAnswerError
        ? `${error.message} ${error.details}`
        : error instanceof Error
          ? error.message
          : String(error),
    );
    throw error;
  }
}

// Per-model request fields: Nemotron 3 otherwise spends its whole budget on hidden reasoning,
// so its thinking is off; GLM-5.3-Flash only honours the effort through its chat template
export function reasoningFields(
  model: string,
  effort: ReasoningEffort,
): Record<string, unknown> {
  if (isNemotron3(model))
    return { chat_template_kwargs: { enable_thinking: false } };
  if (/^zai-org\/glm-5\.3-flash$/i.test(model))
    return {
      reasoning_effort: effort,
      chat_template_kwargs: { reasoning_effort: effort },
    };
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
  const cerebras = isCerebrasModel(model);
  const messages: (ChatMessage | ChatMediaMessage)[] = [
    {
      role: "system",
      content: `Return only JSON matching this schema: ${JSON.stringify(request.jsonSchema)}`,
    },
    ...(request.outputStyle === "wiki_article" || request.outputStyle === "chat"
      ? []
      : [{ role: "system" as const, content: CONCISE_OUTPUT_INSTRUCTIONS }]),
    ...request.messages,
  ];
  // A cancel or lost lease aborts the call: the request's own signal, an upload run, or a suggestion apply
  const signals = [
    request.signal,
    uploadExecution.getStore()?.signal,
    processingCancellation.getStore(),
  ].filter((item): item is AbortSignal => !!item);
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  if (isAnthropicModel(model)) {
    return requestClaudeCompletion({
      apiKey: settings.apiKey,
      model,
      messages,
      jsonSchema: request.jsonSchema,
      maxTokens,
      effort,
      signal,
      onStream: request.onStream,
      tools: request.tools,
    });
  }
  const provider = isOpenRouterModel(model)
    ? "OpenRouter"
    : cerebras
      ? "Cerebras"
      : "Token Factory";
  let tools = request.tools?.length ? request.tools : undefined;
  let conversation: WireMessage[] = cerebras
    ? oneLeadingSystemMessage(messages)
    : messages;
  let usage: CompletionUsage | undefined;
  // A strict json_schema response format stops Token Factory models from ever calling a tool
  // (measured on GLM-5.3-Flash: same request, tool call only without it). So a round that offers
  // tools runs unconstrained, with the schema in the system message; an answer that misses the
  // schema is asked once more with the format on and the tools closed.
  const post = (toolChoice: "auto" | "none" | null, requestSignal = signal) =>
    postCompletion(
      new URL("chat/completions", settings.baseUrl ?? TOKEN_FACTORY_BASE_URL),
      {
        method: "POST",
        signal: requestSignal,
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // Cerebras knows its models without the "cerebras/" prefix the picker adds
          model: isOpenRouterModel(model)
            ? openRouterModelId(model)
            : cerebras
              ? model.slice(CEREBRAS_MODEL_PREFIX.length)
              : model,
          messages: conversation,
          temperature: 0,
          ...(isOpenRouterModel(model)
            ? { reasoning: { effort } }
            : reasoningFields(model, effort)),
          max_tokens: maxTokens,
          ...(toolChoice === "auto"
            ? {}
            : {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: request.name,
                    schema: request.jsonSchema,
                    strict: true,
                  },
                },
              }),
          ...(tools && toolChoice
            ? {
                tools: tools.map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
                tool_choice: toolChoice,
              }
            : {}),
          // Cerebras sends usage in its last chunk unasked and does not document stream_options
          ...(request.onStream
            ? {
                stream: true,
                ...(cerebras
                  ? {}
                  : { stream_options: { include_usage: true } }),
              }
            : {}),
        }),
      },
    );
  let toolRounds = 0;
  let toolsClosed = false;
  for (;;) {
    let offering = !!tools && !toolsClosed && toolRounds < MAX_TOOL_ROUNDS;
    // Once tools were used they stay listed (the history refers to them) but cannot be called
    const toolChoice = offering
      ? "auto"
      : tools && toolRounds > 0
        ? "none"
        : null;
    const body = await withRequestSlot(
      "chat",
      new URL(settings.baseUrl ?? TOKEN_FACTORY_BASE_URL).host,
      settings.apiKey,
      (slotSignal) =>
        withAiActivity(async (requestSignal, activity) => {
          let response = await post(toolChoice, requestSignal);
          // A model or provider without tool calling answers without the tools instead of failing the call
          if (
            !response.ok &&
            offering &&
            toolRounds === 0 &&
            (response.status === 400 || response.status === 422)
          ) {
            console.warn(
              `${provider} rejected tools for ${model}; answering without them: ${(await response.text()).slice(0, 200)}`,
            );
            tools = undefined;
            offering = false;
            response = await post(null, requestSignal);
          }
          if (!response.ok)
            throw new Error(
              `${provider} ${response.status}: ${(await response.text()).slice(0, 300)}`,
            );
          return request.onStream
            ? await readCompletionStream(response, request.onStream, activity)
            : ((await response.json()) as CompletionResponse);
        }, slotSignal),
      signal,
    );
    usage = addCompletionUsage(usage, body.usage);
    const choice = body.choices?.[0];
    const calls = choice?.message?.tool_calls ?? [];
    if (offering && tools && calls.length > 0) {
      const results = await runToolCalls(
        tools,
        calls.map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        })),
      );
      conversation = [
        ...conversation,
        {
          role: "assistant",
          content: choice?.message?.content ?? null,
          tool_calls: calls,
        },
        ...results.map((result) => ({
          role: "tool" as const,
          tool_call_id: result.id,
          content: result.content,
        })),
      ];
      toolRounds++;
      continue;
    }
    // An unconstrained answer that misses the schema gets one constrained retry; a cut-off goes
    // to the caller as usual (a lower reasoning effort, not the format, is what fixes that)
    if (
      offering &&
      choice?.finish_reason !== "length" &&
      !matchesSchema(choice?.message?.content, request.schema)
    ) {
      toolsClosed = true;
      continue;
    }
    // Logs and traces keep the prefixed id, so a Cerebras call never reads as the Token Factory model of the same name
    return {
      ...body,
      usage,
      ...(cerebras || isOpenRouterModel(model) ? { model } : {}),
    };
  }
}

// True when the text is JSON that the schema accepts
function matchesSchema(
  content: string | null | undefined,
  schema: z.ZodType,
): boolean {
  try {
    return !!content?.trim() && schema.safeParse(JSON.parse(content)).success;
  } catch {
    return false;
  }
}

// What travels to an OpenAI-compatible provider: the call's messages, then any tool rounds
type WireMessage =
  | ChatMessage
  | ChatMediaMessage
  | { role: "assistant"; content: string | null; tool_calls: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

// Qwen on Cerebras refuses a second system message ("System message must be at the beginning"),
// so every system message joins one at the start, in order; the rest keep their order
export function oneLeadingSystemMessage(
  messages: (ChatMessage | ChatMediaMessage)[],
): (ChatMessage | ChatMediaMessage)[] {
  const system = messages.flatMap((message) =>
    message.role === "system" ? [message.content] : [],
  );
  const rest = messages.filter((message) => message.role !== "system");
  return system.length
    ? [{ role: "system", content: system.join("\n\n") }, ...rest]
    : rest;
}

type StreamChunk = {
  model?: string;
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      reasoning_details?: { text?: string; summary?: string }[];
      refusal?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: CompletionUsage | null;
};

// OpenRouter streams thinking as reasoning_details. A non-string reasoning field is ignored
// so it cannot be concatenated into the answer text.
function streamedThought(
  delta: NonNullable<NonNullable<StreamChunk["choices"]>[number]["delta"]>,
): string {
  const direct = [delta.reasoning_content, delta.reasoning]
    .filter((part): part is string => typeof part === "string")
    .join("");
  const details = (delta.reasoning_details ?? [])
    .map((detail) => detail.text ?? detail.summary ?? "")
    .join("");
  return direct + details;
}

// STREAMED ANSWER: reads the server-sent events into the same shape a plain completion has,
// so parseContent checks a streamed answer exactly like any other
export async function readCompletionStream(
  response: Response,
  onStream: (partial: StreamedSoFar) => void,
  activity?: () => void,
): Promise<CompletionResponse> {
  if (!response.body) throw new Error("The AI provider sent an empty stream.");
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffered = "";
  let content = "";
  let reasoning = "";
  let refusal = "";
  let finishReason: string | undefined;
  let model: string | undefined;
  let usage: CompletionUsage | undefined;
  // Tool calls arrive in pieces: the id and name first, then the arguments a few characters at a time
  const toolCalls: ToolCall[] = [];
  const take = (line: string) => {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data) as StreamChunk;
    model ??= chunk.model;
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) return;
    const thought = streamedThought(delta);
    if (delta.content || thought || delta.refusal || delta.tool_calls?.length)
      activity?.();
    refusal += delta.refusal ?? "";
    for (const piece of delta.tool_calls ?? []) {
      const call = (toolCalls[piece.index] ??= {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      });
      if (piece.id) call.id = piece.id;
      call.function.name += piece.function?.name ?? "";
      call.function.arguments += piece.function?.arguments ?? "";
    }
    if (!delta.content && !thought) return;
    content += delta.content ?? "";
    reasoning += thought;
    onStream({ content, reasoning });
  };
  for (;;) {
    const { done, value } = await reader.read();
    // Any bytes count, including OpenRouter's ": OPENROUTER PROCESSING" comments.
    // Those arrive while Mercury is still working and are not content deltas.
    if (value?.byteLength) activity?.();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split("\n").map((line) => line.replace(/\r$/, ""));
    buffered = done ? "" : (lines.pop() ?? "");
    for (const line of lines) take(line);
    if (done) break;
  }
  const calls = toolCalls.filter(Boolean);
  return {
    model,
    usage,
    choices: [
      {
        message: {
          content,
          refusal: refusal || null,
          ...(calls.length ? { tool_calls: calls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
  };
}

// Pulls the message text out of the completion and validates it against the schema.
// Each way an answer can be unusable gets its own message, so the Upload screen says what happened.
export function parseContent<S extends z.ZodType>(
  body: CompletionResponse,
  schema: S,
  maxTokens?: number,
): z.infer<S> {
  const choice = body.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new CompletionLengthError(
      body.usage?.prompt_tokens ?? null,
      body.usage?.completion_tokens ?? null,
      body.model,
      maxTokens,
    );
  }
  if (choice?.message?.refusal)
    throw new Error(
      `${body.model ?? "The model"} declined the request: ${choice.message.refusal}`,
    );
  const content = choice?.message?.content?.trim();
  if (!content)
    throw new Error(
      `The model returned no answer (finish reason: ${choice?.finish_reason ?? "unknown"}).`,
    );
  const parsed = schema.safeParse(parseJson(content));
  if (!parsed.success)
    throw new InvalidStructuredAnswerError(
      parsed.error.message,
      body.usage?.prompt_tokens ?? null,
      body.usage?.completion_tokens ?? null,
    );
  return parsed.data;
}

// JSON.parse with a message a person can act on instead of "Unexpected end of JSON input"
function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(
      `The model's answer was not valid JSON (it ends with: "${content.slice(-80)}").`,
    );
  }
}

// THROTTLING: Cerebras limits tokens per minute (150K), so a page review's parallel parts can
// trip it for up to a minute; earlier retries after 1s and 2s always failed again.
// Token Factory answers 529 "worker overloaded" when it is busy: waited out the same way.
const THROTTLE_RETRIES = 4;
const THROTTLE_BACKOFF_S = [5, 15, 30, 60];
const MAX_THROTTLE_WAIT_S = 60;

// Seconds to wait before retrying a 429: Retry-After (Nebius), else the provider's per-minute
// reset (x-ratelimit-reset-*-minute), else a backoff long enough to cross a minute window
export function throttleWaitSeconds(headers: Headers, attempt: number): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    return Number.isFinite(seconds)
      ? seconds
      : Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000);
  }
  const resets = [
    "x-ratelimit-reset-tokens-minute",
    "x-ratelimit-reset-requests-minute",
  ]
    .map((name) => Number.parseFloat(headers.get(name) ?? ""))
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);
  return resets.length
    ? Math.ceil(Math.max(...resets))
    : THROTTLE_BACKOFF_S[Math.min(attempt, THROTTLE_BACKOFF_S.length - 1)]!;
}

// Never retry malformed requests, authentication failures, truncation or validation failures at this layer.
async function postCompletion(url: URL, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: init.signal
          ? AbortSignal.any([
              init.signal,
              AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ProviderTimeoutError();
      }
      throw error;
    }
    const throttled = response.status === 429 || response.status === 529;
    if (
      (!throttled && ![502, 503, 504].includes(response.status)) ||
      attempt >= (throttled ? THROTTLE_RETRIES : 2)
    )
      return response;
    const seconds = throttled
      ? throttleWaitSeconds(response.headers, attempt)
      : 0.25 * 2 ** attempt;
    // Longer or unsupported delays are reported instead of tying up a server action.
    if (
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      seconds > MAX_THROTTLE_WAIT_S
    )
      return response;
    await response.body?.cancel();
    processingMetric(throttled ? "provider.throttled" : "provider.retry");
    await delay(seconds * 1000, undefined, {
      signal: init.signal ?? undefined,
    });
  }
}
