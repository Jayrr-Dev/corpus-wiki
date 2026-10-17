import { expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ProcessUploadResult } from "@/lib/ingest/types";
import type { ProcessingReport } from "@/lib/processing/metrics";

// Explicit opt-in: this uses real provider credits and writes a labelled source
// into the configured workspace. Ordinary test runs never execute it.
it.runIf(process.env.PROCESSING_LIVE_UTILITEK === "1")("processes a Utilitek website fixture with the live app services", async () => {
  const [{ getServerDeps }, ingest, { reconcileUpload }, { processingCancellation }] = await Promise.all([
    import("@/lib/server/deps"), import("@/lib/ingest"), import("@/lib/ingest/pipeline"), import("@/lib/processing/cancellation"),
  ]);
  const resumePath = process.env.PROCESSING_UTILITEK_RESUME;
  const previous = resumePath ? JSON.parse(await readFile(resolve(resumePath), "utf8")) as LiveReport : undefined;
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = previous ? dirname(resolve(resumePath!)) : resolve("artifacts/processing/utilitek-live", runId);
  const reportPath = resolve(directory, "report.json");
  await mkdir(directory, { recursive: true });
  const report: LiveReport = previous ?? { kind: "live app pipeline; real AI and configured workspace", runId, status: "preparing", sourceUrls: URLS, stages: [], aiCalls: [] };
  report.attempts ??= [];
  if (report.metrics && report.attempts.length) report.attempts.at(-1)!.metrics ??= report.metrics;
  const startedAt = new Date().toISOString();
  const attempt: NonNullable<LiveReport["attempts"]>[number] = { startedAt, finishedAt: null, durationMs: 0, result: null };
  report.attempts.push(attempt);
  // Retrying log_ai_call does not mean another model request was made.
  const callKey = (call: Record<string, unknown>) => JSON.stringify([call.purpose, call.model, call.reasoningEffort, call.promptTokens, call.completionTokens, call.durationMs, call.status]);
  const logged = new Map<string, Record<string, unknown>>();
  for (const call of report.aiCalls) {
    const key = callKey(call), existing = logged.get(key);
    if (existing) existing.loggingAttempts = Number(existing.loggingAttempts ?? 1) + Number(call.loggingAttempts ?? 1);
    else logged.set(key, { ...call, loggingAttempts: Number(call.loggingAttempts ?? 1) });
  }
  report.aiCalls = [...logged.values()];
  let writes = Promise.resolve();
  const save = () => {
    const json = JSON.stringify(report, null, 2) + "\n";
    writes = writes.then(() => writeFile(reportPath, json));
    return writes;
  };
  const originalInfo = console.info.bind(console);
  const info = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    if (args[0] === "Upload articles ready") {
      const { readyAt } = args[1] as { readyAt: string };
      report.articlesReadyAt ??= readyAt;
      report.timeToArticlesMs ??= Math.max(0, Date.parse(readyAt) - Date.parse(report.attempts![0]!.startedAt));
      attempt.timeToArticlesMs ??= Math.max(0, Date.parse(readyAt) - Date.parse(startedAt));
      void save();
    }
    if (args[0] === "Upload stage timing" || args[0] === "Upload page build timing") {
      report.stages.push({ ...(args[1] as Record<string, unknown>), recordedAt: new Date().toISOString() });
      void save();
    }
    if (args[0] === "Processing run metrics") {
      report.metrics = JSON.parse(String(args[1])) as ProcessingReport;
      attempt.metrics = report.metrics;
      void save();
    }
    originalInfo(...args);
  });
  // Observe actual AI calls at the logging boundary without changing routing,
  // prompts, retry behavior, publication or workspace settings.
  const nativeFetch = globalThis.fetch;
  const observer = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/rpc/log_ai_call") && typeof init?.body === "string") {
      const { p_call: call } = JSON.parse(init.body) as { p_call: Record<string, unknown> };
      const record = { purpose: call.purpose, model: call.model, reasoningEffort: call.reasoningEffort,
        promptTokens: call.promptTokens, completionTokens: call.completionTokens, durationMs: call.durationMs, status: call.status,
        recordedAt: new Date().toISOString(), loggingAttempts: 1 };
      const key = callKey(record), existing = logged.get(key);
      if (existing) existing.loggingAttempts = Number(existing.loggingAttempts ?? 1) + 1;
      else { logged.set(key, record); report.aiCalls.push(record); }
      void save();
    }
    const response = await nativeFetch(input, init);
    if (!response.ok && url.pathname.startsWith("/rest/v1/")) {
      report.networkErrors ??= [];
      report.networkErrors.push({ path: url.pathname, status: response.status, statusText: response.statusText,
        contentType: response.headers.get("content-type"), body: (await response.clone().text()).slice(0, 2000), recordedAt: new Date().toISOString() });
      void save();
    }
    return response;
  });
  vi.stubGlobal("fetch", observer);
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(new Error("Live test reached its 20-minute execution budget; completed checkpoints can be resumed.")), 20 * 60_000);
  deadline.unref?.();
  const started = performance.now();
  try {
    if (!previous) {
      // This Next.js site streams its rendered HTML in hidden containers before
      // browser hydration. Verify the source HTML; the curated fixture was also
      // checked against the browser-rendered public page.
      const pages = await Promise.all(URLS.map(async (url) => {
        const response = await nativeFetch(url, { signal: AbortSignal.timeout(25_000) });
        if (!response.ok) throw new Error(`Website snapshot failed (${response.status})`);
        const text = await response.text();
        return { url: response.url, title: /<title>([^<]*)<\/title>/i.exec(text)?.[1] ?? url, text };
      }));
      expect(pages[0]!.text.toLowerCase()).toContain("utilitek");
      expect(pages[1]!.text.toLowerCase()).toContain("distribution");
      expect(pages[1]!.text.toLowerCase()).toContain("spida");
      report.sources = pages.map((page) => ({ url: page.url, title: page.title, fetchedAt: startedAt,
        characters: page.text.length, sha256: createHash("sha256").update(page.text).digest("hex") }));
      const scenarioCount = Number(process.env.PROCESSING_UTILITEK_SCENARIOS ?? 0);
      if (!Number.isInteger(scenarioCount) || scenarioCount < 0 || scenarioCount > 4) throw new Error("Invalid synthetic project count.");
      report.syntheticProjects = scenarioCount;
      report.fixture = process.env.PROCESSING_UTILITEK_SMALL === "1" ? "small-six-facts-v1" : "website-summary";
      const content = report.fixture === "small-six-facts-v1" ? smallFixture(startedAt) : fixture(startedAt, scenarioCount);
      report.inputPath = resolve(directory, "utilitek-website-live-test.md");
      await writeFile(report.inputPath, content);
      report.status = "recording upload";
      await save();
      const source = await ingest.startUploadFromFile({ file: new File([content], `LIVE TEST - Utilitek website - ${runId}.md`, { type: "text/markdown" }), sourceDate: startedAt.slice(0, 10) });
      if (source.kind !== "started") throw new Error("The test file already exists; use the saved report to resume its event.");
      report.eventId = source.eventId;
      report.sourceId = source.sourceId;
    }
    if (!report.eventId || !report.sourceId) throw new Error("A live-test report must contain its upload and source IDs.");
    const deps = await getServerDeps();
    expect(deps.reconciler.name).not.toBe("fake");
    expect(deps.writer.name).not.toBe("fake");
    report.status = "processing";
    delete report.error;
    await save();
    const result = await processingCancellation.run(abort.signal, () => reconcileUpload(deps, report.eventId!));
    attempt.result = result;
    report.status = result.workflow?.waiting ? "waiting for approval" : result.workflow?.cancel_requested ? "cancelled" : result.error ? "incomplete" : result.workflow?.state ?? "unknown";
    const client = (await import("@/lib/supabase/admin")).getAdminSupabase();
    const touched = await deps.db.call<string[]>("living_page_event_units", { p_event_id: report.eventId });
    const sections = await deps.db.call<{ sectionId: string; pageId: string }[]>("list_affected_sections", { p_event_id: report.eventId });
    const [passages, exceptions, glossary, usage, reviews] = await Promise.all([
      client.from("passages").select("id", { count: "exact", head: true }).eq("source_id", report.sourceId),
      client.from("exceptions").select("id,reason,status,action_id").eq("status", "open"),
      client.from("glossary_state").select("status,completed_batches,total_batches,generated_at").eq("id", true).single(),
      client.from("source_usage").select("unit_count,article_count,line_count").eq("source_id", report.sourceId).single(),
      client.from("article_reviews").select("verdict,reason,decided_by,result_page_id").eq("event_id", report.eventId),
    ]);
    if (passages.error) throw passages.error;
    if (exceptions.error) throw exceptions.error;
    if (glossary.error) throw glossary.error;
    if (usage.error) throw usage.error;
    if (reviews.error) throw reviews.error;
    report.output = { sourcePassages: passages.count, touchedUnits: touched.length, affectedPages: new Set(sections.map((section) => section.pageId)).size,
      affectedSections: sections.length, sourceUsage: usage.data, articleReviews: reviews.data, glossary: glossary.data, openWorkspaceExceptions: exceptions.data.length };
    expect(result.workflow).toBeDefined();
    expect(result.workflow?.state).not.toBe("running");
    expect(result.error, "Live processing failed; the saved report identifies the unfinished stage").toBeNull();
    expect(attempt.metrics?.metrics["stage.curator.structure"]?.failures ?? 0, "Page-tree upkeep failed even though the source workflow completed").toBe(0);
    if (!result.workflow?.waiting) expect(result.workflow?.state).toBe("complete");
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    if (report.status !== "incomplete") report.status = "failed";
    throw error;
  } finally {
    clearTimeout(deadline);
    attempt.finishedAt = new Date().toISOString();
    attempt.durationMs = Math.round(performance.now() - started);
    await save();
    await writeFile(resolve("artifacts/processing/utilitek-live-latest.json"), JSON.stringify({ reportPath, status: report.status, sourceId: report.sourceId, eventId: report.eventId }, null, 2) + "\n");
    info.mockRestore();
    vi.unstubAllGlobals();
    console.info("Utilitek live test result", JSON.stringify({ status: report.status, timeToArticlesMs: report.timeToArticlesMs, durationMs: attempt.durationMs, aiCalls: report.aiCalls.length, output: report.output, reportPath }));
  }
}, 25 * 60_000);

type LiveReport = {
  kind: string; runId: string; status: string; sourceUrls: string[]; sources?: Record<string, unknown>[]; syntheticProjects?: number;
  sourceId?: string; eventId?: string; inputPath?: string; error?: string; fixture?: string; articlesReadyAt?: string; timeToArticlesMs?: number;
  attempts?: { startedAt: string; finishedAt: string | null; durationMs: number; result: ProcessUploadResult | null; metrics?: ProcessingReport; timeToArticlesMs?: number }[];
  stages: Record<string, unknown>[]; aiCalls: Record<string, unknown>[]; networkErrors?: Record<string, unknown>[]; metrics?: ProcessingReport; output?: Record<string, unknown>;
};
const URLS = ["https://www.utiliteksolutions.ca/", "https://www.utiliteksolutions.ca/expertise"];

function smallFixture(fetchedAt: string): string {
  return `# LIVE TEST — Utilitek small website fixture

Snapshot date: ${fetchedAt}
This is a labelled test summary of public website statements, not a record of invented projects.
Source: https://www.utiliteksolutions.ca/expertise

Utilitek Solutions designs overhead and underground distribution networks.
Its distribution design work includes pole-load analysis and conductor sizing.
Its housing-development work coordinates feeder backbones and pad-mounted transformers.
Its housing-development work includes lighting and individual lot services.
Its protection and control work involves relays, CT/PT equipment, SCADA, fault detection, and breaker operation.
Its published delivery sequence is assessment, design, implementation, then validation.
`;
}

function fixture(fetchedAt: string, scenarioCount = 0): string {
  return `# LIVE TEST — Utilitek website snapshot

Snapshot date: ${fetchedAt}
This labelled test document summarizes public website statements. It is not an internal operating policy or a record of invented projects.

## Company overview
Source: https://www.utiliteksolutions.ca/

Utilitek Solutions presents itself as an engineering consultancy serving utility and infrastructure projects in Edmonton, Alberta.

The homepage lists utility design, residential development support, protection and control, infrastructure upgrades, three-phase distribution, and transformer installation design among its services.

The company advertises more than twenty-five years of experience. Its homepage presents project and customer-satisfaction figures as company marketing claims.

## Engineering services and tools
Source: https://www.utiliteksolutions.ca/expertise

Utilitek describes distribution-network work for urban, suburban, and rural settings, including pole-load analysis, anchors, framing, guyed structures, and conductor sizing.

For housing developments, it coordinates feeder backbones, pad-mounted transformers, lighting, individual lot services, permits, and developer cost estimates.

Its power-system offering lists transformer installations, service laterals, and single- and three-phase distribution.

Specialisms include overhead and underground networks, protection/control, multi-utility layouts, asset upgrades, and shared-pole engineering. Protection work involves relays, CT/PT equipment, SCADA, fault detection, and breaker operation.

The published delivery sequence is assessment, design, implementation, then validation.

The tools listed are Microstation, PLS CADD, SPIDA Calc, PLS-Caisson, Sag10, PLS Pole, PLS Laminated Pole, and Quick Pole.

The site groups compliance references under IEEE, Canadian electrical-code/CSA, and Alberta requirements.
${scenarioCount ? syntheticProjects(fetchedAt, scenarioCount) : ""}`;
}

function syntheticProjects(run: string, count: number): string {
  const suffix = run.replace(/[^0-9]/g, "");
  const contexts = [
    { name: "Distribution design", facts: [
      "The fictional exercise covers an overhead distribution network in a rural setting.",
      "Its design work includes pole-load analysis, conductor sizing, anchors, framing, and guyed structures.",
      "SPIDA Calc and PLS Pole are the selected analysis tools for this exercise.",
      "Microstation is the selected drawing tool for this exercise.",
      "The assessment phase identifies the distribution-network design requirements.",
      "The design phase develops the pole, conductor, and anchoring arrangements.",
      "The implementation phase uses the completed synthetic design package.",
      "The validation phase checks the synthetic design against the exercise requirements.",
    ] },
    { name: "Residential servicing", facts: [
      "The fictional exercise covers utility servicing for a housing development.",
      "Its feeder-backbone scope includes pad-mounted transformers and individual lot services.",
      "Its coordination scope includes lighting, permits, and developer cost estimates.",
      "Microstation is the selected layout and drawing tool for this exercise.",
      "The assessment phase identifies the synthetic development's service requirements.",
      "The design phase coordinates the feeder backbone, lighting, transformers, and lot services.",
      "The implementation phase follows the completed synthetic servicing layout.",
      "The validation phase checks the synthetic service layout against the exercise requirements.",
    ] },
  ];
  return `\n## Fictional acceptance-test projects\n\nThese invented projects are test scenarios derived from the service categories and tools above. They are not actual Utilitek engagements, clients, policies or delivery records. Every statement below describes only its named fictional exercise.\n\n`
    + Array.from({ length: count }, (_, index) => {
      const item = contexts[index % contexts.length]!;
      const name = `Synthetic ${item.name} exercise ${suffix}-${index + 1}`;
      return `### ${name}\n\nThis fictional project is a test context under Utilitek Solutions Inc.\n\n${item.facts.map((fact) => `${name}: ${fact}`).join("\n\n")}\n`;
    }).join("\n");
}
