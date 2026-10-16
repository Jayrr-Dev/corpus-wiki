import type { CommitResult } from "@/lib/change-control";
import { commitChangeSet } from "@/lib/change-control";
import { proposePages, rebuildAfterEvent } from "@/lib/living-page";
import type { PipelineDeps } from "./pipeline";
import type { ProcessUploadResult } from "./types";
import { uploadExecution, workflowStep } from "./workflowContext";
import type { UploadWorkflow } from "./workflowTypes";

export async function runUploadWorkflow(deps: PipelineDeps, eventId: string, reconcile: () => Promise<CommitResult>): Promise<ProcessUploadResult> {
  const { db } = deps;
  const claim = await db.call<{ claimed: boolean; token?: string; changeSetId?: string | null }>("claim_upload_workflow", { p_event_id: eventId });
  if (!claim.claimed || !claim.token) return readResult();
  const token = claim.token;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatPending = false;
  let leaseError: unknown;
  let fatal: string | null = null;
  let resumeAfterRelease = false;
  const checkLease = async () => {
    if (leaseError) throw leaseError;
    await db.call("assert_upload_lease", { p_event_id: eventId, p_token: token });
  };
  try {
    heartbeat = setInterval(() => {
      if (heartbeatPending) return;
      heartbeatPending = true;
      void checkLease().catch((error) => { leaseError = error; }).finally(() => { heartbeatPending = false; });
    }, 30_000);
    await uploadExecution.run({ eventId, token, db }, async () => {
      await workflowStep("reconcile", async () => {
        await checkLease();
        return claim.changeSetId ? commitChangeSet(db, claim.changeSetId) : reconcile();
      });
      if (await db.call<boolean>("upload_workflow_waiting", { p_event_id: eventId })) {
        await release("waiting");
        return;
      }
      // The original roles still run, but completed roles are not repeated on resume.
      const stages: [string, () => Promise<unknown>][] = [
        ["embeddings", async () => deps.claimEmbedder?.()],
        ["describe", async () => deps.entityDescriber?.(eventId)],
        ["expand", async () => deps.knowledgeExpander?.(eventId)],
        ["plan", () => proposePages(db, eventId, deps.pagePlanner)],
        ["pages", () => rebuildAfterEvent(db, deps.writer, eventId)],
        ["hierarchy", async () => deps.hierarchyOrganizer?.(eventId)],
        ["duplicates", async () => deps.deduper?.(eventId)],
        ["settle-pages", () => rebuildAfterEvent(db, deps.writer, eventId)],
        ["glossary", async () => deps.glossaryGenerator?.()],
      ];
      let failed = false;
      for (const [key, run] of stages) {
        await checkLease();
        try { await workflowStep(key, run); }
        // Later roles depend on earlier outputs. Do not checkpoint pages against
        // incomplete expansion, then incorrectly skip them when expansion resumes.
        catch { failed = true; break; }
      }
      await release(failed ? "incomplete" : "complete");
    });
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    await release("incomplete");
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
  if (resumeAfterRelease) return runUploadWorkflow(deps, eventId, reconcile);
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
