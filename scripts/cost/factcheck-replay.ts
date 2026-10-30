import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import type { AiCallRecord } from "../../lib/ai/callLog.ts";
import type { TokenFactorySettings } from "../../lib/ai/chat.ts";
import type { SectionState } from "../../lib/living-page/types.ts";
import type { CheckRequest, LineVerdict } from "../../lib/living-page/writers/lineCheck.ts";

// =====================================================================
// FACT-CHECK REPLAY (#42 live check): runs the saved R2 sections
// (scripts/cost/review-notes.md R2) through the current, batched
// checkLines (one line_fact_check per section, one line_fact_confirm for
// all objections) and compares each line's verdict with the verdicts the
// old per-objection code gave on 2026-10-26 (review-sample-results.json).
// Nothing is written anywhere but --out.
//
//   node --experimental-strip-types scripts/cost/factcheck-replay.ts \
//     --sections <sections.json> --saved <review-sample-results.json> --out <dir> [--runs 1] [--limit-usd 1]
//
// Needs ANTHROPIC_API_KEY only.
// =====================================================================

type SectionSample = { sectionId: string; pageId: string; spaceId: string; state: SectionState };
type Saved = { purpose: string; item: string; input: CheckRequest; answers: Record<string, { flagged: Record<string, string> }> };

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MODELS = { sonnet: "anthropic/claude-sonnet-5-5", haiku: "anthropic/claude-haiku-5-5" } as const;
type ModelKey = keyof typeof MODELS;
const CONCURRENCY = 4;

const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index > 0 ? process.argv[index + 1] : fallback;
  if (value === undefined) throw new Error(`Pass --${name}.`);
  return value;
};
const sections = JSON.parse(readFileSync(arg("sections"), "utf8")) as SectionSample[];
const saved = (JSON.parse(readFileSync(arg("saved"), "utf8")) as Saved[]).filter((row) => row.purpose === "line_fact_check");
const outDir = arg("out");
const runs = Number(arg("runs", "1"));
const limitUsd = Number(arg("limit-usd", "1"));
if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY.");

const spend: Record<string, { calls: number; tokensIn: number; tokensOut: number; usd: number }> = {};
const spent = () => Object.values(spend).reduce((sum, row) => sum + row.usd, 0);

// The same request review-sample.ts built, so the inputs match the saved run exactly
function factCheckRequest(sample: SectionSample): CheckRequest {
  const { state } = sample;
  const ref = new Map(state.units.map((unit, index) => [unit.unitId, `C${index + 1}`]));
  const claims = state.units.map((unit) => ({ ref: ref.get(unit.unitId)!, claim: unit.content, status: unit.epistemicStatus, context: unit.context ?? null }));
  const claimOf = new Map(claims.map((claim) => [claim.ref, claim]));
  const lines = state.lines.map((line, index) => ({
    ref: `L${index + 1}`, text: line.content,
    claims: line.unitIds.flatMap((id) => (ref.has(id) ? [claimOf.get(ref.get(id)!)!] : [])),
  })).filter((line) => line.text.trim() && line.claims.length > 0);
  return { page: state.pageTitle, section: state.title, lines, sectionClaims: claims };
}

const runtime = await createServer({ configFile: false, appType: "custom", logLevel: "error", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": ROOT, "server-only": join(ROOT, "test/server-only.ts") } } });
try {
  const { tokenFactoryFromEnv } = (await runtime.ssrLoadModule("/lib/ai/chat.ts")) as typeof import("../../lib/ai/chat.ts");
  const { estimateCost } = (await runtime.ssrLoadModule("/lib/ai/pricing.ts")) as typeof import("../../lib/ai/pricing.ts");
  const { checkLines } = (await runtime.ssrLoadModule("/lib/living-page/writers/lineCheck.ts")) as typeof import("../../lib/living-page/writers/lineCheck.ts");

  const settingsFor = (key: ModelKey): TokenFactorySettings => {
    const logCall = async (call: AiCallRecord) => {
      const row = (spend[`${key}:${call.purpose}`] ??= { calls: 0, tokensIn: 0, tokensOut: 0, usd: 0 });
      row.calls++;
      row.tokensIn += call.promptTokens ?? 0;
      row.tokensOut += call.completionTokens ?? 0;
      row.usd += estimateCost(call.model, call.promptTokens ?? 0, call.completionTokens ?? 0, call.usageDetails) ?? 0;
    };
    const settings = tokenFactoryFromEnv(process.env, { model: MODELS[key], roleModels: { reviewer: MODELS[key] } }, logCall);
    if (!settings) throw new Error("No AI provider key is set.");
    return settings;
  };
  const settings = { sonnet: settingsFor("sonnet"), haiku: settingsFor("haiku") };

  type Row = { run: number; model: ModelKey; item: string; lines: number; flagged: Record<string, string>; overruled: Record<string, string>; savedSonnet: string[]; savedHaiku: string[]; error: string | null };
  const rows: Row[] = [];
  const jobs = Array.from({ length: runs }, (_, run) => sections.flatMap((sample) => (Object.keys(MODELS) as ModelKey[]).map((model) => ({ run: run + 1, model, sample })))).flat();
  let next = 0;
  let stopped = false;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      if (spent() >= limitUsd) { stopped = true; return; }
      const { run, model, sample } = jobs[next++]!;
      const request = factCheckRequest(sample);
      const item = `${request.page} › ${request.section}`;
      const old = saved.find((row) => row.item === item);
      if (!old) throw new Error(`No saved verdict for ${item}.`);
      if (JSON.stringify(old.input.lines.map((line) => line.text)) !== JSON.stringify(request.lines.map((line) => line.text))) throw new Error(`Input changed for ${item}.`);
      let verdicts: LineVerdict[] = [];
      let error: string | null = null;
      try { verdicts = (await checkLines(settings[model], request)).verdicts; }
      catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
      const row: Row = {
        run, model, item, lines: request.lines.length, error,
        flagged: Object.fromEntries(verdicts.filter((verdict) => !verdict.supported).map((verdict) => [verdict.line, verdict.problem])),
        overruled: Object.fromEntries(verdicts.filter((verdict) => verdict.overruled).map((verdict) => [verdict.line, verdict.overruled!])),
        savedSonnet: Object.keys(old.answers.sonnet!.flagged).sort(), savedHaiku: Object.keys(old.answers.haiku!.flagged).sort(),
      };
      rows.push(row);
      console.log(`${rows.length}/${jobs.length} run ${run} ${model} ${item}: flagged [${Object.keys(row.flagged).join(",")}] saved sonnet [${row.savedSonnet}] haiku [${row.savedHaiku}]${error ? ` ERROR ${error}` : ""}  ($${spent().toFixed(3)})`);
    }
  }));

  // Per-line agreement: a line agrees when both answers flag it or both pass it
  const lineAgreement = (pairs: [Set<string>, Set<string>, number][]) => {
    let agree = 0, total = 0;
    for (const [a, b, lines] of pairs) {
      total += lines;
      const differ = new Set([...a].filter((ref) => !b.has(ref)).concat([...b].filter((ref) => !a.has(ref)))).size;
      agree += lines - differ;
    }
    return { agree, total };
  };
  const summary: Record<string, unknown> = { ranOn: new Date().toISOString(), runs, limitUsd, stoppedAtLimit: stopped, spentUsd: spent(), spend, errors: rows.filter((row) => row.error).length };
  for (let run = 1; run <= runs; run++) {
    const of = (model: ModelKey) => rows.filter((row) => row.run === run && row.model === model && !row.error);
    const keyed = (model: ModelKey) => new Map(of(model).map((row) => [row.item, row]));
    const sonnet = keyed("sonnet"), haiku = keyed("haiku");
    const common = [...sonnet.keys()].filter((item) => haiku.has(item));
    summary[`run${run}`] = {
      newHaikuVsSavedHaiku: lineAgreement(of("haiku").map((row) => [new Set(Object.keys(row.flagged)), new Set(row.savedHaiku), row.lines])),
      newSonnetVsSavedSonnet: lineAgreement(of("sonnet").map((row) => [new Set(Object.keys(row.flagged)), new Set(row.savedSonnet), row.lines])),
      newSonnetVsNewHaiku: lineAgreement(common.map((item) => [new Set(Object.keys(sonnet.get(item)!.flagged)), new Set(Object.keys(haiku.get(item)!.flagged)), sonnet.get(item)!.lines])),
      newHaikuVsSavedSonnet: lineAgreement(of("haiku").map((row) => [new Set(Object.keys(row.flagged)), new Set(row.savedSonnet), row.lines])),
      flaggedLines: { sonnet: of("sonnet").reduce((sum, row) => sum + Object.keys(row.flagged).length, 0), haiku: of("haiku").reduce((sum, row) => sum + Object.keys(row.flagged).length, 0) },
    };
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "factcheck-replay-results.json"), JSON.stringify(rows, null, 1));
  writeFileSync(join(outDir, "factcheck-replay-summary.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
} finally {
  await runtime.close();
}
