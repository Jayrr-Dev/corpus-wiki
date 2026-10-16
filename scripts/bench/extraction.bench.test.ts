import { appendFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { it } from "vitest";
import { chatJson, CompletionLengthError } from "@/lib/ai/chat";
import { supabaseRpc } from "@/lib/db/rpc";
import { loadStageSkills } from "@/lib/ai/skills/server";
import type { ReconciliationInput } from "@/lib/ai/types";
import { buildReconciliationMessages, claimRef, passageRef } from "@/lib/ai/tokenFactory/prompt";
import { reconciliationAnswerSchema, reconciliationJsonSchema, type AnswerClaim, type AnswerLink } from "@/lib/ai/tokenFactory/schema";
import { answerToActions } from "@/lib/ai/tokenFactory/toDraft";

// LIVE EXTRACTION BENCHMARK: reruns one upload's real extraction step (its saved input,
// the workspace's real skills) on several models. Read-only: nothing is logged or saved.
// RUN_AI_BENCH=1 BENCH_EVENT=<event id> BENCH_OUT=<report.json> node --env-file=.env.local node_modules/vitest/vitest.mjs run scripts/bench/extraction.bench.test.ts
type Config = { label: string; model: string; effort?: "low"; batchCap: number };

const CONFIGS: Config[] = [
  { label: "GLM-5.3-Flash medium, 8/batch (current)", model: "zai-org/GLM-5.3-Flash", batchCap: 8 },
  { label: "GLM-5.3-Flash low, 8/batch", model: "zai-org/GLM-5.3-Flash", effort: "low", batchCap: 8 },
  { label: "GLM-5.3-Flash low, 40/batch", model: "zai-org/GLM-5.3-Flash", effort: "low", batchCap: 40 },
  { label: "Qwen3-235B-A22B-Instruct-2507", model: "Qwen/Qwen3-235B-A22B-Instruct-2507", batchCap: 8 },
  { label: "Qwen3-30B-A3B-Instruct-2507", model: "Qwen/Qwen3-30B-A3B-Instruct-2507", batchCap: 8 },
  { label: "Nemotron-3 Super (thinking off)", model: "nvidia/nemotron-3-super-120b-a12b", batchCap: 8 },
  { label: "DeepSeek-V4.1-Flash", model: "deepseek-ai/DeepSeek-V4.1-Flash", batchCap: 8 },
];
const MAX_BATCH_CHARS = 6000;

// Live progress, one line per AI call, so a slow run shows where it is
const progress = (line: string) => { if (process.env.BENCH_PROGRESS) appendFileSync(process.env.BENCH_PROGRESS, `${new Date().toLocaleTimeString()} ${line}
`); };

function batches(passages: ReconciliationInput["passages"], cap: number) {
  const out: ReconciliationInput["passages"][] = [];
  let batch: ReconciliationInput["passages"] = [];
  let chars = 0;
  for (const passage of passages) {
    if (batch.length && (batch.length >= cap || chars + passage.text.length > MAX_BATCH_CHARS)) { out.push(batch); batch = []; chars = 0; }
    batch.push(passage);
    chars += passage.text.length;
  }
  if (batch.length) out.push(batch);
  return out;
}

// Mirrors TokenFactoryReconciliationClient.draftChangeSet, with the effort and batch size as knobs
async function runConfig(config: Config, input: ReconciliationInput, apiKey: string, skills: Awaited<ReturnType<typeof loadStageSkills>>) {
  const settings = { apiKey, model: config.model, skills };
  const claims: AnswerClaim[] = [];
  const links: AnswerLink[] = [];
  const calls: { passages: number; seconds: number; tokensOut: number | null; outcome: string }[] = [];
  let failedPassages = 0;
  const globalRefs = new Map(input.passages.map((passage, index) => [passage.id, passageRef(index)]));
  const extract = async (passages: ReconciliationInput["passages"]): Promise<void> => {
    const started = Date.now();
    let answer;
    try {
      answer = await chatJson(settings, {
        name: "reconciliation", subject: input.source.title, schema: reconciliationAnswerSchema, jsonSchema: reconciliationJsonSchema,
        messages: buildReconciliationMessages({ ...input, passages }, skills), reasoningEffort: config.effort,
      });
    } catch (error) {
      calls.push({ passages: passages.length, seconds: (Date.now() - started) / 1000, tokensOut: error instanceof CompletionLengthError ? error.tokensOut : null, outcome: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      progress(`${config.label}: FAILED ${passages.length} passages after ${Math.round((Date.now() - started) / 1000)}s: ${calls.at(-1)!.outcome}`);
      // A failed batch is counted, not fatal, so the model's other batches still get compared
      if (!(error instanceof CompletionLengthError) || passages.length <= 1) { failedPassages += passages.length; return; }
      const middle = Math.ceil(passages.length / 2);
      await extract(passages.slice(0, middle));
      await extract(passages.slice(middle));
      return;
    }
    calls.push({ passages: passages.length, seconds: (Date.now() - started) / 1000, tokensOut: answer.tokensOut, outcome: "ok" });
    progress(`${config.label}: ok ${passages.length} passages in ${Math.round((Date.now() - started) / 1000)}s, ${answer.value.claims.length} claims, ${answer.tokensOut} tokens out`);
    const localRefs = new Map(passages.map((passage, index) => [passageRef(index), globalRefs.get(passage.id)!]));
    const offset = claims.length;
    const globalClaim = (ref: string) => ref.trim().replace(/^C(\d+)$/i, (_, n: string) => claimRef(offset + Number(n) - 1));
    links.push(...answer.value.links.map((link) => ({ ...link, from: globalClaim(link.from), to: globalClaim(link.to) })));
    claims.push(...answer.value.claims.map((claim) => ({ ...claim, passages: claim.passages.map((ref) => localRefs.get(ref.trim().toUpperCase()) ?? "INVALID_PASSAGE") })));
  };
  const started = Date.now();
  let error: string | null = null;
  let actions = 0;
  try {
    for (const batch of batches(input.passages, config.batchCap)) await extract(batch);
    actions = answerToActions({ summary: "", claims, links }, input).length;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 300) : String(e);
  }
  const cited = new Set(claims.flatMap((claim) => claim.passages));
  const textByRef = new Map(input.passages.map((passage, index) => [passageRef(index), passage.text]));
  return {
    ...config,
    seconds: Math.round((Date.now() - started) / 1000),
    error,
    failedPassages,
    calls,
    claimCount: claims.length,
    linkCount: links.length,
    actions,
    invalidRefs: claims.filter((claim) => claim.passages.includes("INVALID_PASSAGE")).length,
    passagesCited: cited.size,
    claims: claims.map((claim) => ({ title: claim.title, content: claim.content, kind: claim.kind, passages: claim.passages, source: claim.passages.map((ref) => textByRef.get(ref)).join(" | ") })),
  };
}

it.runIf(process.env.RUN_AI_BENCH === "1")("benchmarks extraction models on a real upload", async () => {
  const apiKey = process.env.NEBIUS_API_KEY!;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const { data, error } = await client.from("upload_steps").select("output").eq("event_id", process.env.BENCH_EVENT!).eq("key", "reconciliation-input").single();
  if (error) throw error;
  const full = data.output as unknown as ReconciliationInput;
  // BENCH_PASSAGES=<n> tests only the file's first n passages (a smaller, quicker sample)
  const limit = Number(process.env.BENCH_PASSAGES) || full.passages.length;
  const input = { ...full, passages: full.passages.slice(0, limit) };
  const skills = await loadStageSkills(supabaseRpc(client as never));
  const only = process.env.BENCH_ONLY?.split(",");
  const configs = only ? CONFIGS.filter((_, index) => only.includes(String(index + 1))) : CONFIGS;
  const results = await Promise.all(configs.map(async (config) => {
    const result = await runConfig(config, input, apiKey, skills);
    progress(`DONE ${config.label}: ${result.seconds}s total, ${result.claimCount} claims, ${result.failedPassages} passages failed`);
    console.info(`done: ${config.label} in ${result.seconds}s, ${result.claimCount} claims${result.error ? `, ERROR ${result.error}` : ""}`);
    return result;
  }));
  writeFileSync(process.env.BENCH_OUT!, JSON.stringify({ source: input.source.title, passages: input.passages.length, existingUnits: input.existingUnits.length, results }, null, 2));
  for (const r of results) console.info(JSON.stringify({ label: r.label, seconds: r.seconds, claims: r.claimCount, actions: r.actions, cited: r.passagesCited, invalid: r.invalidRefs, error: r.error }));
}, 40 * 60_000);
