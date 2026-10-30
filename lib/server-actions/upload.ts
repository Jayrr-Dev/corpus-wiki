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
import { after } from "next/server";
import { articlesPending, knowledgeSaved } from "@/lib/ingest/workflowTypes";
import { type ActionResult, toActionResult } from "./result";
import { readLink } from "@/lib/ingest/readLink";
import { saveUploadOptions, type UploadOptions } from "@/lib/ingest/uploadOptions";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { runSpaceUpkeep } from "@/lib/processing/recovery";

// =====================================================================
// UPLOAD ACTIONS (called by /upload). Two steps so the screen can watch
// the shift event move through its statuses while step 2 runs.
// =====================================================================

// STEP 1: form fields `file` (a PDF) and `sourceDate` (YYYY-MM-DD, the file's own date)
export async function startLinkUpload(url: string, sourceDate: string): Promise<ActionResult<StartUploadResult>> {
  return toActionResult(async () => {
    await requireUser();
    const page = await readLink(url);
    // A user-selected link is an explicit upload, distinct from automatically discovered external evidence.
    const file = new File([`# ${page.title}\n\nSource: ${page.url}\n\n${page.text}`], `${page.title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 150)}.md`, { type: "text/markdown" });
    return startUploadFromFile({ file, sourceDate });
  });
}

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

// STEP 2: the knowledge job answers the caller as soon as the claims are saved and cleaned;
// the articles job runs after the response, so it never holds up the screen's other actions.
// The screen watches its progress through read_upload_workflows.
export async function processUpload(eventId: string): Promise<ActionResult<ProcessUploadResult>> {
  return toActionResult(async () => {
    await requireUser();
    return writeArticlesAfter(eventId, await processUploadEvent(eventId, "knowledge"));
  });
}

// RETRY: step 2 again for an unfinished upload (Recent uploads, the chosen file's status line)
export async function retryUpload(eventId: string): Promise<ActionResult<ProcessUploadResult>> {
  return toActionResult(async () => {
    await requireUser();
    return writeArticlesAfter(eventId, await retryUploadEvent(eventId, "knowledge"), true);
  });
}

// A failed articles job is saved on the workflow, where the screen shows it with Resume;
// Resume (`retry`) runs it again once the knowledge is saved.
function writeArticlesAfter(eventId: string, knowledge: ProcessUploadResult, retry = false): ProcessUploadResult {
  if (knowledge.workflow && (retry ? knowledgeSaved(knowledge.workflow) : articlesPending(knowledge.workflow))) {
    after(() => processUploadEvent(eventId, "articles", true).then(() => undefined, (error) => console.error("upload articles failed", error)));
  }
  return knowledge;
}

// RERUN STEP 1: a stored source gets a fresh upload event (Sources "…" menu); processUpload runs it
export async function startRerun(sourceId: string): Promise<ActionResult<StartUploadResult>> {
  return toActionResult(async () => {
    await requireUser();
    return startSourceRerun(sourceId);
  });
}

// UPLOAD OPTIONS: the Upload screen's switches, saved for the space (lib/ingest/uploadOptions.ts)
// A person's Retry for one upload's failed or cancelled module work (articles, definitions,
// entity cards, glossary, page tree). It starts now; the background worker would also pick it up.
export async function retryUploadModules(eventId: string): Promise<ActionResult<{ retried: number }>> {
  return toActionResult(async () => {
    await requireUser();
    const retried = await supabaseRpc(getAdminSupabase()).call<number>("retry_upload_module_upkeep", { p_event_id: eventId });
    if (retried) after(() => runSpaceUpkeep(240_000).then(() => undefined, (error) => console.error("module upkeep failed", error)));
    return { retried };
  });
}

export async function setUploadOptions(options: UploadOptions): Promise<ActionResult<{ options: UploadOptions }>> {
  return toActionResult(async () => {
    await requireUser();
    return { options: await saveUploadOptions(supabaseRpc(getAdminSupabase()), options) };
  });
}
