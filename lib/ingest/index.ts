import "server-only";

import { getServerDeps } from "@/lib/server/deps";
import { extractPdfPages, PDF_MIME_TYPE } from "./extract";
import { sha256 } from "./hash";
import { splitIntoPassages } from "./passages";
import { reconcileUpload, recordUpload } from "./pipeline";
import { storeSourceFile } from "./storage";
import type { ProcessUploadResult, StartUploadResult } from "./types";

export type * from "./types";

// =====================================================================
// INGESTION FOR THE APP (agent C): a PDF from the person's computer goes
// to Storage, its text becomes passages, then the pipeline runs.
// =====================================================================

// SOURCE DATE INPUT: the file's own date as YYYY-MM-DD
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// STEP 1: validates the PDF, stores it, extracts its passages and opens the upload event
export async function startUploadFromFile(input: { file: File; sourceDate: string }): Promise<StartUploadResult> {
  const { file, sourceDate } = input;
  if (file.type !== PDF_MIME_TYPE) throw new Error("Only PDF files can be uploaded.");
  if (!DATE_ONLY.test(sourceDate)) throw new Error("Give the file's date as YYYY-MM-DD.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = sha256(bytes);
  // pdf.js may detach the buffer it reads, so it gets its own copy
  const passages = splitIntoPassages(await extractPdfPages(bytes.slice()));
  if (passages.length === 0) throw new Error("No text was found in this PDF (is it a scan?).");
  const storagePath = await storeSourceFile(hash, bytes, PDF_MIME_TYPE);
  const { db } = getServerDeps();
  return recordUpload(db, {
    title: file.name,
    mimeType: PDF_MIME_TYPE,
    sourceDate: `${sourceDate}T00:00:00Z`,
    hash,
    storagePath,
    passages,
  });
}

// STEP 2: reconciliation with Nemotron, the commit and the page rebuild
export async function processUploadEvent(eventId: string): Promise<ProcessUploadResult> {
  return reconcileUpload(getServerDeps(), eventId);
}
