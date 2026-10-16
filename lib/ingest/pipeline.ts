import type { DraftChangeSet, ReconciliationClient, ReconciliationInput } from "@/lib/ai/types";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { PagePlanner } from "@/lib/living-page/articlePlanner";
import type { DbRpc } from "@/lib/db/rpc";
import { type SectionWriter } from "@/lib/living-page";
import type { GuardOptions } from "./duplicateGuard";
import type { ProcessUploadResult, StartUploadResult } from "./types";
import type { PassageDraft } from "./passages";
import { scopeExternalDraft } from "./scopeExternalDraft";
import { runUploadWorkflow } from "./workflow";
import { uploadExecution, workflowStep } from "./workflowContext";

// =====================================================================
// UPLOAD PIPELINE (runtime-neutral: the app runs it on Supabase, the
// evals on a throwaway Postgres). Two steps, in order:
//   1. recordUpload    source + passages + a 'received' event
//   2. reconcileUpload model drafts a ChangeSet -> Change control commits
//                      it -> new entities get a short description ->
//                      pages are proposed for the entities it is
//                      about -> the living page rebuilds what changed
// =====================================================================

// duplicateGuard: turns repeats of stored claims into revisions before the draft is submitted
// (lib/ingest/duplicateGuard.ts); claimEmbedder: saves vectors of the claims a commit wrote
export type PipelineDeps = { db: DbRpc; reconciler: ReconciliationClient; writer: SectionWriter; pagePlanner?: PagePlanner; knowledgeExpander?: (eventId: string) => Promise<void>; hierarchyOrganizer?: (eventId: string) => Promise<void>; deduper?: (eventId: string) => Promise<void>; entityDescriber?: (eventId: string) => Promise<void>; duplicateGuard?: (input: ReconciliationInput, draft: DraftChangeSet, options?: GuardOptions) => Promise<DraftChangeSet>; claimEmbedder?: () => Promise<void> };

// WHAT STEP 1 NEEDS: the file's metadata and its passages (text already extracted)
export type UploadRecord = {
  title: string;
  mimeType: string;
  sourceDate: string; // ISO timestamp: the file's own date, not the upload time
  hash: string;
  storagePath: string;
  passages: PassageDraft[];
  byteSize?: number;
  pageCount?: number | null; // null for formats without pages
};

type IngestResult = { skipped: true; sourceId: string } | { skipped: false; sourceId: string; eventId: string };

// STEP 1: records the file; an identical file uploaded before is skipped
export async function recordUpload(db: DbRpc, record: UploadRecord): Promise<StartUploadResult> {
  const result = await db.call<IngestResult>("ingest_source", {
    p_title: record.title,
    p_mime_type: record.mimeType,
    p_source_date: record.sourceDate,
    p_hash: record.hash,
    p_storage_path: record.storagePath,
    p_passages: record.passages,
    p_byte_size: record.byteSize ?? null,
    p_page_count: record.pageCount ?? null,
  });
  if (result.skipped) return { kind: "skipped", sourceId: result.sourceId };
  return { kind: "started", sourceId: result.sourceId, eventId: result.eventId };
}

// STEP 2: persist each role's progress; unfinished processing is separate from the knowledge commit.
export async function reconcileUpload(deps: PipelineDeps, eventId: string): Promise<ProcessUploadResult> {
  return runUploadWorkflow(deps, eventId, () => draftAndCommit(deps, eventId));
}

// EXTERNAL STEP 2: scoped web evidence adds claims to established reference domains.
// It never changes the taxonomy or the organization's own policies.

export async function reconcileExternalUpload(deps: PipelineDeps, eventId: string, scope: NonNullable<ReconciliationInput["externalScope"]>): Promise<{ status: ProcessUploadResult["status"]; added: number }> {
  // Article research has its own source approval and must never reuse its parent's checkpoints.
  return uploadExecution.exit(async () => {
  try {
    const { eventStatus, applied } = await draftAndCommit(deps, eventId, (draft, input) => scopeExternalDraft(draft, input.domainPaths), { reviseStored: false }, scope);
    try { await deps.entityDescriber?.(eventId); } catch { /* descriptions are a nicety; the claims are saved */ }
    return { status: eventStatus, added: applied };
  } catch (error) {
    await setEventStatus(deps.db, eventId, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
  });
}

// Root approval can defer an entire upload. Resume its enrichment and page work
// only after the last root decision has allowed Change control to finish it.
export async function finishApprovedUpload(deps: PipelineDeps, eventId: string): Promise<void> {
  await reconcileUpload(deps, eventId);
}

// The model reads the file against the current store, the duplicate guard folds repeats of
// stored claims into them, and Change control judges what is left. New claims are then
// embedded so the next upload and the cleaning cycle can find them by meaning (not fatal).
async function draftAndCommit({ db, reconciler, duplicateGuard, claimEmbedder }: PipelineDeps, eventId: string, shape: (draft: DraftChangeSet, input: ReconciliationInput) => DraftChangeSet = (draft) => draft, guardOptions?: GuardOptions, externalScope?: ReconciliationInput["externalScope"]) {
  await setEventStatus(db, eventId, "reconciling", null);
  const input = await workflowStep("reconciliation-input", () => db.call<ReconciliationInput>("reconciliation_input", { p_event_id: eventId }));
  if (externalScope) {
    input.externalScope = externalScope;
    input.domainPaths = input.domainPaths.filter((path) => externalScope.referenceDomainPaths.includes(path));
  }
  const drafted = await workflowStep("extraction", async () => shape(await reconciler.draftChangeSet(input), input));
  const draft = await workflowStep("duplicate-guard", () => duplicateGuard ? duplicateGuard(input, drafted, guardOptions) : Promise.resolve(drafted));
  const { changeSetId } = await submitChangeSet(db, { eventId, cause: "upload", actor: "ai", operationKey: "reconcile:submit" }, draft);
  const result = await commitChangeSet(db, changeSetId);
  try { if (externalScope) await claimEmbedder?.(); }
  catch (error) { console.error("New claims could not be embedded:", error); }
  return result;
}

// Moves the event along (the Upload screen watches it)
async function setEventStatus(db: DbRpc, eventId: string, status: ProcessUploadResult["status"], error: string | null) {
  await db.call("set_event_status", { p_event_id: eventId, p_status: status, p_error: error });
}
