import type { ReconciliationClient, ReconciliationInput } from "@/lib/ai/types";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { rebuildAfterEvent, type SectionWriter } from "@/lib/living-page";
import type { ProcessUploadResult, StartUploadResult } from "./types";
import type { PassageDraft } from "./passages";

// =====================================================================
// UPLOAD PIPELINE (runtime-neutral: the app runs it on Supabase, the
// evals on a throwaway Postgres). Two steps, in order:
//   1. recordUpload    source + passages + a 'received' event
//   2. reconcileUpload model drafts a ChangeSet -> Change control commits
//                      it -> the living page rebuilds what changed
// =====================================================================

export type PipelineDeps = { db: DbRpc; reconciler: ReconciliationClient; writer: SectionWriter };

// WHAT STEP 1 NEEDS: the file's metadata and its passages (text already extracted)
export type UploadRecord = {
  title: string;
  mimeType: string;
  sourceDate: string; // ISO timestamp: the file's own date, not the upload time
  hash: string;
  storagePath: string;
  passages: PassageDraft[];
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
  });
  if (result.skipped) return { kind: "skipped", sourceId: result.sourceId };
  return { kind: "started", sourceId: result.sourceId, eventId: result.eventId };
}

// STEP 2: draft, commit, rebuild. A failure marks the event failed with the reason
export async function reconcileUpload(deps: PipelineDeps, eventId: string): Promise<ProcessUploadResult> {
  try {
    const { changeSetId, eventStatus } = await draftAndCommit(deps, eventId);
    const rebuildError = await rebuildPages(deps, eventId);
    return { status: eventStatus, changeSetId, error: rebuildError };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setEventStatus(deps.db, eventId, "failed", message);
    return { status: "failed", changeSetId: null, error: message };
  }
}

// The model reads the file against the current store; Change control judges what it drafted
async function draftAndCommit({ db, reconciler }: PipelineDeps, eventId: string) {
  await setEventStatus(db, eventId, "reconciling", null);
  const input = await db.call<ReconciliationInput>("reconciliation_input", { p_event_id: eventId });
  const draft = await reconciler.draftChangeSet(input);
  const { changeSetId } = await submitChangeSet(db, { eventId, cause: "upload", actor: "ai" }, draft);
  return commitChangeSet(db, changeSetId);
}

// The knowledge is already committed, so a page that fails to rebuild is reported, not fatal
async function rebuildPages({ db, writer }: PipelineDeps, eventId: string): Promise<string | null> {
  try {
    await rebuildAfterEvent(db, writer, eventId);
    return null;
  } catch (error) {
    return `Knowledge saved, but the page could not be rebuilt: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Moves the event along (the Upload screen watches it)
async function setEventStatus(db: DbRpc, eventId: string, status: ProcessUploadResult["status"], error: string | null) {
  await db.call("set_event_status", { p_event_id: eventId, p_status: status, p_error: error });
}
