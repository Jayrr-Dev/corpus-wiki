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
import type { UploadJob } from "./workflowTypes";
import { uploadExecution, workflowStep } from "./workflowContext";

// =====================================================================
// UPLOAD PIPELINE (runtime-neutral: the app runs it on Supabase, the
// evals on a throwaway Postgres). Two steps, in order:
//   1. recordUpload    source + passages + a 'received' event
//   2. reconcileUpload two jobs (lib/ingest/workflow.ts):
//      knowledge      model drafts a ChangeSet -> Change control commits
//                     it -> claims are embedded and deduplicated, entities
//                     described, topics organized, the glossary updated
//      articles       pages are proposed for the entities it is about ->
//                     the living pages are written once from that knowledge
// =====================================================================

// duplicateGuard: turns repeats of stored claims into revisions before a web page's draft is
// submitted (lib/ingest/duplicateGuard.ts); uploads save first and leave repeats to `deduper`,
// which merges them after the commit; claimEmbedder: saves vectors of the claims a commit wrote,
// and of source passages not yet embedded
export type PipelineDeps = { db: DbRpc; reconciler: ReconciliationClient; writer: SectionWriter; glossaryGenerator?: () => Promise<void>; pagePlanner?: PagePlanner; articleOrchestrator?: (eventId: string) => Promise<unknown>; knowledgeExpander?: (eventId: string) => Promise<void>; hierarchyOrganizer?: (eventId: string) => Promise<void>; deduper?: (eventId: string) => Promise<void>; topicPlacer?: (eventId: string) => Promise<void>; entityDescriber?: (eventId: string) => Promise<void>; entityTidier?: (eventId: string) => Promise<void>; profileWriter?: (eventId: string) => Promise<void>; duplicateGuard?: (input: ReconciliationInput, draft: DraftChangeSet, options?: GuardOptions) => Promise<DraftChangeSet>; claimEmbedder?: () => Promise<void> };

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
// "knowledge" stops once the claims are committed and cleaned; "articles" (the default) also writes the pages.
// `continuation` marks the automatic articles run after the knowledge job: it never overrides a cancel.
export async function reconcileUpload(deps: PipelineDeps, eventId: string, job: UploadJob = "articles", continuation = false): Promise<ProcessUploadResult> {
  return runUploadWorkflow(deps, eventId, () => draftAndCommit(deps, eventId), job, continuation);
}

// EXTERNAL STEP 2: scoped web evidence adds claims to established reference domains.
// It never changes the taxonomy or the organization's own policies.

export async function reconcileExternalUpload(deps: PipelineDeps, eventId: string, scope: NonNullable<ReconciliationInput["externalScope"]>): Promise<{ status: ProcessUploadResult["status"]; added: number }> {
  // Article research has its own source approval and must never reuse its parent's checkpoints.
  return uploadExecution.exit(async () => {
  try {
    const { eventStatus, applied } = await draftAndCommit(deps, eventId, (draft, input) => scopeExternalDraft(draft, input.domainPaths), { reviseStored: false }, scope);
    try { await deps.entityDescriber?.(eventId); } catch { /* descriptions are a nicety; the claims are saved */ }
    try { await deps.profileWriter?.(eventId); } catch { /* so are stakeholder cards */ }
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

// The model reads the file against the current store and Change control judges and saves
// what it found, straight away: a slow comparison can never cost the extracted knowledge.
// An upload's repeats of stored claims are merged after the save, by the "duplicates" role
// (the merge keeps every citation). A web page only adds claims and has no such cleanup, so
// its draft still goes through the duplicate guard first. Its new claims are then embedded
// so the next upload and the cleaning cycle can find them by meaning (not fatal).
async function draftAndCommit({ db, reconciler, duplicateGuard, claimEmbedder }: PipelineDeps, eventId: string, shape: (draft: DraftChangeSet, input: ReconciliationInput) => DraftChangeSet = (draft) => draft, guardOptions?: GuardOptions, externalScope?: ReconciliationInput["externalScope"]) {
  await setEventStatus(db, eventId, "reconciling", null);
  const input = await workflowStep("reconciliation-input", () => db.call<ReconciliationInput>("reconciliation_input", { p_event_id: eventId }));
  if (externalScope) {
    input.externalScope = externalScope;
    input.domainPaths = input.domainPaths.filter((path) => externalScope.referenceDomainPaths.includes(path));
  }
  // An upload's claims are saved without topics: the "place" role files them all at once
  // after cleaning. A web page keeps its topics (it may only add to existing reference branches).
  const drafted = await workflowStep("extraction", async () => {
    const draft = shape(await reconciler.draftChangeSet(externalScope ? input : { ...input, fileTopicsLater: true }), input);
    return externalScope ? draft : withoutTopics(draft);
  });
  const draft = externalScope && duplicateGuard ? await duplicateGuard(input, drafted, guardOptions) : drafted;
  const { changeSetId } = await submitChangeSet(db, { eventId, cause: "upload", actor: "ai", operationKey: "reconcile:submit" }, draft);
  const result = await commitChangeSet(db, changeSetId);
  try { if (externalScope) await claimEmbedder?.(); }
  catch (error) { console.error("New claims could not be embedded:", error); }
  return result;
}

// The draft with its claims' topics left for later: no paths on its adds, no domains created
function withoutTopics(draft: DraftChangeSet): DraftChangeSet {
  const actions = draft.actions.filter((action) => action.type !== "create_domain").map((action) =>
    action.type === "add_claim" ? { ...action, input: { ...action.input, domainPaths: [] } } : action);
  // Links name new claims by position: shift them past the dropped creates
  const dropped = draft.actions.map((action, position) => (action.type === "create_domain" ? position : -1)).filter((position) => position >= 0);
  const moved = (position: number | undefined) => position === undefined ? undefined : position - dropped.filter((at) => at < position).length;
  return { ...draft, actions: actions.map((action) => action.type === "link"
    ? { ...action, input: { ...action.input, ...(action.input.fromPosition === undefined ? {} : { fromPosition: moved(action.input.fromPosition) }), ...(action.input.toPosition === undefined ? {} : { toPosition: moved(action.input.toPosition) }) } }
    : action) };
}

// Moves the event along (the Upload screen watches it)
async function setEventStatus(db: DbRpc, eventId: string, status: ProcessUploadResult["status"], error: string | null) {
  await db.call("set_event_status", { p_event_id: eventId, p_status: status, p_error: error });
}
