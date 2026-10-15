import "server-only";

import { getServerDeps } from "@/lib/server/deps";
import { CONVERTERS } from "./convert";
import { formatOf, type UploadFormat, UPLOAD_FORMAT_NAMES } from "./formats";
import { sha256 } from "./hash";
import { splitIntoPassages } from "./passages";
import { reconcileUpload, recordUpload } from "./pipeline";
import { openRerunEvent, requireFailedUpload } from "./rerun";
import { markSourceReplaced } from "./sourceLifecycle";
import { storeSourceFile } from "./storage";
import type { CaptureResult, ProcessUploadResult, StartUploadResult } from "./types";

export type * from "./types";

// =====================================================================
// INGESTION FOR THE APP (agent C): ONE pipeline for every format. A file
// from the person's computer is converted to located text by its format's
// converter, stored in the private bucket, split into passages, and then
// runs the same reconcile -> commit -> rebuild steps as any other file.
// =====================================================================

// SOURCE DATE INPUT: the file's own date as YYYY-MM-DD
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// STEP 1: converts and stores the file, records its passages and opens the upload event
export async function startUploadFromFile(input: { file: File; sourceDate: string }): Promise<StartUploadResult> {
  const { file, sourceDate } = input;
  const format = requireFormat(file);
  if (!DATE_ONLY.test(sourceDate)) throw new Error("Give the file's date as YYYY-MM-DD.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = sha256(bytes);
  const pages = await CONVERTERS[format.id](bytes);
  const passages = splitIntoPassages(pages);
  if (passages.length === 0) throw new Error("No text was found in this file (is it a scan?).");
  const mimeType = format.mimeTypes[0] ?? file.type;
  const storagePath = await storeSourceFile(`${hash}${format.extensions[0] ?? ""}`, bytes, mimeType);
  const { db } = await getServerDeps();
  const pageCount = pages.some((page) => page.page !== null) ? pages.length : null;
  return recordUpload(db, { title: file.name, mimeType, sourceDate: `${sourceDate}T00:00:00Z`, hash, storagePath, passages, byteSize: bytes.byteLength, pageCount });
}

// The file's format, or a clear message naming the formats that work
function requireFormat(file: File): UploadFormat {
  const format = formatOf(file.name, file.type);
  if (!format) throw new Error(`This file type can't be read yet. Upload ${UPLOAD_FORMAT_NAMES}.`);
  return format;
}

// STEP 2: reconciliation with Nemotron, the commit and the page rebuild
export async function processUploadEvent(eventId: string): Promise<ProcessUploadResult> {
  return reconcileUpload(await getServerDeps(), eventId);
}

// RETRY: step 2 again for a failed upload, with the model chosen now
export async function retryUploadEvent(eventId: string): Promise<ProcessUploadResult> {
  await requireFailedUpload(eventId);
  return processUploadEvent(eventId);
}

// RERUN: a stored source gets a fresh upload event; step 2 runs on it next
export async function startSourceRerun(sourceId: string): Promise<Extract<StartUploadResult, { kind: "started" }>> {
  return { kind: "started", sourceId, eventId: await openRerunEvent(sourceId) };
}

// REPLACE STEP 1: the newer file is stored like any upload and the old one is archived,
// pointing at it; processUploadEvent runs on the returned event next
export async function replaceSourceWithFile(input: { sourceId: string; file: File; sourceDate: string }): Promise<Extract<StartUploadResult, { kind: "started" }>> {
  const started = await startUploadFromFile(input);
  if (started.kind === "skipped") {
    throw new Error(started.sourceId === input.sourceId ? "That is the same file that is already stored." : "That exact file is already stored as another source.");
  }
  await markSourceReplaced(input.sourceId, started.sourceId);
  return started;
}

// ONE CALL: both steps back to back (POST /api/capture). A file seen before is skipped
export async function captureFile(input: { file: File; sourceDate: string }): Promise<CaptureResult> {
  const started = await startUploadFromFile(input);
  if (started.kind === "skipped") return started;
  return { ...started, kind: "processed", ...(await processUploadEvent(started.eventId)) };
}
