import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import type { AiCallRecord } from "../../lib/ai/callLog.ts";
import type { TokenFactorySettings } from "../../lib/ai/chat.ts";
import type { DbRpc } from "../../lib/db/rpc.ts";
import type { PageReviewSnapshot } from "../../lib/living-page/pageReview.ts";
import type { PageReviewResult } from "../../lib/living-page/runPageReview.ts";
import type { PageContextSection, SectionReviseInput, SectionState } from "../../lib/living-page/types.ts";
import type { CheckRequest, LineVerdict } from "../../lib/living-page/writers/lineCheck.ts";

// =====================================================================
// REVIEWER SAMPLE: SONNET AGAINST HAIKU (R2 of "Plan: cut AI cost" in TODO.md)
// Runs the same real reviewer inputs on two models through the app's own
// code (checkLines, checkEditorialDraft, runPageReview) and chat client, and
// compares the verdicts. Nothing is written back: the call logger only
// counts cost, and page reviews run against a stand-in database that serves
// the saved snapshot and keeps what complete_page_review would have saved.
//
//   node --experimental-strip-types --env-file=<path to .env.local> scripts/cost/review-sample.ts \
//     --sections <sections.json> --pages <pages.json> --out <dir> [--limit-usd 3]
//
// sections.json: [{ sectionId, pageId, spaceId, state: read_section_state, pageContext: read_page_context }]
// pages.json:    [{ pageId, spaceId, snapshot: page_review_snapshot }]
// Both are read from the live database with the space's x-space-id header set (see
// scripts/cost/review-notes.md for the queries). Needs ANTHROPIC_API_KEY.
// =====================================================================

// TYPES
type SectionSample = { sectionId: string; pageId: string; spaceId: string; state: SectionState; pageContext: PageContextSection[] | null };
type PageSample = { pageId: string; spaceId: string; snapshot: PageReviewSnapshot };
type Purpose = "line_fact_check" | "independent_section_editorial_review" | "page_editorial_review";
// One model's answer on one item: the refs it flagged, and why
type Answer = { flagged: Record<string, string>; error: string | null; extra?: unknown };
type Compared = { purpose: Purpose; item: string; space: string; input: unknown; answers: Record<string, Answer>; agree: boolean | null };

// SETTINGS
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MODELS = { sonnet: "anthropic/claude-sonnet-5-5", haiku: "anthropic/claude-haiku-5-5" } as const;
type ModelKey = keyof typeof MODELS;
// Stop starting new items once this much of the limit is spent, so an item in flight cannot pass it
const SAFETY_MARGIN_USD = 0.25;
const CONCURRENCY = 3;

const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index > 0 ? process.argv[index + 1] : fallback;
  if (value === undefined) throw new Error(`Pass --${name}.`);
  return value;
};
const sections = JSON.parse(readFileSync(arg("sections"), "utf8")) as SectionSample[];
const pages = JSON.parse(readFileSync(arg("pages"), "utf8")) as PageSample[];
const outDir = arg("out");
const limitUsd = Number(arg("limit-usd", "3"));
if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY.");

// COST: every call each model makes, priced with the app's own table
const spend: Record<ModelKey, Record<string, { calls: number; tokensIn: number; tokensOut: number; usd: number }>> = { sonnet: {}, haiku: {} };
const spent = () => Object.values(spend).flatMap((byPurpose) => Object.values(byPurpose)).reduce((sum, row) => sum + row.usd, 0);
let stopped = false;

// =====================================================================
// BUILDING THE REQUESTS THE APP SENDS
// =====================================================================

// The section's claims as C1, C2, ... and its lines as L1, L2, ... with the claims each cites,
// in the shapes refClaims and linesToCheck give checkLines in writers/tokenFactory.ts
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

// The writer's input as rebuildUploadSection builds it (lib/living-page/index.ts), for the editorial read
function editorialInput(sample: SectionSample): { input: SectionReviseInput; lines: { ref: string; text: string }[] } {
  const { state } = sample;
  const input: SectionReviseInput = { pageTitle: state.pageTitle, sectionTitle: state.title, units: state.units, lines: state.lines, uncoveredUnitIds: [], ...(sample.pageContext?.length ? { pageContext: sample.pageContext } : {}) };
  return { input, lines: state.lines.map((line, index) => ({ ref: `L${index + 1}`, text: line.content })).filter((line) => line.text.trim()) };
}

// A database that only serves the saved snapshot and keeps the review instead of saving it
function standInDb(sample: PageSample, kept: { review?: unknown; edits?: unknown[] }): DbRpc {
  return {
    async call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
      if (fn === "page_review_snapshot") return sample.snapshot as T;
      if (fn === "complete_page_review") {
        const review = args?.p_review as { findings?: unknown[]; summary?: string };
        kept.review = review;
        kept.edits = args?.p_edits as unknown[];
        return { summary: review.summary ?? "", exceptions: review.findings?.length ?? 0, edits: kept.edits.length, changeSetId: null } as T;
      }
      if (fn === "auto_accept_exceptions") return [] as T;
      throw new Error(`The sample run does not call ${fn}.`);
    },
  };
}

// =====================================================================
// MAIN
// =====================================================================

// The app's modules use "@/" imports and "server-only"; vite resolves both (as evals/retrieval/run.ts does)
const runtime = await createServer({ configFile: false, appType: "custom", logLevel: "error", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": ROOT, "server-only": join(ROOT, "test/server-only.ts") } } });
try {
  const { tokenFactoryFromEnv } = (await runtime.ssrLoadModule("/lib/ai/chat.ts")) as typeof import("../../lib/ai/chat.ts");
  const { estimateCost } = (await runtime.ssrLoadModule("/lib/ai/pricing.ts")) as typeof import("../../lib/ai/pricing.ts");
  const { checkLines } = (await runtime.ssrLoadModule("/lib/living-page/writers/lineCheck.ts")) as typeof import("../../lib/living-page/writers/lineCheck.ts");
  const { checkEditorialDraft } = (await runtime.ssrLoadModule("/lib/living-page/writers/editorialSelection.ts")) as typeof import("../../lib/living-page/writers/editorialSelection.ts");
  const { runPageReview } = (await runtime.ssrLoadModule("/lib/living-page/runPageReview.ts")) as { runPageReview: (db: DbRpc, settings: TokenFactorySettings, pageId: string, embedder?: null) => Promise<PageReviewResult> };

  // The reviewer role routed to one model, as /settings does; no memory database and no
  // usage log in the app (the reviewer has no saved memory; the log would write ai_calls)
  const settingsFor = (key: ModelKey): TokenFactorySettings => {
    const logCall = async (call: AiCallRecord) => {
      const row = (spend[key][call.purpose] ??= { calls: 0, tokensIn: 0, tokensOut: 0, usd: 0 });
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

  // Runs one item on both models at once; an error is kept as that model's answer
  const both = async (run: (settings: TokenFactorySettings) => Promise<Answer>): Promise<Record<ModelKey, Answer>> => {
    const [sonnet, haiku] = await Promise.all((Object.keys(MODELS) as ModelKey[]).map(async (key) => {
      try { return await run(settings[key]); }
      catch (error) { return { flagged: {}, error: error instanceof Error ? error.message : String(error) }; }
    }));
    return { sonnet: sonnet!, haiku: haiku! };
  };
  const flaggedFrom = (verdicts: LineVerdict[]) => Object.fromEntries(verdicts.filter((verdict) => !verdict.supported).map((verdict) => [verdict.line, verdict.problem]));
  // Same verdict: both flag exactly the same refs (an item with an error has no verdict)
  const agreement = (answers: Record<ModelKey, Answer>) => answers.sonnet.error || answers.haiku.error ? null
    : JSON.stringify(Object.keys(answers.sonnet.flagged).sort()) === JSON.stringify(Object.keys(answers.haiku.flagged).sort());

  const spaceOf = (spaceId: string) => (spaceId === "00000000-0000-4000-8000-000000000001" ? "Utilitek" : "Enneagram");
  type Job = () => Promise<Compared>;
  const jobs: Job[] = [
    ...sections.map((sample): Job => async () => {
      const request = factCheckRequest(sample);
      const answers = await both(async (s) => ({ flagged: flaggedFrom((await checkLines(s, request)).verdicts), error: null }));
      return { purpose: "line_fact_check", item: `${request.page} › ${request.section}`, space: spaceOf(sample.spaceId), input: request, answers, agree: agreement(answers) };
    }),
    ...sections.map((sample): Job => async () => {
      const { input, lines } = editorialInput(sample);
      const answers = await both(async (s) => ({ flagged: flaggedFrom((await checkEditorialDraft(s, input, lines)).verdicts), error: null }));
      return { purpose: "independent_section_editorial_review", item: `${input.pageTitle} › ${input.sectionTitle}`, space: spaceOf(sample.spaceId), input: { lines }, answers, agree: agreement(answers) };
    }),
    ...pages.map((sample): Job => async () => {
      const answers = await both(async (s) => {
        const kept: { review?: unknown; edits?: unknown[] } = {};
        await runPageReview(standInDb(sample, kept), s, sample.pageId, null);
        const review = kept.review as { findings: { quote?: string; recommendation?: string }[] };
        const edits = (kept.edits ?? []) as { targetId?: string; type?: string; text?: string }[];
        // A page review's verdict: the lines or sections it edits and the findings it raises
        const flagged = Object.fromEntries([
          ...edits.map((edit) => [`edit:${edit.targetId ?? edit.type}`, `${edit.type}: ${edit.text ?? ""}`.slice(0, 400)]),
          ...review.findings.map((finding, index) => [`finding:${index + 1}`, `${finding.quote ?? ""} → ${finding.recommendation ?? ""}`.slice(0, 400)]),
        ]);
        return { flagged, error: null, extra: { edits: edits.length, findings: review.findings.length } };
      });
      // Pages agree when both leave the page alone, or both change or flag it
      const agree = answers.sonnet.error || answers.haiku.error ? null : (Object.keys(answers.sonnet.flagged).length > 0) === (Object.keys(answers.haiku.flagged).length > 0);
      return { purpose: "page_editorial_review", item: sample.snapshot.page.title, space: spaceOf(sample.spaceId), input: { lines: sample.snapshot.lines.length }, answers, agree };
    }),
  ];

  const results: Compared[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      if (spent() >= limitUsd - SAFETY_MARGIN_USD) { stopped = true; return; }
      const job = jobs[next++]!;
      const result = await job();
      results.push(result);
      console.log(`${results.length}/${jobs.length} ${result.purpose} ${result.item}: ${result.agree === null ? "error" : result.agree ? "agree" : "DISAGREE"}  ($${spent().toFixed(3)})`);
    }
  }));

  // SUMMARY: agreement per purpose, and what each model cost on the sample
  const purposes: Purpose[] = ["line_fact_check", "independent_section_editorial_review", "page_editorial_review"];
  const summary = {
    ranOn: new Date().toISOString(), limitUsd, stoppedAtLimit: stopped, spentUsd: spent(),
    agreement: Object.fromEntries(purposes.map((purpose) => {
      const rows = results.filter((row) => row.purpose === purpose);
      const judged = rows.filter((row) => row.agree !== null);
      return [purpose, { items: rows.length, judged: judged.length, agree: judged.filter((row) => row.agree).length,
        sonnetFlagged: judged.filter((row) => Object.keys(row.answers.sonnet!.flagged).length).length,
        haikuFlagged: judged.filter((row) => Object.keys(row.answers.haiku!.flagged).length).length,
        errors: rows.filter((row) => row.agree === null).map((row) => ({ item: row.item, sonnet: row.answers.sonnet!.error, haiku: row.answers.haiku!.error })) }];
    })),
    cost: Object.fromEntries((Object.keys(MODELS) as ModelKey[]).map((key) => [key, { usd: Object.values(spend[key]).reduce((sum, row) => sum + row.usd, 0), byPurpose: spend[key] }])),
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "review-sample-results.json"), JSON.stringify(results, null, 1));
  writeFileSync(join(outDir, "review-sample-summary.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
} finally {
  await runtime.close();
}
