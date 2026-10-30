import type { DraftChangeSet, ReconciliationInput } from "@/lib/ai/types";
import { FakeSectionWriter } from "@/lib/living-page";
import { portablePostgres } from "@/test/db/portablePostgres";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ALL_JOB_KINDS, INITIAL_JOBS, runUploadJobs } from "./jobs";
import type { DbRpc } from "@/lib/db/rpc";
import { splitIntoPassages } from "./passages";
import { reconcileUpload, recordUpload, type PipelineDeps } from "./pipeline";

// =====================================================================
// UPLOAD JOBS (issue #47, UPLOAD_JOBS=true): each knowledge stage is one job
// in public.upload_jobs, run in order inside the upload's lease; the finished
// upload hands its knowledge to the modules (lib/processing/moduleUpkeep.ts).
// =====================================================================

let store: Awaited<ReturnType<typeof portablePostgres>>;
beforeAll(async () => { store = await portablePostgres(); });
afterAll(async () => { await store.pg.close(); });
beforeEach(async () => { await store.pg.exec("begin"); vi.stubEnv("UPLOAD_JOBS", "true"); });
afterEach(async () => { vi.unstubAllEnvs(); await store.pg.exec("rollback"); });

async function upload() {
  const result = await recordUpload(store.db, {
    title: "Jobs team", mimeType: "text/plain", sourceDate: "2026-10-16T00:00:00Z", hash: `jobs-${crypto.randomUUID()}`, storagePath: "test/jobs.txt",
    passages: splitIntoPassages([{ page: null, text: "Jobs team ships weekly. Jobs team keeps a changelog." }]),
  });
  if (result.kind !== "started") throw new Error("Expected new upload");
  return result;
}
function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  const draftChangeSet = vi.fn(async (input: ReconciliationInput): Promise<DraftChangeSet> => ({
    summary: "Jobs team", trace: { modelVersion: "fixture", promptVersion: "v1", tokensIn: 10, tokensOut: 10 },
    actions: [
      { type: "create_entity", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null,
        input: { type: "team", key: "jobs-team", name: "Jobs team", aliases: [] } },
      ...["Jobs team ships weekly.", "Jobs team keeps a changelog."].map((content) => ({
        type: "add_claim" as const, targetId: null, expectedRevisionId: null, passageIds: [input.passages[0]!.id], speechAct: "stated" as const,
        input: { content, kind: "fact" as const, epistemicStatus: "supported" as const, validFrom: input.source.sourceDate,
          entities: [{ type: "team", key: "jobs-team", role: "subject" as const }], domainPaths: [] },
      })),
    ],
  }));
  return { db: store.db, reconciler: { name: "fixture", draftChangeSet }, writer: new FakeSectionWriter(),
    entityDescriber: vi.fn(async () => {}), claimEmbedder: vi.fn(async () => {}), hierarchyOrganizer: vi.fn(async () => {}), deduper: vi.fn(async () => {}), ...overrides };
}
async function jobs(eventId: string) {
  return (await store.pg.query<{ key: string; state: string; attempts: number; last_error: string | null }>(
    "select key,state,attempts,last_error from public.upload_jobs where event_id=$1 order by created_at,key", [eventId])).rows;
}
const stateOf = async (eventId: string, key: string) => (await jobs(eventId)).find((job) => job.key === key)?.state;

it("runs every stage as one job, in order, and completes the upload", async () => {
  const source = await upload();
  const result = await reconcileUpload(deps(), source.eventId);
  expect(result.error).toBeNull();
  expect(result.workflow?.state).toBe("complete");
  const rows = await jobs(source.eventId);
  expect(rows.map((job) => job.key).sort()).toEqual(INITIAL_JOBS.map((job) => job.key).sort());
  expect(rows.every((job) => job.state === "succeeded" && job.attempts === 1)).toBe(true);
});

it("hands a finished upload's knowledge to every module, once", async () => {
  const source = await upload(); const pipeline = deps();
  expect((await reconcileUpload(pipeline, source.eventId)).workflow?.state).toBe("complete");
  expect((await reconcileUpload(pipeline, source.eventId, "articles", true)).workflow?.state).toBe("complete");
  const modules = (await store.pg.query<{ module: string; state: string }>("select module, state from public.module_upkeep where event_id=$1 order by module", [source.eventId])).rows;
  expect(modules).toEqual(["curator", "definitions", "entities", "glossary", "wiki"].map((module) => ({ module, state: "ready" })));
  expect(pipeline.reconciler.draftChangeSet).toHaveBeenCalledTimes(1);
});

it("a failed stage stops its dependents; Resume runs only that job and what follows", async () => {
  const source = await upload();
  const deduper = vi.fn().mockRejectedValueOnce(new Error("deduper down")).mockResolvedValue(undefined);
  const pipeline = deps({ deduper });
  const failed = await reconcileUpload(pipeline, source.eventId);
  expect(failed.workflow?.state).toBe("incomplete");
  expect(failed.error).toContain("deduper down");
  expect(await stateOf(source.eventId, "duplicates")).toBe("failed");
  expect(await stateOf(source.eventId, "tidy")).toBe("blocked");
  // Nothing goes to the modules until the knowledge is saved
  expect((await store.pg.query("select 1 from public.module_upkeep where event_id=$1", [source.eventId])).rows).toHaveLength(0);
  // An automatic continuation never retries a failed job
  expect((await reconcileUpload(pipeline, source.eventId, "articles", true)).workflow?.state).toBe("incomplete");
  expect(deduper).toHaveBeenCalledTimes(1);
  const resumed = await reconcileUpload(pipeline, source.eventId);
  expect(resumed.workflow?.state).toBe("complete");
  expect(deduper).toHaveBeenCalledTimes(2);
  expect(pipeline.reconciler.draftChangeSet).toHaveBeenCalledTimes(1);
});

it("a cancel stops every job that has not started", async () => {
  const source = await upload();
  const pipeline = deps({ deduper: vi.fn().mockRejectedValueOnce(new Error("deduper down")).mockResolvedValue(undefined) });
  await reconcileUpload(pipeline, source.eventId);
  expect(await store.db.call("cancel_upload_workflow", { p_event_id: source.eventId })).toBe("cancelled");
  const rows = await jobs(source.eventId);
  expect(rows.filter((job) => job.state === "cancelled").map((job) => job.key)).toContain("tidy");
  expect(rows.some((job) => job.state === "ready" || job.state === "blocked")).toBe(false);
  // A person's Resume clears the cancel and runs the rest
  expect((await reconcileUpload(pipeline, source.eventId)).workflow?.state).toBe("complete");
});

it("a job left running by a lost owner is handed out again, with the same key", async () => {
  const source = await upload();
  const pipeline = deps({ deduper: vi.fn().mockRejectedValueOnce(new Error("deduper down")).mockResolvedValue(undefined) });
  await reconcileUpload(pipeline, source.eventId);
  // An owner that died mid-job: its job stays running under a token nobody holds
  await store.pg.query("update public.upload_jobs set state='running',token=gen_random_uuid() where event_id=$1 and key='duplicates'", [source.eventId]);
  expect((await reconcileUpload(pipeline, source.eventId)).workflow?.state).toBe("complete");
  const duplicates = (await jobs(source.eventId)).find((job) => job.key === "duplicates")!;
  expect(duplicates.state).toBe("succeeded");
});

it("reports complete, not incomplete, when time runs out after the last job", async () => {
  const counts = { succeeded: INITIAL_JOBS.length };
  const call = vi.fn(async (name: string) => (name === "upload_job_counts" ? counts : null));
  const db = { call: call as DbRpc["call"] };
  const result = await runUploadJobs(db, "event", "token", { kinds: ALL_JOB_KINDS, handlers: {}, checkLease: async () => {}, retry: false, budgetMs: -1 });
  expect(result).toEqual({ state: "complete" });
  expect(call).not.toHaveBeenCalledWith("claim_upload_job", expect.anything());
});
