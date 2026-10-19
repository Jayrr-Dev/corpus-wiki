import { expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { chatJson, type ChatMessage } from "@/lib/ai/chat";
import type { DbRpc } from "@/lib/db/rpc";
import type { UploadTopicContext } from "@/lib/domains/uploadAssignment";
import { topicPlacerFor } from "@/lib/ingest/placeTopicsServer";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/chat", async (original) => ({ ...await original<typeof import("@/lib/ai/chat")>(), chatJson: vi.fn() }));
vi.mock("@/lib/ai/skills/server", () => ({ loadRoleInstructions: async () => [] }));

// OFFLINE REPLAY of a book-sized upload's domain filing (shaped like the 1,877-claim
// Enneagram PDF): request sizes and calls per batch, with a deterministic reviewer
// that rejects every third batch once and slips on the parents format every fifth.
// Tokens are estimated at four characters each; no network or database is used.
const TYPES = Array.from({ length: 9 }, (_, i) => `Type ${i + 1}`);
const ASPECTS = ["Motivations", "Fears", "Growth paths", "Stress patterns", "Relationships", "Wings"];
const words = (seed: number, n: number) => Array.from({ length: n }, (_, i) => `term${(seed * 31 + i * 7) % 400}`).join(" ");

function syntheticContext(claimCount: number, savedCount: number): UploadTopicContext {
  const domains = [{ id: "d0", name: "Enneagram", path: "Enneagram", parent_id: null, retired_at: null, context_entity_id: null },
    ...TYPES.flatMap((type, t) => [{ id: `d${t}`, name: type, path: `Enneagram/${type}`, parent_id: "d0", retired_at: null, context_entity_id: null },
      ...ASPECTS.slice(0, 3).map((aspect, a) => ({ id: `d${t}-${a}`, name: aspect, path: `Enneagram/${type}/${aspect}`, parent_id: `d${t}`, retired_at: null, context_entity_id: null }))])]
    .filter((d, i, all) => all.findIndex((x) => x.id === d.id) === i);
  const vocabulary = (t: number, i: number) => `${TYPES[t]} enneagram personality ${ASPECTS[i % ASPECTS.length]} ${words(t * 50 + (i % 5), 30)}`;
  const saved = Array.from({ length: savedCount }, (_, i) => ({ id: `s${i}`, revisionId: `sr${i}`, content: `Saved claim ${i}: ${vocabulary(i % 9, i)}.`, retiredAt: null }));
  const claims = Array.from({ length: claimCount }, (_, i) => ({ unitId: `u${i}`, title: `${TYPES[i % 9]} ${ASPECTS[i % 6]} insight ${i}`, content: `Claim ${i}: ${vocabulary(i % 9, i)}.`, entities: [TYPES[i % 9]!, "Enneagram"] }));
  return {
    claims, domainPaths: domains.map((d) => d.path), domainTabs: [], sourceTitle: "Understanding the Archetypes (synthetic)",
    sourceSections: Array.from({ length: 320 }, (_, i) => ({ position: i, location: { page: i + 1, heading: `Chapter ${Math.floor(i / 20) + 1}` } })),
    revisions: [...claims.map((c, i) => ({ unitId: c.unitId, revisionId: `r${i}` })), ...saved.map((s) => ({ unitId: s.id, revisionId: s.revisionId }))],
    evidence: claims.map((c, i) => ({ unitId: c.unitId, passages: [{ location: { page: Math.floor(i / 6) + 1 }, text: `Passage ${Math.floor(i / 6)}: ${words(i, 120)}` }] })),
    snapshot: { domains, claims: saved, unitDomains: saved.map((s, i) => ({ unit_id: s.id, domain_id: `d${i % 9}-${i % 3}` })) } as UploadTopicContext["snapshot"],
    connections: claims.flatMap((c, i) => i % 2 ? [{ from: c.unitId, to: claims[(i + 9) % claims.length]!.unitId, type: "related_to" }] : []),
    vectors: [],
  };
}

const text = (messages: (ChatMessage | { content: unknown })[]) => messages.map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");
const findJson = (messages: { content: unknown }[], key: string) => {
  for (const m of [...messages].reverse()) {
    if (typeof m.content !== "string") continue;
    try { const v = JSON.parse(m.content); if (v && typeof v === "object" && key in v) return v; } catch { /* not JSON */ }
  }
  throw new Error(`No message with ${key}`);
};

it.runIf(process.env.PROCESSING_BENCHMARK === "1")("replays book-sized domain filing offline and records request sizes", async () => {
  const context = syntheticContext(Number(process.env.FILING_BENCH_CLAIMS ?? 1877), 900);
  const typeOf = (ref: string) => (Number(ref.slice(1)) - 1) % 9;
  const calls: { name: string; chars: number; cached: number }[] = [];
  const reviewed = new Map<number, number>();
  vi.mocked(chatJson).mockImplementation(async (_settings, request) => {
    const all = text(request.messages);
    // The cacheable prefix on Claude: every system message, then a user block marked cache.
    const cached = text(request.messages.filter((m) => m.role === "system")).length
      + request.messages.filter((m) => m.role === "user" && typeof m.content === "string" && (m as ChatMessage & { cache?: boolean }).cache).reduce((n, m) => n + (m.content as string).length, 0);
    let value: unknown;
    if (request.name === "upload_domain_plan") {
      const payload = findJson(request.messages, "claims");
      value = { groups: TYPES.map((type, t) => ({ scopePath: "Enneagram", subject: type, reason: `${type} material`, refs: payload.claims.map((c: { ref: string }) => c.ref).filter((r: string) => typeOf(r) === t) })).filter((g) => g.refs.length) };
    } else if (request.name === "place_topics") {
      if (process.env.FILING_BENCH_DEBUG && !calls.some((c) => c.name === "place_topics")) {
        const payload = findJson(request.messages, "claims");
        const size = (v: unknown) => Math.round(JSON.stringify(v ?? null).length / 4);
        await mkdir("artifacts/processing", { recursive: true });
        await writeFile("artifacts/processing/domain-filing-payload.json", JSON.stringify(Object.fromEntries([...Object.entries(payload), ...Object.entries(payload.context ?? {}).map(([k, v]) => [`context.${k}`, v])].map(([k, v]) => [k, size(v)])), null, 2));
      }
      const refs = JSON.parse(/Required answer refs[^[]*(\[.*\])/s.exec(all)![1]!) as string[];
      value = { placements: refs.map((ref) => ({ ref, domainPaths: [`Enneagram/${TYPES[typeOf(ref)]}/${ASPECTS[(Number(ref.slice(1)) - 1) % 6]}`] })) };
    } else if (request.name === "independent_upload_domain_review") {
      const payload = findJson(request.messages, "parents");
      const key = String(payload.proposal?.[0]?.ref ?? payload.parents?.[0]?.refs?.[0]);
      const first = Number(key.slice(1));
      const seen = reviewed.get(first) ?? 0;
      reviewed.set(first, seen + 1);
      const index = Math.floor(first / 80);
      const parents = payload.parents.map((p: object) => ({ ...p, reason: "Coherent subject group." }));
      if (seen === 0 && index % 3 === 0 && payload.proposal?.length > 4) {
        const flagged = payload.proposal.slice(0, 4).map((c: { ref: string }) => c.ref);
        value = { approved: false, issues: [`${flagged.join(", ")} belong in a narrower subject child.`], parents };
      } else if (seen === 0 && index % 5 === 1 && parents.length > 1) value = { approved: true, issues: [], parents: parents.slice(1) };
      else value = { approved: true, issues: [], parents };
    } else if (request.name === "independent_upload_domain_issue_check") {
      const payload = findJson(request.messages, "issues");
      value = { verdicts: payload.issues.map((i: { issue: number }) => ({ issue: i.issue, blocking: true, reason: "The defect is concrete." })) };
    } else if (request.name === "domain_duplicate_review") value = { duplicateOf: null, reason: "Different subject." };
    else throw new Error(`Unexpected call ${request.name}`);
    calls.push({ name: request.name, chars: all.length, cached: Math.min(cached, all.length) });
    return { value, model: "bench", tokensIn: Math.round(all.length / 4), tokensOut: 200 } as never;
  });
  const db: DbRpc = { async call<T>(fn: string): Promise<T> {
    if (fn === "upload_topic_context") return context as T;
    if (fn === "verify_upload_topic_coverage") return { unplaced: [] } as T;
    if (fn === "submit_change_set") return { changeSetId: "cs", eventId: "e" } as T;
    if (fn === "commit_upload_topics") return { changeSetId: "cs", status: "applied", applied: 1, exceptions: 0, rejected: 0, eventStatus: "applied" } as T;
    if (fn === "upload_workflow_waiting") return false as T;
    if (fn === "auto_accept_exceptions") return [] as T;
    throw new Error(`Unexpected RPC ${fn}`);
  } };
  await topicPlacerFor(db, { apiKey: "bench" })("event");
  const byName = Object.entries(Object.groupBy(calls, (c) => c.name)).map(([name, list]) => ({
    name, calls: list!.length,
    avgTokensIn: Math.round(list!.reduce((n, c) => n + c.chars, 0) / list!.length / 4),
    maxTokensIn: Math.round(Math.max(...list!.map((c) => c.chars)) / 4),
    avgCacheablePrefix: Math.round(list!.reduce((n, c) => n + c.cached, 0) / list!.length / 4),
  }));
  const batches = Math.ceil(context.claims.length / 80);
  const filingCalls = calls.filter((c) => c.name === "place_topics" || c.name === "independent_upload_domain_review" || c.name === "independent_upload_domain_issue_check").length;
  const result = { kind: "offline synthetic domain filing replay (chars/4 token estimate)", generatedAt: new Date().toISOString(), claims: context.claims.length, batches, filingCallsPerBatch: Math.round(filingCalls / batches * 100) / 100,
    totalTokensIn: Math.round(calls.reduce((n, c) => n + c.chars, 0) / 4), byName };
  console.table(byName);
  console.log(JSON.stringify(result, null, 2));
  await mkdir("artifacts/processing", { recursive: true });
  await writeFile(`artifacts/processing/domain-filing-benchmark${process.env.FILING_BENCH_LABEL ? `-${process.env.FILING_BENCH_LABEL}` : ""}.json`, JSON.stringify(result, null, 2) + "\n");
  expect(calls.length).toBeGreaterThan(0);
}, 600_000);
