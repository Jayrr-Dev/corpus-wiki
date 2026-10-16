import { withSettledActor } from "@/lib/auth/currentPerson";
import type { CommitResult } from "@/lib/change-control";
import { commitChangeSet } from "@/lib/change-control";
import { proposePages, rebuildAfterEvent } from "@/lib/living-page";
import type { PipelineDeps } from "./pipeline";
import type { ProcessUploadResult } from "./types";
import { uploadExecution, workflowStep } from "./workflowContext";
import { ARTICLE_STAGES, KNOWLEDGE_STAGES, type UploadJob, type UploadWorkflow } from "./workflowTypes";

// The articles job also walks the knowledge roles: finished ones come back from their
// checkpoints, unfinished ones run first, so articles never read half-cleaned knowledge.
// How often a run renews its lease, and so how soon a cancel reaches an AI call in flight
const HEARTBEAT_MS = 5_000;

// `continuation`: started automatically after the knowledge job, so it never overrides a cancel.
export async function runUploadWorkflow(deps: PipelineDeps, eventId: string, reconcile: () => Promise<CommitResult>, job: UploadJob = "articles", continuation = false): Promise<ProcessUploadResult> {
  // Who is acting is read once: re-reading the request minutes later can hang (lib/auth/currentPerson.ts)
  return withSettledActor(() => runUploadWorkflowAs(deps, eventId, reconcile, job, continuation));
}

async function runUploadWorkflowAs(deps: PipelineDeps, eventId: string, reconcile: () => Promise<CommitResult>, job: UploadJob, continuation: boolean): Promise<ProcessUploadResult> {
  const { db } = deps;
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
  const checkLease = async () => {
    if (leaseError) throw leaseError;
    await db.call("assert_upload_lease", { p_event_id: eventId, p_token: token });
  };
  try {
    heartbeat = setInterval(() => {
      if (heartbeatPending) return;
      heartbeatPending = true;
      void checkLease().catch((error) => { leaseError = error; abort.abort(error); }).finally(() => { heartbeatPending = false; });
    }, HEARTBEAT_MS);
    await uploadExecution.run({ eventId, token, db, signal: abort.signal }, async () => {
      await workflowStep("reconcile", async () => {
        await checkLease();
        return claim.changeSetId ? commitChangeSet(db, claim.changeSetId) : reconcile();
      });
      if (await db.call<boolean>("upload_workflow_waiting", { p_event_id: eventId })) {
        await release("waiting");
        return;
      }
      const run: Record<(typeof KNOWLEDGE_STAGES)[number] | (typeof ARTICLE_STAGES)[number], () => Promise<unknown>> = {
        embeddings: async () => deps.claimEmbedder?.(),
        describe: async () => deps.entityDescriber?.(eventId),
        duplicates: async () => deps.deduper?.(eventId),
        place: async () => deps.topicPlacer?.(eventId),
        hierarchy: async () => deps.hierarchyOrganizer?.(eventId),
        glossary: async () => deps.glossaryGenerator?.(),
        expand: async () => deps.knowledgeExpander?.(eventId),
        plan: () => proposePages(db, eventId, deps.pagePlanner),
        pages: () => rebuildAfterEvent(db, deps.writer, eventId),
      };
      // Completed roles are not repeated on resume.
      const stages = job === "knowledge" ? KNOWLEDGE_STAGES : [...KNOWLEDGE_STAGES, ...ARTICLE_STAGES];
      let failed = false;
      for (const key of stages) {
        await checkLease();
        try { await workflowStep(key, run[key]); }
        // Later roles depend on earlier outputs. Do not checkpoint pages against
        // incomplete expansion, then incorrectly skip them when expansion resumes.
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
