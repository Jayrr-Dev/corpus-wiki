import { withSettledActor } from "@/lib/auth/currentPerson";
import { processingMetric, withProcessingReport } from "@/lib/processing/metrics";
import { processingCancellation } from "@/lib/processing/cancellation";
import type { CommitResult } from "@/lib/change-control";
import { commitAsRole } from "@/lib/change-control";
import { proposePages, rebuildAfterEvent } from "@/lib/living-page";
import type { PipelineDeps } from "./pipeline";
import type { ProcessUploadResult } from "./types";
import { uploadExecution, workflowStep } from "./workflowContext";
import { ARTICLE_STAGES, ENRICHMENT_STAGES, KNOWLEDGE_STAGES, type UploadJob, type UploadWorkflow } from "./workflowTypes";

// The articles job also walks the knowledge roles: finished ones come back from their
// checkpoints, unfinished ones run first, so articles never read half-cleaned knowledge.
// How often a run renews its lease, and so how soon a cancel reaches an AI call in flight
const HEARTBEAT_MS = 5_000;

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
      void checkLease().catch((error) => { leaseError = error; abort.abort(error); }).finally(() => { heartbeatPending = false; });
    }, HEARTBEAT_MS);
    await uploadExecution.run({ eventId, token, db, signal }, async () => {
      await timedStage(eventId, "reconcile", async () => {
        await checkLease();
        return claim.changeSetId ? commitAsRole(db, "reconciler", claim.changeSetId) : reconcile();
      });
      if (await db.call<boolean>("upload_workflow_waiting", { p_event_id: eventId })) {
        await release("waiting");
        return;
      }
      type ArticleInput = { unitId: string; revisionId: string };
      const articleInputs = () => db.call<ArticleInput[]>("upload_article_inputs", { p_event_id: eventId });
      const enrichmentUnits = () => workflowStep("enrichment-input", async () => {
        const before = new Map((await workflowStep("articles-input", articleInputs)).map((unit) => [unit.unitId, unit.revisionId]));
        return (await articleInputs()).filter((unit) => before.get(unit.unitId) !== unit.revisionId).map((unit) => unit.unitId);
      });
      const run: Record<(typeof KNOWLEDGE_STAGES)[number] | (typeof ARTICLE_STAGES)[number] | (typeof ENRICHMENT_STAGES)[number] | "articles-ready", () => Promise<unknown>> = {
        embeddings: async () => deps.claimEmbedder?.(),
        // Cleanup can revise the surviving claim. Its original vector describes
        // an old revision; refresh before article review searches for evidence.
        "embeddings-cleaned": async () => deps.claimEmbedder?.(),
        tidy: async () => deps.entityTidier?.(eventId),
        describe: async () => deps.entityDescriber?.(eventId),
        profiles: async () => deps.profileWriter?.(eventId),
        duplicates: async () => deps.deduper?.(eventId),
        place: async () => deps.topicPlacer?.(eventId),
        hierarchy: async () => deps.hierarchyOrganizer?.(eventId),
        glossary: async () => deps.glossaryGenerator?.(),
        expand: async () => deps.knowledgeExpander?.(eventId),
        "embeddings-enrichment": async () => {
          if ((await enrichmentUnits()).length) await deps.claimEmbedder?.();
        },
        plan: async () => {
          const refreshed = await proposePages(db, eventId, deps.pagePlanner);
          await deps.articleOrchestrator?.(eventId);
          return refreshed;
        },
        pages: async () => {
          await rebuildAfterEvent(db, deps.writer, eventId);
          // New articles cite their claims only once written: file them under their context now
          if (deps.articleOrchestrator) await deps.hierarchyOrganizer?.(eventId);
        },
        "articles-ready": async () => {
          await workflowStep("articles-input", articleInputs);
          return { readyAt: new Date().toISOString() };
        },
        "hierarchy-enrichment": async () => {
          if ((await enrichmentUnits()).length) await deps.hierarchyOrganizer?.(eventId);
        },
        "plan-enrichment": async () => {
          const added = await enrichmentUnits();
          if (!added.length) return;
          await proposePages(db, eventId, deps.pagePlanner, "pages:propose:enrichment");
          await deps.articleOrchestrator?.(eventId, `enrichment:${eventId}`, added);
        },
        "pages-enrichment": async () => {
          if (!(await enrichmentUnits()).length) return;
          await rebuildAfterEvent(db, deps.writer, eventId, `enrichment:${eventId}`);
          if (deps.articleOrchestrator) await deps.hierarchyOrganizer?.(eventId);
        },
        // A failed upkeep read is unfinished work. Keep its checkpoint resumable
        // instead of showing a completed stage after only logging the failure.
        curate: async () => deps.pageMaintainer?.(eventId),
      };
      // Completed roles are not repeated on resume.
      // The first reviewed articles are usable before optional enrichment begins.
      // The existing post-response continuation and durable recovery queue finish
      // background stages; their checkpoints retain the same cancel/resume fencing.
      const stages = job === "knowledge" ? KNOWLEDGE_STAGES : [...KNOWLEDGE_STAGES, ...ARTICLE_STAGES, "articles-ready" as const, ...ENRICHMENT_STAGES];
      let failed = false;
      for (const key of stages) {
        await checkLease();
        try {
          const result = await timedStage(eventId, key, run[key]);
          // Announce only after the durable checkpoint succeeded, including on resume.
          if (key === "articles-ready") console.info("Upload articles ready", { eventId, ...(result as { readyAt: string }) });
        }
        // Each pass waits for its own prerequisites. Expanded knowledge has a
        // separate page pass, so it cannot reuse the first pass's checkpoints.
        catch { failed = true; break; }
        // Filing may propose a new root: the rest waits for that approval, as after the save
        if (key === "place" && await db.call<boolean>("upload_workflow_waiting", { p_event_id: eventId })) {
          await release("waiting");
          return;
        }
      }
      // A finished knowledge job leaves the upload incomplete without an error: articles are next
      await release(failed || job === "knowledge" ? "incomplete" : "complete");
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
    const warnings = workflow?.steps.filter((step) => step.state === "failed" && !step.key.startsWith("extract:")).map((step) => `${step.key}: ${step.error}`) ?? [];
    return {
      status: knowledge?.eventStatus ?? (error || warnings.length ? "failed" : "received"),
      changeSetId: knowledge?.changeSetId ?? null,
      error: [error ?? workflow?.error, ...warnings].filter(Boolean).join("\n") || null,
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
