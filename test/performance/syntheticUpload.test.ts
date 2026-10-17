import { afterEach, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { DraftAction, DraftChangeSet, ReconciliationInput } from "@/lib/ai/types";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import { recordUpload, reconcileUpload, type PipelineDeps } from "@/lib/ingest/pipeline";
import { splitIntoPassages } from "@/lib/ingest/passages";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import { FakeSectionWriter, type SectionWriter } from "@/lib/living-page";
import { withRequestSlot } from "@/lib/processing/requests";
import { portablePostgres } from "@/test/db/portablePostgres";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

// Real migrations, change control, citations, leases, checkpoints and page writes.
// Only extraction and section prose use deterministic substitutes for paid AI.
it.runIf(process.env.PROCESSING_SYNTHETIC === "1")("processes generated documents, updates, simultaneous uploads and cancellation/resume in isolated PostgreSQL", async () => {
  vi.stubEnv("PROCESSING_SHARED_LIMITS", "false");
  vi.stubEnv("PROCESSING_CHAT_CONCURRENCY", "3");
  const network = vi.fn(() => { throw new Error("Synthetic processing must not access the network"); });
  vi.stubGlobal("fetch", network);
  const store = await portablePostgres();
  const fake = new FakeSectionWriter();
  const results: Record<string, unknown>[] = [];
  let totals: { claims: number; pages: number; sections: number; lines: number } | undefined;
  let active = 0, peak = 0;

  function fixture(name: string, entities: number, claimsEach: number, edition = 1, cancelAfter?: number) {
    const prefix = `Synthetic ${name}`;
    const rows = Array.from({ length: entities }, (_, entity) => Array.from({ length: claimsEach }, (_, claim) => ({
      name: `${prefix} group ${String(entity).padStart(2, "0")}`,
      key: `synthetic-${name}-${entity}`,
      kind: (["decision", "fact", "procedure"] as const)[claim % 3]!,
      text: `${prefix} group ${String(entity).padStart(2, "0")} records edition ${edition}, requirement ${claim}, at location ${entity}.`,
    }))).flat();
    let eventId = "", checkpoints = 0, cancelled = false, reviewed = 0, ownActive = 0;
    const savedBeforeCancel = new Set<string>();
    const rewrittenAfterResume: string[] = [];
    let resuming = false;
    const db: DbRpc = { async call<T>(fn: string, args: RpcArgs = {}) {
      if (resuming && fn === "start_upload_step" && String(args.p_key).startsWith("rebuild-section:")) {
        // Count actual executions below, rather than checkpoint probes.
        const result = await store.db.call<T & { done: boolean }>(fn, args);
        if (!result.done) rewrittenAfterResume.push(String(args.p_key));
        return result;
      }
      const result = await store.db.call<T>(fn, args);
      if (fn === "finish_upload_step" && args.p_error === null && String(args.p_key).startsWith("rebuild-section:")) {
        if (!resuming) savedBeforeCancel.add(String(args.p_key));
        if (cancelAfter && !cancelled && ++checkpoints === cancelAfter) {
          cancelled = true;
          await store.db.call("cancel_upload_workflow", { p_event_id: eventId });
        }
      }
      return result;
    } };
    const draft = vi.fn(async (input: ReconciliationInput): Promise<DraftChangeSet> => {
      const actions: DraftAction[] = [];
      for (const row of rows.filter((_row, index) => index % claimsEach === 0)) {
        if (!input.entities.some((entity) => entity.key === row.key)) actions.push({ type: "create_entity", targetId: null, expectedRevisionId: null,
          passageIds: [], speechAct: null, input: { type: "team", key: row.key, name: row.name, aliases: [] } });
      }
      for (const row of rows) {
        const passage = input.passages.find((value) => value.text === row.text);
        if (!passage) throw new Error("Generated claim has no matching source passage");
        actions.push({ type: "add_claim", targetId: null, expectedRevisionId: null, passageIds: [passage.id], speechAct: "stated",
          input: { content: row.text, kind: row.kind, epistemicStatus: "supported", validFrom: input.source.sourceDate,
            entities: [{ type: "team", key: row.key, role: "subject" }], domainPaths: [] } });
      }
      return { summary: `Synthetic ${name} edition ${edition}`, actions,
        trace: { modelVersion: "synthetic", promptVersion: "synthetic-v1", tokensIn: 0, tokensOut: 0 } };
    });
    const writer: SectionWriter = {
      name: "synthetic",
      reviseSection: (input) => withRequestSlot("chat", "synthetic.invalid", "synthetic-only", async (signal) => {
        active++; ownActive++; peak = Math.max(peak, active);
        try {
          await delay(5, undefined, { signal });
          if (input.sectionTitle === "Facts") expect(input.pageContext?.find((section) => section.section === "Decisions")?.text).toBeTruthy();
          if (input.sectionTitle === "How it works") expect(input.pageContext?.find((section) => section.section === "Facts")?.text).toBeTruthy();
          return await fake.reviseSection(input);
        } finally { active--; ownActive--; }
      }, uploadExecution.getStore()?.signal),
      async reviewSections(sectionIds) {
        expect(ownActive).toBe(0);
        const unfinished = await store.pg.query("select id from public.sections where id=any($1::uuid[]) and status<>'current'", [sectionIds]);
        expect(unfinished.rows).toHaveLength(0);
        reviewed++;
      },
    };
    const deps: PipelineDeps = { db, reconciler: { name: "synthetic", draftChangeSet: draft }, writer };
    return {
      prefix, rows, draft, savedBeforeCancel, rewrittenAfterResume,
      async start() {
        const started = await recordUpload(db, { title: `${prefix} edition ${edition}`, mimeType: "text/plain", sourceDate: "2026-10-16T00:00:00Z",
          hash: `synthetic:${name}:${edition}`, storagePath: `synthetic/${name}-${edition}.txt`, passages: splitIntoPassages([{ page: null, text: rows.map((row) => row.text).join("\n\n") }]) });
        if (started.kind !== "started") throw new Error("Expected a new synthetic source");
        eventId = started.eventId;
      },
      run: () => reconcileUpload(deps, eventId),
      resume() { resuming = true; return reconcileUpload(deps, eventId); },
      continuation: () => reconcileUpload(deps, eventId, "articles", true),
      async verify(expectedClaims: number) {
        const counts = await store.pg.query<{ pages: number; sections: number; lines: number; cited_lines: number; distinct_claims: number }>(`select
          count(distinct p.id)::int pages,count(distinct s.id)::int sections,count(distinct l.id)::int lines,
          count(distinct l.id) filter(where cardinality(r.unit_revision_ids)>0)::int cited_lines,
          count(distinct citation)::int distinct_claims
          from public.pages p join public.sections s on s.page_id=p.id
          left join public.lines l on l.section_id=s.id and l.retired_at is null
          left join public.line_revisions r on r.id=l.current_revision_id
          left join lateral unnest(r.unit_revision_ids) citation on true
          where p.title like $1 and p.retired_at is null and s.retired_at is null`, [`${prefix} group %`]);
        expect(counts.rows[0]).toEqual({ pages: entities, sections: entities * 3, lines: expectedClaims, cited_lines: expectedClaims, distinct_claims: expectedClaims });
        expect(reviewed).toBe(1);
        expect(draft).toHaveBeenCalledOnce();
        return counts.rows[0]!;
      },
    };
  }

  async function saveReport(status: "running" | "passed" | "failed" = "running") {
    await mkdir("artifacts/processing", { recursive: true });
    await writeFile("artifacts/processing/synthetic-upload.json", JSON.stringify({ generatedAt: new Date().toISOString(), status, kind: "isolated PostgreSQL with deterministic extraction and section prose", liveAiCalls: 0, totals, results }, null, 2) + "\n");
  }

  try {
    for (const [name, entities, claimsEach] of [["short", 8, 9], ["long", 16, 12]] as const) {
      const f = fixture(name, entities, claimsEach);
      await f.start();
      const started = performance.now();
      expect(await f.run()).toMatchObject({ error: null, workflow: { state: "complete" } });
      const counts = await f.verify(f.rows.length);
      // A repeated request must reuse checkpoints and create no second publication.
      expect(await f.run()).toMatchObject({ error: null, workflow: { state: "complete" } });
      expect(await f.verify(f.rows.length)).toEqual(counts);
      results.push({ scenario: name, claimsSubmitted: f.rows.length, ...counts, durationMs: Math.round(performance.now() - started), repeatedRunIdempotent: true });
      await saveReport();
    }
    const update = fixture("short", 8, 3, 2);
    await update.start();
    expect(await update.run()).toMatchObject({ error: null, workflow: { state: "complete" } });
    results.push({ scenario: "update existing pages", claimsSubmitted: update.rows.length, ...await update.verify(96) });
    await saveReport();

    const interrupted = fixture("cancel", 6, 9, 1, 3);
    await interrupted.start();
    expect(await interrupted.run()).toMatchObject({ workflow: { state: "incomplete", cancel_requested: true } });
    expect(interrupted.savedBeforeCancel.size).toBeGreaterThanOrEqual(3);
    const abandoned = await store.pg.query("select s.id from public.sections s join public.pages p on p.id=s.page_id where p.title like $1 and s.status='building'", [`${interrupted.prefix} group %`]);
    expect(abandoned.rows, "Cancelled workers must release their section claims before resume").toHaveLength(0);
    expect(await interrupted.continuation()).toMatchObject({ workflow: { state: "incomplete", cancel_requested: true } });
    const stoppedLines = (await store.pg.query<{ count: number }>("select count(*)::int count from public.lines where retired_at is null")).rows[0]!.count;
    await delay(25);
    expect((await store.pg.query<{ count: number }>("select count(*)::int count from public.lines where retired_at is null")).rows[0]!.count).toBe(stoppedLines);
    expect(await interrupted.resume()).toMatchObject({ error: null, workflow: { state: "complete", cancel_requested: false } });
    expect(interrupted.rewrittenAfterResume.some((key) => interrupted.savedBeforeCancel.has(key))).toBe(false);
    results.push({ scenario: "cancel and resume", claimsSubmitted: interrupted.rows.length, completedSectionsReused: interrupted.savedBeforeCancel.size,
      ...await interrupted.verify(interrupted.rows.length), automaticContinuationStayedCancelled: true });

    peak = 0;
    const pair = [fixture("concurrent-a", 6, 9), fixture("concurrent-b", 6, 9)];
    await Promise.all(pair.map((f) => f.start()));
    const outputs = await Promise.all(pair.map((f) => f.run()));
    outputs.forEach((output) => expect(output).toMatchObject({ error: null, workflow: { state: "complete" } }));
    expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(3);
    for (const f of pair) results.push({ scenario: f.prefix, claimsSubmitted: f.rows.length, ...await f.verify(f.rows.length), sharedRequestPeak: peak });
    expect(network).not.toHaveBeenCalled();
    totals = (await store.pg.query<NonNullable<typeof totals>>(`select
      (select count(*)::int from public.units u join public.revisions r on r.id=u.current_revision_id where u.retired_at is null and r.content like 'Synthetic %') claims,
      count(distinct p.id)::int pages,count(distinct s.id)::int sections,count(distinct l.id)::int lines
      from public.pages p join public.sections s on s.page_id=p.id
      join public.lines l on l.section_id=s.id and l.retired_at is null
      where p.title like 'Synthetic %' and p.retired_at is null and s.retired_at is null`)).rows[0];
    expect(totals).toEqual({ claims: 450, pages: 42, sections: 126, lines: 450 });
    await saveReport("passed");
  } catch (error) {
    await saveReport("failed");
    throw error;
  } finally { await store.pg.close(); }
}, 120_000);
