import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { DbRpc } from "@/lib/db/rpc";
import { type AiCallLogger, type CompletionUsage, logSafely, usageTokens } from "./callLog";
import { isAnthropicModel } from "./anthropic";
import { isCerebrasModel, isNemotron3, type ReasoningEffort, reasoningFields, routeModel } from "./chat";
import { ANTHROPIC_MODEL_PREFIX, CEREBRAS_MODEL_PREFIX, TOKEN_FACTORY_BASE_URL } from "./config";

// =====================================================================
// AI SPEED TEST: one short streamed completion per model, timed on the
// server. Latency is the wait for the first token (thinking counts);
// speed is output tokens per second after that first token arrives.
// Shown on /settings (AI Speed); each run is logged like any AI call and
// stored in public.ai_speed_tests, so the table keeps its latest numbers.
// =====================================================================

// THE TEST PROMPT: plain prose of a fixed size, so runs compare fairly
const SPEED_TEST_PROMPT =
  "Write one paragraph of about 150 words explaining how a public library organizes its books so readers can find them. Plain prose, no lists or headings.";
// Room for some thinking at medium effort before the paragraph
const SPEED_TEST_MAX_TOKENS = 2_000;
const SPEED_TEST_TIMEOUT_MS = 60_000;

export type SpeedTestResult = {
  model: string;
  // the reasoning effort the run used; "off" for models whose thinking the app turns off (Nemotron 3)
  effort: ReasoningEffort | "off";
  latencyMs: number; // request sent → first token
  totalMs: number; // request sent → last token
  tokensOut: number;
  tokensPerSecond: number | null; // null when the answer came in one chunk
  // true when the provider sent no usage, so tokensOut is counted from the text (about 4 characters a token)
  estimated: boolean;
};

// A STORED RUN as /settings shows it: the model's latest run (numbers are null when it failed)
export type StoredSpeedTest = {
  model: string;
  effort: SpeedTestResult["effort"];
  latencyMs: number | null;
  totalMs: number | null;
  tokensOut: number | null;
  tokensPerSecond: number | null;
  estimated: boolean;
  status: "ok" | "error";
  error: string | null;
  testedAt: string;
  runs: number; // how many times this model has been tested
};

// Each model's latest run, keyed by model id
export async function readLatestSpeedTests(db: DbRpc): Promise<Record<string, StoredSpeedTest>> {
  const tests = await db.call<StoredSpeedTest[]>("get_latest_ai_speed_tests");
  return Object.fromEntries(tests.map((test) => [test.model, test]));
}

// Runs the test and stores the outcome, failed or not; a failure comes back as an error row instead of a throw
export async function runAndRecordSpeedTest(db: DbRpc, model: string, effort: ReasoningEffort, logCall?: AiCallLogger): Promise<StoredSpeedTest> {
  let test: Omit<StoredSpeedTest, "testedAt" | "runs">;
  try {
    test = { ...(await runSpeedTest(model, effort, process.env, logCall)), status: "ok", error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    test = { model, effort: isNemotron3(model) ? "off" : effort, latencyMs: null, totalMs: null, tokensOut: null, tokensPerSecond: null, estimated: false, status: "error", error: message };
  }
  await db.call("record_ai_speed_test", { p_test: test });
  return (await readLatestSpeedTests(db))[model] ?? { ...test, testedAt: new Date().toISOString(), runs: 1 };
}

type Timing = { firstTokenAt: number | null; text: string; usage: CompletionUsage | undefined };

// Runs the test prompt on one model at one reasoning effort ("cerebras/…" and "anthropic/…" picks go to their own provider)
export async function runSpeedTest(model: string, effort: ReasoningEffort, env: NodeJS.ProcessEnv = process.env, logCall?: AiCallLogger): Promise<SpeedTestResult> {
  const route = routeModel(env, model);
  const startedAt = performance.now();
  const log = (usage: CompletionUsage | undefined, error: string | null) =>
    logSafely(logCall, {
      purpose: "speed_test",
      subject: "AI Speed test",
      model,
      reasoningEffort: effort,
      ...usageTokens(usage),
      durationMs: Math.round(performance.now() - startedAt),
      status: error ? "error" : "ok",
      error,
    });
  let timing: Timing;
  try {
    timing = isAnthropicModel(model) ? await streamClaude(route.apiKey, model, effort) : await streamOpenAiCompatible(route.apiKey, model, route.baseUrl, effort);
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? `${model} did not finish within a minute.` : error instanceof Error ? error.message : String(error);
    await log(undefined, message);
    throw new Error(message);
  }
  const endedAt = performance.now();
  await log(timing.usage, null);
  if (timing.firstTokenAt === null) throw new Error(`${model} answered with no text.`);
  const tokensOut = timing.usage?.completion_tokens ?? Math.max(1, Math.round(timing.text.length / 4));
  const generationMs = endedAt - timing.firstTokenAt;
  return {
    model,
    effort: isNemotron3(model) ? "off" : effort,
    latencyMs: Math.round(timing.firstTokenAt - startedAt),
    totalMs: Math.round(endedAt - startedAt),
    tokensOut,
    // The first token is what latency measured, so the rate covers the tokens after it
    tokensPerSecond: generationMs > 0 && tokensOut > 1 ? (tokensOut - 1) / (generationMs / 1000) : null,
    estimated: timing.usage?.completion_tokens === undefined,
  };
}

type StreamChunk = {
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }[];
  usage?: CompletionUsage | null;
};

// Token Factory and Cerebras: an OpenAI-compatible streamed chat completion, with the same reasoning fields real calls send
async function streamOpenAiCompatible(apiKey: string, model: string, baseUrl: string | undefined, effort: ReasoningEffort): Promise<Timing> {
  const cerebras = isCerebrasModel(model);
  const response = await fetch(new URL("chat/completions", baseUrl ?? TOKEN_FACTORY_BASE_URL), {
    method: "POST",
    signal: AbortSignal.timeout(SPEED_TEST_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cerebras ? model.slice(CEREBRAS_MODEL_PREFIX.length) : model,
      messages: [{ role: "user", content: SPEED_TEST_PROMPT }],
      temperature: 0,
      ...reasoningFields(model, effort),
      max_tokens: SPEED_TEST_MAX_TOKENS,
      stream: true,
      ...(cerebras ? {} : { stream_options: { include_usage: true } }),
    }),
  });
  if (!response.ok) throw new Error(`${cerebras ? "Cerebras" : "Token Factory"} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  if (!response.body) throw new Error("The AI provider sent an empty stream.");
  const timing: Timing = { firstTokenAt: null, text: "", usage: undefined };
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffered = "";
  const take = (line: string) => {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data) as StreamChunk;
    if (chunk.usage) timing.usage = chunk.usage;
    const delta = chunk.choices?.[0]?.delta;
    const text = (delta?.content ?? "") + (delta?.reasoning_content ?? delta?.reasoning ?? "");
    if (!text) return;
    timing.firstTokenAt ??= performance.now();
    timing.text += text;
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split("\n").map((line) => line.replace(/\r$/, ""));
    buffered = done ? "" : (lines.pop() ?? "");
    for (const line of lines) take(line);
    if (done) break;
  }
  return timing;
}

// Claude: a streamed message with adaptive thinking at the effort, as real calls run (summarized thinking streams, so it counts as first token)
async function streamClaude(apiKey: string, model: string, effort: ReasoningEffort): Promise<Timing> {
  const client = new Anthropic({ apiKey, timeout: SPEED_TEST_TIMEOUT_MS });
  const timing: Timing = { firstTokenAt: null, text: "", usage: undefined };
  try {
    const stream = client.messages.stream({
      model: model.slice(ANTHROPIC_MODEL_PREFIX.length),
      max_tokens: SPEED_TEST_MAX_TOKENS,
      messages: [{ role: "user", content: SPEED_TEST_PROMPT }],
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort },
    });
    const hear = (delta: string) => {
      timing.firstTokenAt ??= performance.now();
      timing.text += delta;
    };
    stream.on("text", hear);
    stream.on("thinking", hear);
    const message = await stream.finalMessage();
    timing.usage = { prompt_tokens: message.usage.input_tokens, completion_tokens: message.usage.output_tokens };
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new Error(`${model} did not finish within a minute.`);
    if (error instanceof Anthropic.APIError && error.status !== undefined) throw new Error(`Claude ${error.status}: ${error.message.slice(0, 300)}`);
    throw error;
  }
  return timing;
}
