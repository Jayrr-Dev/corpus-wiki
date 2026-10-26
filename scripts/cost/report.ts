import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { estimateCallCost, formatUsd, priceFor } from "../../lib/ai/pricing.ts";

// =====================================================================
// AI COST REPORT: what the logged AI calls cost over a time window, and
// what one uploaded document costs. Read-only: it only selects from
// public.ai_calls, public.shift_events, public.sources and public.upload_steps,
// one space at a time (the service key only sees the space named in x-space-id).
//
//   node --experimental-strip-types --env-file=.env.local scripts/cost/report.ts [--days 30]
//     [--since 2026-10-01] [--until 2026-10-26] [--json] [--out baseline.json] [--compare baseline.json]
//
// How calls are tied to uploads, and where that is wrong: scripts/cost/README.md.
// =====================================================================

// TYPES
type Call = {
  space_id: string;
  created_at: string;
  purpose: string;
  subject: string | null;
  model: string;
  role: string | null;
  status: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  usage_details: unknown;
};
type UploadEvent = { id: string; spaceId: string; created_at: string; finished_at: string | null; status: string; source_id: string | null; title: string | null; start: number; end: number };
type Bucket = { key: string; calls: number; cost: number; unpricedCalls: number; promptTokens: number; completionTokens: number };
type UploadRow = { eventId: string; title: string | null; startedAt: string; status: string; calls: number; cost: number };
export type CostReport = {
  generatedAt: string;
  window: { since: string; until: string; days: number };
  totals: Bucket;
  spaces: number;
  bySpace: Bucket[];
  byPurpose: Bucket[];
  byRole: Bucket[];
  byModel: Bucket[];
  longContext: { line: number; callsAbove: number; costAbove: number; callsAboveOnLongContextModels: number; costAboveOnLongContextModels: number };
  uploads: {
    events: number;
    documents: number;
    attributedCalls: number;
    attributedCost: number;
    bySubject: number;
    byTime: number;
    unattributedCalls: number;
    unattributedCost: number;
    costPerUpload: number | null;
    medianCostPerUpload: number | null; // one runaway upload moves the mean, not this
    costPerDocument: number | null;
    allInCostPerDocument: number | null;
    perUpload: UploadRow[];
  };
};

// SETTINGS
const PAGE = 1000;
const LONG_CONTEXT_LINE = 100_000; // Haiku's long-context line in lib/ai/pricing.ts
const DAY_MS = 86_400_000;

// =====================================================================
// READING (select only)
// =====================================================================

// A service-key client scoped to one space (none: the default space)
function client(spaceId?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (pass --env-file=.env.local).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: spaceId ? { "x-space-id": spaceId } : {} } });
}
type Db = ReturnType<typeof client>;

// Every live space, as the app's background workers list them
async function readSpaces(): Promise<string[]> {
  const { data, error } = await client().rpc("worker_spaces");
  if (error) throw new Error(`worker_spaces: ${error.message}`);
  return data as string[];
}

async function readCalls(db: Db, since: string, until: string): Promise<Call[]> {
  const rows: Call[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("ai_calls")
      .select("space_id,created_at,purpose,subject,model,role,status,prompt_tokens,completion_tokens,usage_details")
      .gte("created_at", since).lt("created_at", until).order("created_at").range(from, from + PAGE - 1);
    if (error) throw new Error(`ai_calls: ${error.message}`);
    rows.push(...(data as Call[]));
    if (data.length < PAGE) return rows;
  }
}

// Upload events that overlap the window, each with the span its pipeline ran
async function readUploads(db: Db, spaceId: string, since: string, until: string): Promise<UploadEvent[]> {
  const { data, error } = await db.from("shift_events")
    .select("id,created_at,finished_at,status,source_id,sources(title)")
    .eq("cause", "upload").lt("created_at", until).order("created_at");
  if (error) throw new Error(`shift_events: ${error.message}`);
  const events = (data as unknown as { id: string; created_at: string; finished_at: string | null; status: string; source_id: string | null; sources: { title: string } | null }[])
    .filter((event) => (event.finished_at ?? event.created_at) >= since);
  // The last pipeline step is a tighter end than finished_at, which a late resume or cleanup can push out by days
  const lastStep = new Map<string, number>();
  for (let index = 0; index < events.length; index += 100) {
    const ids = events.slice(index, index + 100).map((event) => event.id);
    const steps = await db.from("upload_steps").select("event_id,updated_at").in("event_id", ids);
    if (steps.error) throw new Error(`upload_steps: ${steps.error.message}`);
    for (const step of steps.data) lastStep.set(step.event_id, Math.max(lastStep.get(step.event_id) ?? 0, Date.parse(step.updated_at)));
  }
  return events.map((event) => {
    const start = Date.parse(event.created_at);
    const finished = event.finished_at ? Date.parse(event.finished_at) : null;
    const step = lastStep.get(event.id);
    const end = step && finished ? Math.min(step, finished) : step ?? finished ?? start;
    return { id: event.id, spaceId, created_at: event.created_at, finished_at: event.finished_at, status: event.status, source_id: event.source_id, title: event.sources?.title ?? null, start, end: Math.max(start, end) };
  });
}

// =====================================================================
// COSTING
// =====================================================================

function emptyBucket(key: string): Bucket {
  return { key, calls: 0, cost: 0, unpricedCalls: 0, promptTokens: 0, completionTokens: 0 };
}

function add(bucket: Bucket, call: Call, cost: number | null) {
  bucket.calls += 1;
  if (cost === null) bucket.unpricedCalls += 1;
  else bucket.cost += cost;
  bucket.promptTokens += call.prompt_tokens ?? 0;
  bucket.completionTokens += call.completion_tokens ?? 0;
}

function groupBy(calls: Call[], costs: (number | null)[], keyOf: (call: Call) => string): Bucket[] {
  const buckets = new Map<string, Bucket>();
  calls.forEach((call, index) => {
    const key = keyOf(call);
    const bucket = buckets.get(key) ?? emptyBucket(key);
    add(bucket, call, costs[index] ?? null);
    buckets.set(key, bucket);
  });
  return [...buckets.values()].sort((a, b) => b.cost - a.cost || b.calls - a.calls);
}

// =====================================================================
// TYING CALLS TO UPLOADS
// 1. Subject: the call names the uploaded file ("place_topics" on "3.1 ULA.docx").
// 2. Time: the call ran while one upload's pipeline was running; with overlaps,
//    the most recently started upload wins.
// Everything else (page rebuilds, glossary, composer, chat) stays unattributed.
// =====================================================================

function attribute(calls: Call[], events: UploadEvent[]): { eventOf: (string | null)[]; bySubject: number; byTime: number } {
  // Keyed by space and title, so a call never lands on another space's upload
  const byTitle = new Map<string, UploadEvent[]>();
  for (const event of events) if (event.title) byTitle.set(`${event.spaceId} ${event.title}`, [...(byTitle.get(`${event.spaceId} ${event.title}`) ?? []), event]);
  const titles = [...new Set(events.flatMap((event) => event.title ?? []))].sort((a, b) => b.length - a.length);
  let bySubject = 0;
  let byTime = 0;
  const eventOf = calls.map((call) => {
    const at = Date.parse(call.created_at);
    const title = call.subject ? titles.find((name) => byTitle.has(`${call.space_id} ${name}`) && (call.subject === name || call.subject!.includes(name))) : undefined;
    if (title) {
      const candidates = byTitle.get(`${call.space_id} ${title}`)!;
      const running = candidates.filter((event) => event.start <= at && at <= event.end).at(-1);
      const before = candidates.filter((event) => event.start <= at).at(-1);
      bySubject += 1;
      return (running ?? before ?? candidates[0]!).id;
    }
    const running = events.filter((event) => event.spaceId === call.space_id && event.start <= at && at <= event.end).at(-1);
    if (running) {
      byTime += 1;
      return running.id;
    }
    return null;
  });
  return { eventOf, bySubject, byTime };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// =====================================================================
// THE REPORT
// =====================================================================

export async function buildReport(since: Date, until: Date): Promise<CostReport> {
  const spaces = await readSpaces();
  const perSpace = await Promise.all(spaces.map(async (spaceId) => {
    const db = client(spaceId);
    return Promise.all([readCalls(db, since.toISOString(), until.toISOString()), readUploads(db, spaceId, since.toISOString(), until.toISOString())]);
  }));
  const calls = perSpace.flatMap(([spaceCalls]) => spaceCalls).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const events = perSpace.flatMap(([, spaceEvents]) => spaceEvents).sort((a, b) => a.start - b.start);
  const costs = calls.map((call) => estimateCallCost(call));
  const totals = emptyBucket("total");
  calls.forEach((call, index) => add(totals, call, costs[index] ?? null));

  const longContext = { line: LONG_CONTEXT_LINE, callsAbove: 0, costAbove: 0, callsAboveOnLongContextModels: 0, costAboveOnLongContextModels: 0 };
  calls.forEach((call, index) => {
    const tokens = call.prompt_tokens ?? 0;
    if (tokens > LONG_CONTEXT_LINE) {
      longContext.callsAbove += 1;
      longContext.costAbove += costs[index] ?? 0;
    }
    const line = priceFor(call.model)?.longContext?.above;
    if (line !== undefined && tokens > line) {
      longContext.callsAboveOnLongContextModels += 1;
      longContext.costAboveOnLongContextModels += costs[index] ?? 0;
    }
  });

  const { eventOf, bySubject, byTime } = attribute(calls, events);
  const perEvent = new Map(events.map((event) => [event.id, { eventId: event.id, title: event.title, startedAt: event.created_at, status: event.status, calls: 0, cost: 0 }]));
  let unattributedCalls = 0;
  let unattributedCost = 0;
  eventOf.forEach((eventId, index) => {
    const row = eventId ? perEvent.get(eventId) : undefined;
    if (!row) {
      unattributedCalls += 1;
      unattributedCost += costs[index] ?? 0;
      return;
    }
    row.calls += 1;
    row.cost += costs[index] ?? 0;
  });
  // Only uploads that started inside the window count; earlier ones only lend their tail
  const inWindow = events.filter((event) => event.start >= since.getTime());
  const documents = new Set(inWindow.map((event) => event.source_id ?? event.id)).size;
  const attributedCost = [...perEvent.values()].reduce((sum, row) => sum + row.cost, 0);
  const days = (until.getTime() - since.getTime()) / DAY_MS;

  return {
    generatedAt: new Date().toISOString(),
    window: { since: since.toISOString(), until: until.toISOString(), days: Math.round(days * 100) / 100 },
    totals,
    spaces: spaces.length,
    bySpace: groupBy(calls, costs, (call) => call.space_id),
    byPurpose: groupBy(calls, costs, (call) => call.purpose),
    byRole: groupBy(calls, costs, (call) => call.role ?? "(none)"),
    byModel: groupBy(calls, costs, (call) => call.model),
    longContext,
    uploads: {
      events: inWindow.length,
      documents,
      attributedCalls: calls.length - unattributedCalls,
      attributedCost,
      bySubject,
      byTime,
      unattributedCalls,
      unattributedCost,
      costPerUpload: inWindow.length ? attributedCost / inWindow.length : null,
      medianCostPerUpload: median(inWindow.map((event) => perEvent.get(event.id)!.cost)),
      costPerDocument: documents ? attributedCost / documents : null,
      allInCostPerDocument: documents ? totals.cost / documents : null,
      perUpload: [...perEvent.values()].filter((row) => row.calls > 0).sort((a, b) => b.cost - a.cost),
    },
  };
}

// =====================================================================
// PRINTING
// =====================================================================

const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "n/a");

function printBuckets(title: string, buckets: Bucket[], total: number, limit: number) {
  console.log(`\n${title}`);
  for (const bucket of buckets.slice(0, limit)) {
    const unpriced = bucket.unpricedCalls ? `, ${bucket.unpricedCalls} unpriced` : "";
    console.log(`  ${bucket.key.padEnd(40)} ${formatUsd(bucket.cost).padStart(10)}  ${percent(bucket.cost, total).padStart(6)}  ${String(bucket.calls).padStart(5)} calls${unpriced}`);
  }
  if (buckets.length > limit) console.log(`  … ${buckets.length - limit} more`);
}

function printReport(report: CostReport, limit: number) {
  const { totals, longContext, uploads } = report;
  console.log(`AI cost from ${report.window.since.slice(0, 16)} to ${report.window.until.slice(0, 16)} (${report.window.days} days)`);
  console.log(`Total: ${formatUsd(totals.cost)} over ${totals.calls} calls (${totals.unpricedCalls} unpriced, counted as $0)`);
  console.log(`Tokens: ${totals.promptTokens.toLocaleString("en-US")} in, ${totals.completionTokens.toLocaleString("en-US")} out`);
  printBuckets(`By space (${report.spaces} live spaces)`, report.bySpace, totals.cost, limit);
  printBuckets("By purpose", report.byPurpose, totals.cost, limit);
  printBuckets("By role", report.byRole, totals.cost, limit);
  printBuckets("By model", report.byModel, totals.cost, limit);
  console.log(`\nAbove ${longContext.line.toLocaleString("en-US")} prompt tokens: ${longContext.callsAbove} calls (${percent(longContext.callsAbove, totals.calls)}), ${formatUsd(longContext.costAbove)} (${percent(longContext.costAbove, totals.cost)} of cost)`);
  console.log(`  of which on models with a long-context rate: ${longContext.callsAboveOnLongContextModels} calls, ${formatUsd(longContext.costAboveOnLongContextModels)}`);
  console.log(`\nUploads started in the window: ${uploads.events} upload events, ${uploads.documents} distinct documents`);
  console.log(`  Tied to an upload: ${uploads.attributedCalls} calls, ${formatUsd(uploads.attributedCost)} (${uploads.bySubject} by file name, ${uploads.byTime} by time)`);
  console.log(`  Not tied to an upload: ${uploads.unattributedCalls} calls, ${formatUsd(uploads.unattributedCost)}`);
  console.log(`  Cost per upload event: ${formatUsd(uploads.costPerUpload)} (median ${formatUsd(uploads.medianCostPerUpload)})`);
  console.log(`  Cost per document: ${formatUsd(uploads.costPerDocument)} (all AI spend per document: ${formatUsd(uploads.allInCostPerDocument)})`);
  console.log("\nMost expensive uploads");
  for (const row of uploads.perUpload.slice(0, limit)) {
    console.log(`  ${row.startedAt.slice(0, 16)} ${(row.title ?? "(no source)").slice(0, 50).padEnd(50)} ${formatUsd(row.cost).padStart(10)}  ${String(row.calls).padStart(5)} calls  ${row.status}`);
  }
}

// One line per measure: baseline, now, and the change
function printComparison(baseline: CostReport, current: CostReport, limit: number) {
  const line = (label: string, before: number | null, after: number | null) => {
    const change = before !== null && after !== null && before !== 0 ? `${after >= before ? "+" : ""}${(((after - before) / before) * 100).toFixed(1)}%` : "n/a";
    console.log(`  ${label.padEnd(40)} ${formatUsd(before).padStart(10)}  ${formatUsd(after).padStart(10)}  ${change.padStart(8)}`);
  };
  console.log(`\nCompared with the baseline from ${baseline.window.since.slice(0, 10)} to ${baseline.window.until.slice(0, 10)}`);
  console.log(`  ${"measure".padEnd(40)} ${"baseline".padStart(10)}  ${"now".padStart(10)}  ${"change".padStart(8)}`);
  line("total", baseline.totals.cost, current.totals.cost);
  line("cost per upload event", baseline.uploads.costPerUpload, current.uploads.costPerUpload);
  line("median cost per upload event", baseline.uploads.medianCostPerUpload, current.uploads.medianCostPerUpload);
  line("cost per document", baseline.uploads.costPerDocument, current.uploads.costPerDocument);
  line("all AI spend per document", baseline.uploads.allInCostPerDocument, current.uploads.allInCostPerDocument);
  line("above the long-context line", baseline.longContext.costAbove, current.longContext.costAbove);
  console.log(`  calls ${baseline.totals.calls} then ${current.totals.calls}; documents ${baseline.uploads.documents} then ${current.uploads.documents}`);
  console.log("\n  By purpose (largest in either report)");
  const before = new Map(baseline.byPurpose.map((bucket) => [bucket.key, bucket.cost]));
  const after = new Map(current.byPurpose.map((bucket) => [bucket.key, bucket.cost]));
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => Math.max(after.get(b) ?? 0, before.get(b) ?? 0) - Math.max(after.get(a) ?? 0, before.get(a) ?? 0));
  for (const key of keys.slice(0, limit)) line(key, before.get(key) ?? 0, after.get(key) ?? 0);
}

// =====================================================================
// MAIN
// =====================================================================

const { values } = parseArgs({
  options: {
    days: { type: "string", default: "30" },
    since: { type: "string" },
    until: { type: "string" },
    json: { type: "boolean", default: false },
    out: { type: "string" },
    compare: { type: "string" },
    top: { type: "string", default: "15" },
  },
});

const until = values.until ? new Date(values.until) : new Date();
const since = values.since ? new Date(values.since) : new Date(until.getTime() - Number(values.days) * DAY_MS);
if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since >= until) throw new Error("Give a valid window: --days N, or --since and --until as dates.");
const limit = Number(values.top);

const report = await buildReport(since, until);
if (values.out) writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
if (values.json) console.log(JSON.stringify(report, null, 2));
else printReport(report, limit);
if (values.compare) printComparison(JSON.parse(readFileSync(values.compare, "utf8")) as CostReport, report, limit);
