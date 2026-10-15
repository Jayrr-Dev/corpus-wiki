"use server";

import { requireUser } from "@/lib/auth/requireUser";
import {
  processUploadEvent,
  type ProcessUploadResult,
  retryUploadEvent,
  startDirectUpload,
  startSourceRerun,
  startUploadFromFile,
  startUploadFromStorage,
  type StartUploadResult,
} from "@/lib/ingest";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// UPLOAD ACTIONS (called by /upload). Two steps so the screen can watch
// the shift event move through its statuses while step 2 runs.
// =====================================================================

// STEP 1: form fields `file` (a PDF) and `sourceDate` (YYYY-MM-DD, the file's own date)
export async function startUpload(formData: FormData): Promise<ActionResult<StartUploadResult>> {
  return toActionResult(async () => {
    await requireUser();
    const file = formData.get("file");
    const sourceDate = String(formData.get("sourceDate") ?? "");
    if (!(file instanceof File)) throw new Error("No file was sent.");
    return startUploadFromFile({ file, sourceDate });
  });
}

// DIRECT STEP 0: a signed URL the browser uploads a video to (it is too big for this action's body)
export async function prepareDirectUpload(input: { fileName: string; browserType: string; byteSize: number }): Promise<ActionResult<{ path: string; token: string }>> {
  return toActionResult(async () => {
    await requireUser();
    return startDirectUpload(input);
  });
}

// DIRECT STEP 1: step 1 for the file the browser put at `path`
export async function startUploadFromPath(input: { path: string; fileName: string; browserType: string; sourceDate: string }): Promise<ActionResult<StartUploadResult>> {
  return toActionResult(async () => {
    await requireUser();
    return startUploadFromStorage(input);
  });
}

// STEP 2: reconcile with the AI, commit, rebuild the page; returns the event's final status
export async function processUpload(eventId: string): Promise<ActionResult<ProcessUploadResult>> {
  return toActionResult(async () => {
    await requireUser();
    return processUploadEvent(eventId);
  });
}

// RETRY: step 2 again for a failed upload (Recent uploads, the chosen file's status line)
export async function retryUpload(eventId: string): Promise<ActionResult<ProcessUploadResult>> {
  return toActionResult(async () => {
    await requireUser();
    return retryUploadEvent(eventId);
  });
}

// RERUN STEP 1: a stored source gets a fresh upload event (Sources "…" menu); processUpload runs it
export async function startRerun(sourceId: string): Promise<ActionResult<StartUploadResult>> {
  return toActionResult(async () => {
    await requireUser();
    return startSourceRerun(sourceId);
  });
}
