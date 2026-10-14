"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { processUploadEvent, type ProcessUploadResult, startUploadFromFile, type StartUploadResult } from "@/lib/ingest";
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

// STEP 2: reconcile with the AI, commit, rebuild the page; returns the event's final status
export async function processUpload(eventId: string): Promise<ActionResult<ProcessUploadResult>> {
  return toActionResult(async () => {
    await requireUser();
    return processUploadEvent(eventId);
  });
}
