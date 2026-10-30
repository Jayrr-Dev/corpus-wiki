import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import type { AiCallRecord } from "../../lib/ai/callLog.ts";
import type { TokenFactorySettings } from "../../lib/ai/chat.ts";
import type { PageContextSection, SectionReviseInput, SectionState } from "../../lib/living-page/types.ts";

// =====================================================================
// SECTION BUILD REPLAY (#42 live check): builds saved sections from
// scratch with TokenFactorySectionWriter.reviseSection, on live models,
// and counts the Reviewer calls each build makes. The writer reads and
// writes no database, so nothing is saved anywhere but --out.
// --code points at a checkout, so the same sample can run on the code
// before and after a change.
//
//   node --experimental-strip-types scripts/cost/section-build-replay.ts \
//     --code <checkout> --sections <sections.json> --out <file.json> [--limit 15] [--limit-usd 1]
//
// sections.json is the R2 sample (scripts/cost/review-notes.md). Each section is
// rebuilt as a new one: its claims, no lines, every claim uncovered, and the page's
// other sections as context, as an upload into an empty space builds it.
// Needs ANTHROPIC_API_KEY only.
// =====================================================================

type SectionSample = { sectionId: string; pageId: string; spaceId: string; state: SectionState; pageContext: PageContextSection[] | null };

const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index > 0 ? process.argv[index + 1] : fallback;
  if (value === undefined) throw new Error(`Pass --${name}.`);
  return value;
};
const code = resolve(arg("code"));
const ENNEAGRAM = "21132c80-32b3-4ef2-9156-d9af60486173";
const sample = (JSON.parse(readFileSync(arg("sections"), "utf8")) as SectionSample[]).filter((row) => row.spaceId === ENNEAGRAM).slice(0, Number(arg("limit", "15")));
const out = arg("out");
const limitUsd = Number(arg("limit-usd", "1"));
// The Enneagram space's archetypes upload wrote and reviewed on Haiku 5.5 (ai_calls, 2026-10-18 and 19); the reviewer is Haiku today
const MODEL = arg("model", "anthropic/claude-haiku-5-5");
const CONCURRENCY = 3;
const REVIEWER = new Set(["line_fact_check", "line_fact_confirm", "independent_section_editorial_review", "independent_section_editorial_selection"]);
if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY.");

let usd = 0;
const runtime = await createServer({ root: code, configFile: false, appType: "custom", logLevel: "error", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": code, "server-only": join(code, "test/server-only.ts") } } });
try {
  const { tokenFactoryFromEnv } = (await runtime.ssrLoadModule("/lib/ai/chat.ts")) as typeof import("../../lib/ai/chat.ts");
  const { estimateCost } = (await runtime.ssrLoadModule("/lib/ai/pricing.ts")) as typeof import("../../lib/ai/pricing.ts");
  const { TokenFactorySectionWriter } = (await runtime.ssrLoadModule("/lib/living-page/writers/tokenFactory.ts")) as typeof import("../../lib/living-page/writers/tokenFactory.ts");

  type Row = { item: string; claims: number; calls: Record<string, number>; reviewerCalls: number; writes: number; usd: number; tokensIn: number; tokensOut: number; ms: number; lines: number; error: string | null };
  const rows: Row[] = [];
  let next = 0;
  let stopped = false;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < sample.length) {
      if (usd >= limitUsd) { stopped = true; return; }
      const { state, pageContext } = sample[next++]!;
      const row: Row = { item: `${state.pageTitle} › ${state.title}`, claims: state.units.length, calls: {}, reviewerCalls: 0, writes: 0, usd: 0, tokensIn: 0, tokensOut: 0, ms: 0, lines: 0, error: null };
      // One logger per build, so each section's calls are counted on their own
      const logCall = async (call: AiCallRecord) => {
        row.calls[call.purpose] = (row.calls[call.purpose] ?? 0) + 1;
        const cost = estimateCost(call.model, call.promptTokens ?? 0, call.completionTokens ?? 0, call.usageDetails) ?? 0;
        row.usd += cost; usd += cost;
        row.tokensIn += call.promptTokens ?? 0; row.tokensOut += call.completionTokens ?? 0;
      };
      const settings = tokenFactoryFromEnv(process.env, { model: MODEL, roleModels: { reviewer: MODEL } }, logCall) as TokenFactorySettings;
      const input: SectionReviseInput = { pageTitle: state.pageTitle, sectionTitle: state.title, units: state.units, lines: [], uncoveredUnitIds: state.units.map((unit) => unit.unitId), ...(pageContext?.length ? { pageContext } : {}) };
      // The app passes a progress sink; the old code ran its early line checks only with one
      const progress = { thinking() {}, draft() {}, step() {} } as unknown as Parameters<InstanceType<typeof TokenFactorySectionWriter>["reviseSection"]>[1];
      const started = Date.now();
      try {
        const revision = await new TokenFactorySectionWriter(settings).reviseSection(input, progress);
        row.lines = revision.add.length;
      } catch (error) { row.error = error instanceof Error ? error.message : String(error); }
      row.ms = Date.now() - started;
      row.reviewerCalls = Object.entries(row.calls).filter(([purpose]) => REVIEWER.has(purpose)).reduce((sum, [, n]) => sum + n, 0);
      row.writes = row.calls.section_lines ?? 0;
      rows.push(row);
      console.log(`${rows.length}/${sample.length} ${row.item}: reviewer ${row.reviewerCalls}, writes ${row.writes} ${JSON.stringify(row.calls)}${row.error ? ` ERROR ${row.error}` : ""}  ($${usd.toFixed(3)})`);
    }
  }));
  const built = rows.filter((row) => !row.error);
  const sum = (pick: (row: Row) => number, list = rows) => list.reduce((total, row) => total + pick(row), 0);
  const byPurpose: Record<string, number> = {};
  for (const row of rows) for (const [purpose, n] of Object.entries(row.calls)) byPurpose[purpose] = (byPurpose[purpose] ?? 0) + n;
  const summary = {
    ranOn: new Date().toISOString(), code, model: MODEL, sections: rows.length, built: built.length, stoppedAtLimit: stopped, usd,
    reviewerCalls: sum((row) => row.reviewerCalls), reviewerCallsPerSection: sum((row) => row.reviewerCalls) / rows.length,
    writesPerSection: sum((row) => row.writes) / rows.length, byPurpose,
    medianMs: [...rows.map((row) => row.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  };
  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(out, JSON.stringify({ summary, rows }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
} finally {
  await runtime.close();
}
