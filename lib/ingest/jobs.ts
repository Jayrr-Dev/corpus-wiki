// Small idempotent upload jobs (issue 47, docs/upload-jobs-plan.md). Skeleton only:
// not wired into runUploadWorkflow, and the SQL functions it calls do not exist yet.
import type { DbRpc } from "@/lib/db/rpc";
import type { PipelineDeps } from "./pipeline";

export type UploadJobKind =
  | "reconcile" | "duplicates" | "tidy" | "place" | "hierarchy" | "expand" | "embeddings"
  | "plan" | "page" | "articles-ready" | "describe" | "profiles" | "glossary-entry" | "curate";

export type UploadJobState = "blocked" | "ready" | "running" | "succeeded" | "failed" | "cancelled";

// One row of public.upload_jobs
export type UploadJobRow = {
  id: string;
  event_id: string;
  kind: UploadJobKind;
  key: string;
  input: Record<string, unknown>;
  depends_on: string[];
  state: UploadJobState;
  provider: string | null;
  attempts: number;
};

// A job a finished job asks to enqueue. Same key twice is a no-op.
export type JobSpec = { kind: UploadJobKind; key: string; input?: Record<string, unknown>; dependsOn?: string[]; provider?: string };

// What a handler returns: its saved output, the jobs it fans out, and whether it raised an approval
export type JobOutcome = { output?: unknown; enqueue?: JobSpec[]; waiting?: boolean };

export type JobContext = { db: DbRpc; deps: PipelineDeps; job: UploadJobRow; signal: AbortSignal };
export type JobHandler = (context: JobContext) => Promise<JobOutcome>;

// The static graph a new upload starts with. Fan-out jobs (pages, glossary entries) are added by `plan` and `glossary`.
export const INITIAL_JOBS: JobSpec[] = [
  { kind: "reconcile", key: "reconcile" },
  { kind: "duplicates", key: "duplicates", dependsOn: ["reconcile"] },
  { kind: "tidy", key: "tidy", dependsOn: ["duplicates"] },
  { kind: "place", key: "place", dependsOn: ["tidy"] },
  { kind: "hierarchy", key: "hierarchy", dependsOn: ["place"] },
  { kind: "expand", key: "expand", dependsOn: ["hierarchy"] },
  { kind: "embeddings", key: "embeddings", dependsOn: ["expand"], provider: "embedding" },
  { kind: "plan", key: "plan", dependsOn: ["embeddings"] },
];

// Run one claimed job inside its lease. Returns once the job is finished or its lease is lost.
export async function runUploadJob(db: DbRpc, deps: PipelineDeps, handlers: Partial<Record<UploadJobKind, JobHandler>>, job: UploadJobRow, token: string): Promise<void> {
  const abort = new AbortController();
  const handler = handlers[job.kind];
  try {
    if (!handler) throw new Error(`No handler for upload job ${job.kind}`);
    const outcome = await handler({ db, deps, job, signal: abort.signal });
    await db.call("finish_upload_job", { p_job_id: job.id, p_token: token, p_output: outcome.output ?? null, p_enqueue: outcome.enqueue ?? [], p_waiting: !!outcome.waiting, p_error: null });
  } catch (error) {
    await db.call("finish_upload_job", { p_job_id: job.id, p_token: token, p_output: null, p_enqueue: [], p_waiting: false, p_error: error instanceof Error ? error.message : String(error) });
  } finally {
    abort.abort();
  }
}
