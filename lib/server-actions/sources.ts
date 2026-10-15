"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { replaceSourceWithFile } from "@/lib/ingest";
import {
  archiveSource,
  type ArchiveSourceResult,
  deleteSource,
  type DeleteSourceResult,
  purgeSource,
  type PurgeSourceResult,
  readSourceImpact,
  restoreSource,
  type SourceImpact,
} from "@/lib/ingest/sourceLifecycle";
import type { StartUploadResult } from "@/lib/ingest/types";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// SOURCE ACTIONS (the source "…" menu). Re-run lives with the upload
// actions (startRerun + processUpload). Replace is step 1 of an upload;
// processUpload runs its event next, like a re-run.
// =====================================================================

// IMPACT: what archive, delete or purge would touch (confirm dialogs)
export async function sourceImpact(sourceId: string): Promise<ActionResult<SourceImpact>> {
  return toActionResult(async () => {
    await requireUser();
    return readSourceImpact(sourceId);
  });
}

// REPLACE: form fields `sourceId`, `file` and `sourceDate`; the old file is archived
export async function replaceSource(formData: FormData): Promise<ActionResult<Extract<StartUploadResult, { kind: "started" }>>> {
  return toActionResult(async () => {
    await requireUser();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("No file was sent.");
    return replaceSourceWithFile({ sourceId: String(formData.get("sourceId") ?? ""), file, sourceDate: String(formData.get("sourceDate") ?? "") });
  });
}

// ARCHIVE: the file stays; knowledge citing it reads as stale
export async function archiveSourceAction(sourceId: string): Promise<ActionResult<ArchiveSourceResult>> {
  return toActionResult(async () => {
    await requireUser();
    return archiveSource(sourceId);
  });
}

// RESTORE: an archived file is active evidence again
export async function restoreSourceAction(sourceId: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    return restoreSource(sourceId);
  });
}

// DELETE: the file and its passages go; knowledge citing it stays, marked lost
export async function removeSource(sourceId: string): Promise<ActionResult<DeleteSourceResult>> {
  return toActionResult(async () => {
    await requireUser();
    return deleteSource(sourceId);
  });
}

// PURGE: knowledge only this file supports is retired, shared knowledge drops it, then it is deleted
export async function purgeSourceAction(sourceId: string): Promise<ActionResult<PurgeSourceResult>> {
  return toActionResult(async () => {
    await requireUser();
    return purgeSource(sourceId);
  });
}
