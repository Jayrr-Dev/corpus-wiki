import { withSettledActor } from "@/lib/auth/currentPerson";
import type { CommitResult } from "@/lib/change-control";
import { commitAsRole } from "@/lib/change-control";
import { processingCancellation } from "@/lib/processing/cancellation";
import { processingMetric, withProcessingReport } from "@/lib/processing/metrics";
import { KNOWLEDGE_JOB_KINDS, runUploadJobs, uploadJobsEnabled, type JobHandler, type UploadJobKind } from "./jobs";
import type { PipelineDeps } from "./pipeline";
import type { ProcessUploadResult } from "./types";
import { uploadExecution, workflowStep } from "./workflowContext";
import { KNOWLEDGE_STAGES, failedWorkflowStages, uploadErrorMessage, type UploadJob, type UploadWorkflow } from "./workflowTypes";

// AN UPLOAD SAVES KNOWLEDGE ONLY: the claims are read, saved, linked, merged, their entities
// tidied, filed into topics and indexed. Then the upload is complete and hands its event to
// the modules (module_upkeep), which bring definitions, articles, entity cards, the glossary
// and the page tree up to date on the background worker (lib/processing/moduleUpkeep.ts).
// How often a run renews its lease, and so how soon a cancel reaches an AI call in flight
const HEARTBEAT_MS = 5_000;
// With UPLOAD_JOBS, no new job starts after this long, so the one in flight still fits a 300 s request
const JOB_BUDGET_MS = 180_000;
// A failure of these is the upload's own error; a failed stage shows as a warning from its checkpoint
const FATAL_JOB_KINDS = new Set<UploadJobKind>(["reconcile", "coverage"]);

// `continuation`: started automatically after the knowledge job, so it never overrides a cancel.
export async function runUploadWorkflow(deps: PipelineDeps, eventId: string, reconcile: () => Promise<CommitResult>, job: UploadJob = "articles", continuation = false): Promise<ProcessUploadResult> {
  // Who is acting is read once: re-reading the request minutes later can hang (lib/auth/currentPerson.ts)
  return withProcessingReport(eventId, job, () => withSettledActor(() => runUploadWorkflowAs(deps, eventId, reconcile, job, continuation)), undefined,
    (result) => result.workflow?.cancel_requested ? "cancelled" : result.error ? "failed" : result.workflow?.waiting ? "waiting" : result.workflow?.state === "incomplete" ? "incomplete" : "succeeded");
}

async function runUploadWorkflowAs(deps: PipelineDeps, eventId: string, reconcile: () => Promise<CommitResult>, job: UploadJob, continuation: boolean): Promise<ProcessUploadResult> {
  const { db } = deps;
  processingCancellation.getStore()?.throwIfAborted();
  const claim = await db.call<{ claimed: boolean; token?: string; changeSetId?: string | null }>("claim_upload_workflow", { p_event_id: eventId, p_continue: continuation });
  if (!claim.claimed || !claim.token) return readResult();
  const token = claim.token;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatPending = false;
  let leaseError: unknown;
  let fatal: string | null = null;
  let resumeAfterRelease = false;
  // A lost lease or a cancel aborts the AI call in flight instead of waiting for it to finish
  const abort = new AbortController();
  const inherited = processingCancellation.getStore();
  const signal = inherited ? AbortSignal.any([inherited, abort.signal]) : abort.signal;
  let cancelledAt: number | undefined;
  const onAbort = () => { cancelledAt = performance.now(); };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  const checkLease = async () => {
    signal.throwIfAborted();
    if (leaseError) throw leaseError;
    await db.call("assert_upload_lease", { p_event_id: eventId, p_token: token });
  };
  try {
    heartbeat = setInterval(() => {
      if (heartbeatPending) return;
      heartbeatPending = true;
      void db.call("heartbeat_upload_workflow", { p_event_id: eventId, p_token: token })
        .catch((error) => { leaseError = error; abort.abort(error); }).finally(() => { heartbeatPending = false; });
    }, HEARTBEAT_MS);
    await uploadExecution.run({ eventId, token, db, signal }, async () => {
      const reconcileStage = () => timedStage(eventId, "reconcile", async () => {
        await checkLease();
        return claim.changeSetId ? commitAsRole(db, "reconciler", claim.changeSetId) : reconcile();
      });
      const run: Record<(typeof KNOWLEDGE_STAGES)[number], () => Promise<unknown>> = {
        duplicates: async () => deps.deduper?.(eventId),
        tidy: async () => deps.entityTidier?.(eventId),
        place: async () => deps.topicPlacer?.(eventId),
        hierarchy: async () => deps.hierarchyOrganizer?.(eventId),
        embeddings: async () => deps.claimEmbedder?.(),
      };
      // The knowledge is saved: the modules take it from here, once per upload
      const complete = async () => {
        await db.call("enqueue_module_upkeep", { p_event_id: eventId });
        await release("complete");
      };
      // Claims still unfiled after placement leave the upload unfinished. Rejecting a proposed
      // root can leave claims unfiled after the placement stage itself completed.
      const unplacedError = async () => {
        if (!deps.topicPlacer) return null;
        const coverage = await db.call<{ unplaced: string[] }>("verify_upload_topic_coverage", { p_event_id: eventId });
        return coverage.unplaced.length ? `${coverage.unplaced.length} knowledge units still need domain assignments. Assign them, then resume.` : null;
      };
      if (uploadJobsEnabled()) {
        const stage = (key: keyof typeof run): JobHandler => async () => { await timedStage(eventId, key, run[key]); };
        const handlers: Partial<Record<UploadJobKind, JobHandler>> = {
          reconcile: async () => { await reconcileStage(); },
          duplicates: stage("duplicates"), tidy: stage("tidy"), place: stage("place"),
          coverage: async () => { const error = await unplacedError(); if (error) throw new Error(error); },
          hierarchy: stage("hierarchy"), embeddings: stage("embeddings"),
        };
        const result = await runUploadJobs(db, eventId, token, {
          kinds: KNOWLEDGE_JOB_KINDS, handlers, checkLease, retry: !continuation, budgetMs: JOB_BUDGET_MS,
        });
        if (result.failed && FATAL_JOB_KINDS.has(result.failed.kind)) fatal = result.failed.error;
        if (result.state === "complete") await complete();
        else await release(result.state);
        return;
      }
      await reconcileStage();
      if (await db.call<boolean>("upload_workflow_waiting", { p_event_id: eventId })) {
        await release("waiting");
        return;
      }
      // Completed roles are not repeated on resume
      let failed = false;
      for (const key of KNOWLEDGE_STAGES) {
        await checkLease();
        try { await timedStage(eventId, key, run[key]); }
        catch { failed = true; break; }
        // Filing may propose a new root: the rest waits for that approval, as after the save
        if (key === "place" && await db.call<boolean>("upload_workflow_waiting", { p_event_id: eventId })) {
          await release("waiting");
          return;
        }
        // Recheck even on a checkpoint hit
        if (key === "place") {
          fatal = await unplacedError();
          if (fatal) { failed = true; break; }
        }
      }
      if (failed) await release("incomplete");
      else await complete();
    });
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    await release("incomplete");
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    signal.removeEventListener("abort", onAbort);
    if (cancelledAt !== undefined) processingMetric("cancel.drain", performance.now() - cancelledAt);
  }
  if (resumeAfterRelease) return runUploadWorkflowAs(deps, eventId, reconcile, job, continuation);
  return readResult(fatal);

  async function release(state: "waiting" | "complete" | "incomplete") {
    resumeAfterRelease = await db.call<boolean>("release_upload_workflow", { p_event_id: eventId, p_token: token, p_state: state, p_error: fatal });
  }
  async function readResult(error: string | null = null): Promise<ProcessUploadResult> {
    const [workflow] = await db.call<UploadWorkflow[]>("read_upload_workflows", { p_event_ids: [eventId] });
    const knowledge = await db.call<CommitResult | null>("upload_knowledge_result", { p_event_id: eventId });
    const warnings = workflow ? failedWorkflowStages(workflow).map((step) => `${step.key}: ${step.error}`) : [];
    return {
      status: knowledge?.eventStatus ?? (error || warnings.length ? "failed" : "received"),
      changeSetId: knowledge?.changeSetId ?? null,
      error: [...new Set([error ?? workflow?.error, ...warnings].filter(Boolean).map(message=>uploadErrorMessage(message)))].join("\n") || null,
      workflow,
    };
  }
}

// Time actual stage execution; checkpoint hits on resume do not look like fresh runs.
async function timedStage<T>(eventId: string, stage: string, run: () => Promise<T>): Promise<T> {
  return workflowStep(stage, async () => {
    const startedAt = performance.now();
    let status = "failed";
    try {
      const result = await run();
      status = "succeeded";
      return result;
    } finally {
      console.info("Upload stage timing", { eventId, stage, status, durationMs: Math.round(performance.now() - startedAt) });
    }
  });
}
