// Small idempotent upload jobs (issue 47, docs/upload-jobs-plan.md), on with UPLOAD_JOBS=true.
// Step 3 of the plan: each stage of runUploadWorkflow is one job, in a fixed chain. A job runs
// inside the upload's lease, so its lease checks, checkpoints and idempotent writes are unchanged.
import type { DbRpc } from "@/lib/db/rpc";

export type UploadJobKind =
  | "reconcile" | "duplicates" | "tidy" | "place" | "coverage" | "hierarchy" | "expand" | "embeddings"
  | "plan" | "pages" | "articles-ready" | "describe" | "profiles" | "glossary" | "curate" | "verify"
  // Fan-out, a later step: one job per page and per glossary entry
  | "page" | "glossary-entry";

export type UploadJobState = "blocked" | "ready" | "running" | "succeeded" | "failed" | "cancelled";

// One row of public.upload_jobs, as claim_upload_job returns it
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

// A job to enqueue. Same key twice is a no-op.
export type JobSpec = { kind: UploadJobKind; key: string; input?: Record<string, unknown>; dependsOn?: string[]; provider?: string };

// What a handler returns: its saved output and the jobs it fans out. `again`: the job raised an
// approval and runs once more after it, to read the answer (the Reviewer budget after `plan`).
export type JobOutcome = { output?: unknown; enqueue?: JobSpec[]; again?: boolean };
export type JobHandler = (job: UploadJobRow) => Promise<JobOutcome | void>;

export const uploadJobsEnabled = (env: Record<string, string | undefined> = process.env) => env.UPLOAD_JOBS === "true";

// The order runUploadWorkflow walks today. `coverage` and `verify` were checks between stages.
const CHAIN: UploadJobKind[] = [
  "reconcile", "duplicates", "tidy", "place", "coverage", "hierarchy", "expand", "embeddings",
  "plan", "pages", "articles-ready", "describe", "profiles", "glossary", "curate", "verify",
];
export const KNOWLEDGE_JOB_KINDS: UploadJobKind[] = CHAIN.slice(0, CHAIN.indexOf("plan"));
export const ALL_JOB_KINDS: UploadJobKind[] = [...CHAIN, "page", "glossary-entry"];

// The graph a new upload starts with: each job waits for the one before it
export const INITIAL_JOBS: JobSpec[] = CHAIN.map((kind, index) => ({
  kind, key: kind, ...(index ? { dependsOn: [CHAIN[index - 1]!] } : {}), ...(kind === "embeddings" ? { provider: "embedding" } : {}),
}));

export type JobRunResult = { state: "waiting" | "complete" | "incomplete"; failed?: { kind: UploadJobKind; error: string; caught: unknown } };

// Runs this upload's ready jobs among `kinds`, one at a time, until none is left, one fails,
// the upload waits for an approval or the budget is spent. A job already started is finished first;
// once the budget is spent the upload is left incomplete and recovery claims it again.
export async function runUploadJobs(db: DbRpc, eventId: string, token: string, options: {
  kinds: UploadJobKind[];
  handlers: Partial<Record<UploadJobKind, JobHandler>>;
  checkLease: () => Promise<void>;
  // A person's Resume runs failed and cancelled jobs again; an automatic continuation does not
  retry: boolean;
  budgetMs?: number;
}): Promise<JobRunResult> {
  const startedAt = performance.now();
  await db.call("enqueue_upload_jobs", { p_event_id: eventId, p_token: token, p_jobs: INITIAL_JOBS });
  if (options.retry) await db.call("reset_upload_jobs", { p_event_id: eventId, p_token: token });
  for (;;) {
    if (options.budgetMs !== undefined && performance.now() - startedAt > options.budgetMs) return { state: "incomplete" };
    await options.checkLease();
    const job = await db.call<UploadJobRow | null>("claim_upload_job", { p_event_id: eventId, p_token: token, p_kinds: options.kinds });
    if (!job) break;
    let outcome: JobOutcome | void;
    try {
      const handler = options.handlers[job.kind];
      if (!handler) throw new Error(`No handler for upload job ${job.kind}`);
      outcome = await handler(job);
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught);
      await finishJob(db, job, token, { error });
      return { state: "incomplete", failed: { kind: job.kind, error, caught } };
    }
    await finishJob(db, job, token, { output: outcome?.output, enqueue: outcome?.enqueue, again: outcome?.again });
    if (await db.call<boolean>("upload_workflow_waiting", { p_event_id: eventId })) return { state: "waiting" };
  }
  const counts = await db.call<Partial<Record<UploadJobState, number>>>("upload_job_counts", { p_event_id: eventId });
  const unfinished = Object.entries(counts).some(([state, count]) => state !== "succeeded" && (count ?? 0) > 0);
  return { state: unfinished ? "incomplete" : "complete" };
}

async function finishJob(db: DbRpc, job: UploadJobRow, token: string, result: { output?: unknown; enqueue?: JobSpec[]; again?: boolean; error?: string }) {
  await db.call("finish_upload_job", {
    p_job_id: job.id, p_token: token, p_output: result.output ?? null, p_enqueue: result.enqueue ?? [],
    p_again: !!result.again, p_error: result.error ?? null,
  });
}
