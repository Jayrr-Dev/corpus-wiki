import "server-only";

import { after } from "next/server";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readModelChoice } from "@/lib/ai/models";
import { describeAssets, syncAssets } from "@/lib/assets/describe";
import type { DbRpc } from "@/lib/db/rpc";

import { getServerDeps } from "@/lib/server/deps";
import { importChatExport } from "./chatImport";
import { CONVERTERS } from "./convert";
import { getFeatureFlagsOrDefaults } from "@/lib/flags/server";
import { audioReaderFrom } from "./describeVideoServer";
import { DIRECT_UPLOAD_FORMATS, formatOf, mediaKindOf, MAX_DIRECT_UPLOAD_BYTES, storedMimeType, type UploadFormat, uploadFormatNamesFor } from "./formats";
import { sha256 } from "./hash";
import { type MessageDraft, messagePassages, splitIntoPassages } from "./passages";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { reconcileExternalUpload, reconcileUpload, recordUpload } from "./pipeline";
import { externalApproval, openRerunEvent } from "./rerun";
import { markSourceReplaced } from "./sourceLifecycle";
import { createDirectUploadUrl, readDirectUpload, removeDirectUpload, storeSourceFile } from "./storage";
import type { CaptureResult, ProcessUploadResult, StartUploadResult } from "./types";
import type { UploadJob } from "./workflowTypes";

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
  return startUploadFromBytes({ bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, browserType: file.type, sourceDate });
}

// STEP 1 FOR ANY BYTES: a form's file, or a file the browser put in Storage itself
async function startUploadFromBytes(input: { bytes: Uint8Array; fileName: string; browserType: string; sourceDate: string; replacement?: boolean }): Promise<StartUploadResult> {
  const { bytes, fileName, sourceDate } = input;
  const format = await requireFormat(fileName, input.browserType);
  if (!DATE_ONLY.test(sourceDate)) throw new Error("Give the file's date as YYYY-MM-DD.");
  if (format.id === "chat") {
    if (input.replacement) throw new Error("A chat export can't replace a source; upload it on its own.");
    return startChatImport(bytes, sourceDate);
  }
  const hash = sha256(bytes);
  const { db, imageDescriber, videoReader, textReader } = await getServerDeps();
  // A file seen before is skipped before an image or video costs a model call to read
  const known = await findSourceByHash(hash);
  if (known) return { kind: "skipped", sourceId: known };
  if (!input.replacement) {
    const existing = await db.call<string | null>("find_uploaded_file", { p_title: fileName });
    if (existing) return { kind: "skipped", sourceId: existing };
  }
  const mimeType = storedMimeType(format, fileName, input.browserType);
  const pages = await CONVERTERS[format.id](bytes, { fileName, mimeType, describeImage: imageDescriber, readVideo: videoReader, readAudio: format.id === "audio" ? audioReaderFrom() : null, readText: textReader, storeFigure: storeSourceFile });
  const passages = splitIntoPassages(pages);
  if (passages.length === 0) throw new Error(NOTHING_READ[format.id] ?? "No text was found in this file (is it a scan?).");
  const storagePath = await storeSourceFile(`${hash}${extensionOf(fileName, format)}`, bytes, mimeType);
  const pageCount = pages.some((page) => page.page !== null) ? pages.length : null;
  const started = await recordUpload(db, { title: fileName, mimeType, sourceDate: `${sourceDate}T00:00:00Z`, hash, storagePath, passages, byteSize: bytes.byteLength, pageCount, rejectSameName: !input.replacement });
  // Media the file brought in (the file itself, or pictures inside it) goes on the Assets page
  if (mediaKindOf(mimeType) || pages.some((page) => page.figure)) after(() => describeNewAssets(db));
  return started;
}

// CHAT IMPORT STEP 1 (chat_import flag): every conversation is recorded as its own source. The
// first new one is returned for the screen to process; the rest run after the response, in turn.
async function startChatImport(bytes: Uint8Array, sourceDate: string): Promise<StartUploadResult> {
  const { db } = await getServerDeps();
  const items = await importChatExport({ db, storeFile: storeSourceFile, findSourceByHash }, { bytes, fallbackDate: sourceDate });
  const started = items.flatMap((item) => (item.kind === "started" ? [{ sourceId: item.sourceId, eventId: item.eventId }] : []));
  const [first, ...rest] = started;
  if (!first) return { kind: "skipped", sourceId: items[0]!.sourceId };
  if (rest.length) after(() => processInTurn(rest.map((item) => item.eventId)));
  return { kind: "started", ...first, ...(rest.length ? { alsoStarted: rest } : {}) };
}

// Both jobs for each event, one at a time; a failure is saved on its workflow and the next one still runs
async function processInTurn(eventIds: string[]): Promise<void> {
  for (const eventId of eventIds) {
    await processUploadEvent(eventId, "articles").catch((error) => console.error("chat import processing failed", error));
  }
}

// STEP 1 FOR AN EMAIL ATTACHMENT (Gmail import): a file in a supported format runs the same
// step 1 as an upload; null when its format cannot be read
export async function startUploadFromAttachment(input: { bytes: Uint8Array; fileName: string; mimeType: string; sourceDate: string }): Promise<StartUploadResult | null> {
  if (!formatOf(input.fileName, input.mimeType)) return null;
  return startUploadFromBytes({ bytes: input.bytes, fileName: input.fileName, browserType: input.mimeType, sourceDate: input.sourceDate });
}

// STEP 1 FOR AN EMAIL THREAD (Gmail import): the thread is stored as a Markdown file, titled by
// its subject and dated by its first message; each message is one passage with its sender and
// date. The same thread text stored before is skipped, like any file.
export async function startEmailThreadSource(input: { subject: string; sentAt: string; markdown: string; messages: readonly MessageDraft[] }): Promise<StartUploadResult | null> {
  const passages = messagePassages(input.subject, input.messages);
  if (passages.length === 0) return null;
  const sentAt = new Date(input.sentAt);
  if (Number.isNaN(sentAt.getTime())) throw new Error("The email has no readable sent date.");
  const bytes = new TextEncoder().encode(input.markdown);
  const hash = sha256(bytes);
  const known = await findSourceByHash(hash);
  if (known) return { kind: "skipped", sourceId: known };
  const storagePath = await storeSourceFile(`${hash}.md`, bytes, "text/markdown");
  const { db } = await getServerDeps();
  return recordUpload(db, { title: input.subject, mimeType: "text/markdown", sourceDate: sentAt.toISOString(), hash, storagePath, passages, byteSize: bytes.byteLength, pageCount: null });
}

// ASSETS AFTER AN UPLOAD: found and described once the response is sent; a failure never fails the upload
async function describeNewAssets(db: DbRpc): Promise<void> {
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: { ...call, role: "media_analyst" } }));
  try {
    if (settings) await describeAssets(getAdminSupabase(), settings);
    else await syncAssets(getAdminSupabase());
  } catch (error) {
    console.error("The new assets could not be described:", error);
  }
}

// Why a file gave no passages, where it is not "no text"
const NOTHING_READ: Partial<Record<UploadFormat["id"], string>> = {
  image: "The model wrote no description for this image.",
  video: "Nothing could be read from this video: no speech was heard and no description was written.",
  audio: "No speech was heard in this recording.",
};

// DIRECT UPLOAD STEP 0: a signed URL the browser puts a large file (a video) at, in Storage,
// so it never travels in a Server Action body; startUploadFromStorage reads it there next
export async function startDirectUpload(input: { fileName: string; browserType: string; byteSize: number }): Promise<{ path: string; token: string }> {
  const format = await requireFormat(input.fileName, input.browserType);
  if (!DIRECT_UPLOAD_FORMATS.includes(format.id)) throw new Error(`${format.label} files are sent with the form, not uploaded directly.`);
  if (input.byteSize > MAX_DIRECT_UPLOAD_BYTES) {
    throw new Error(`This file is ${Math.ceil(input.byteSize / 1024 / 1024)} MB; files up to ${MAX_DIRECT_UPLOAD_BYTES / 1024 / 1024} MB can be uploaded. Save a shorter or smaller copy and upload that.`);
  }
  return createDirectUploadUrl(extensionOf(input.fileName, format));
}

// DIRECT UPLOAD STEP 1: the file the browser put at `path` runs step 1 like any upload; that
// copy is removed after (the source keeps its own, at its hash path)
export async function startUploadFromStorage(input: { path: string; fileName: string; browserType: string; sourceDate: string }): Promise<StartUploadResult> {
  try {
    const bytes = await readDirectUpload(input.path);
    return await startUploadFromBytes({ bytes, fileName: input.fileName, browserType: input.browserType, sourceDate: input.sourceDate });
  } finally {
    await removeDirectUpload(input.path).catch(() => undefined);
  }
}

// The source already stored with these exact bytes, if any (ingest_source skips it the same way)
async function findSourceByHash(hash: string): Promise<string | null> {
  const { data, error } = await getAdminSupabase().from("sources").select("id").eq("hash", hash).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

// The stored file's extension: the name's own when the format lists it (.jpeg stays .jpeg), else the format's first
function extensionOf(fileName: string, format: UploadFormat): string {
  const name = fileName.toLowerCase();
  return format.extensions.find((extension) => name.endsWith(extension)) ?? format.extensions[0] ?? "";
}

// EXTERNAL STEP 1: a web page is stored as a markdown file and marked external with its URL.
// The same page read before (same text) is not stored twice: its existing source comes back as skipped.
export async function startExternalSource(input: { title: string; url: string; text: string; sourceDate: string; reviewId: string }): Promise<StartUploadResult> {
  const client = getAdminSupabase();
  const { data: approval, error: approvalError } = await client.from("external_source_reviews").select("stage,outcome,url,source_title,excerpts,reverted_at").eq("id", input.reviewId).single();
  if (approvalError) throw new Error(approvalError.message);
  if (approval.reverted_at || approval.stage !== "source" || approval.outcome !== "approved" || approval.url !== input.url || approval.source_title !== input.title || approval.excerpts.join("\n\n") !== input.text) {
    throw new Error("External source evidence must match an independent approval before it can be stored.");
  }
  const bytes = new TextEncoder().encode(`# ${input.title}\n\nSource: ${input.url}\n\n${input.text}`);
  const hash = sha256(bytes);
  const passages = splitIntoPassages(await CONVERTERS.markdown(bytes));
  if (passages.length === 0) throw new Error(`No text was found at ${input.url}.`);
  const storagePath = await storeSourceFile(`${hash}.md`, bytes, "text/markdown");
  const { db } = await getServerDeps();
  const started = await recordUpload(db, { title: input.title, mimeType: "text/markdown", sourceDate: `${input.sourceDate}T00:00:00Z`, hash, storagePath, passages, byteSize: bytes.byteLength, pageCount: null });
  const { error: reviewError } = await client.from("external_source_reviews").update({ source_id: started.sourceId }).eq("id", input.reviewId);
  if (reviewError) throw new Error(reviewError.message);
  const { error } = await client.from("sources").update({ origin: "external", url: input.url }).eq("id", started.sourceId);
  if (error) throw new Error(error.message);
  return started;
}

// EXTERNAL STEP 2: reconciliation that only adds claims (see reconcileExternalUpload)
export async function processExternalEvent(eventId: string, scope: { article: string; section: string; note: string; fallbackDomainPath?: string }, reviewId: string) {
  const client = getAdminSupabase();
  const { data: approval, error: approvalError } = await client.from("external_source_reviews").select("outcome,stage,source_id,context,reverted_at").eq("id", reviewId).single();
  if (approvalError) throw new Error(approvalError.message);
  const { data: event, error: eventError } = await client.from("shift_events").select("source_id").eq("id", eventId).single();
  if (eventError) throw new Error(eventError.message);
  const context = approval.context as { article?: string; section?: string };
  if (approval.reverted_at || approval.outcome !== "approved" || approval.stage !== "source" || !approval.source_id || approval.source_id !== event.source_id || context.article !== scope.article || context.section !== scope.section) {
    throw new Error("This external source has not been independently approved for this article and section.");
  }
  // A company Overview can be approved from its article as well as its stakeholder
  // card. Both need the same reference home, outside the organization's policies.
  let fallbackDomainPath: string | undefined = scope.fallbackDomainPath;
  if (["overview", "history"].includes(scope.section.toLowerCase())) {
    const name = scope.article.replace(/^Stakeholder: /, "");
    const { data: entity, error: entityError } = await client.from("entities").select("id").eq("name", name).is("retired_at", null).limit(1).maybeSingle();
    if (entityError) throw new Error(entityError.message);
    if (entity) {
      const { ensureStakeholdersTopic, STAKEHOLDERS_TOPIC } = await import("@/lib/knowledge/stakeholderExternal");
      await ensureStakeholdersTopic(client);
      fallbackDomainPath = STAKEHOLDERS_TOPIC;
      scope = { ...scope, note: `${scope.note}\nFile approved company overview facts under the existing "${STAKEHOLDERS_TOPIC}" reference topic, never under the organization's policy topics.` };
    }
  }
  const { data: domains, error } = await client.from("domains").select("path,context_entity_id").is("retired_at", null);
  if (error) throw new Error(error.message);
  const organizationPaths = (domains ?? []).filter((domain) => domain.context_entity_id).map((domain) => domain.path);
  const referenceDomainPaths = (domains ?? []).filter((domain) => !domain.context_entity_id && !organizationPaths.some((path) => domain.path === path || domain.path.startsWith(`${path}/`))).map((domain) => domain.path);
  return reconcileExternalUpload(await getServerDeps(), eventId, { ...scope, referenceDomainPaths, fallbackDomainPath });
}

// The file's format, or a clear message naming the formats that work. A format behind a flag
// that is off (audio without audio_ingest) is refused like an unknown type.
async function requireFormat(fileName: string, browserType: string): Promise<UploadFormat> {
  const flags = await getFeatureFlagsOrDefaults();
  const format = formatOf(fileName, browserType, flags);
  if (!format) throw new Error(`This file type can't be read yet. Upload ${uploadFormatNamesFor(flags)}.`);
  return format;
}

// STEP 2: reconciliation with Nemotron, the commit and the page rebuild. `job` "knowledge"
// stops once the claims are saved and cleaned; "articles" also writes the pages.
export async function processUploadEvent(eventId: string, job: UploadJob = "articles", continuation = false): Promise<ProcessUploadResult> {
  // An external page runs only inside the article section it was approved for, adding claims
  // there. Old pages saved without that approval may hold broad, unfiltered text, so they are
  // never run as plain uploads; they are refreshed from their article instead.
  const client = getAdminSupabase();
  const { data: event, error: eventError } = await client.from("shift_events").select("source_id").eq("id", eventId).single();
  if (eventError) throw new Error(eventError.message);
  if (event.source_id) {
    const { data: source, error } = await client.from("sources").select("origin").eq("id", event.source_id).single();
    if (error) throw new Error(error.message);
    if (source.origin === "external") {
      // The page's claims are all saved in the knowledge job; it has no articles job of its own
      if (job === "articles") return { status: "applied", changeSetId: null, error: null };
      const approval = await externalApproval(event.source_id);
      if (approval) {
        const scope = { article: approval.article, section: approval.section, note: await externalNote(approval.article, approval.section) };
        const { status } = await processExternalEvent(eventId, scope, approval.reviewId);
        return { status, changeSetId: null, error: null };
      }
      const error = "Refresh external knowledge from its article section using Update or Force Create, so the search stays in scope.";
      const { db } = await getServerDeps();
      await db.call("set_event_status", { p_event_id: eventId, p_status: "failed", p_error: error });
      return { status: "failed", changeSetId: null, error };
    }
  }
  return reconcileUpload(await getServerDeps(), eventId, job, continuation);
}

// The extraction note for an external page run again: a stakeholder card's own note, else one that
// keeps the claims to the article section the page was approved for
async function externalNote(article: string, section: string): Promise<string> {
  const stakeholder = /^Stakeholder: (.+)$/.exec(article);
  if (stakeholder?.[1]) {
    // Loaded here: stakeholderExternal imports this module
    const { stakeholderScope } = await import("@/lib/knowledge/stakeholderExternal");
    return stakeholderScope(stakeholder[1]).note;
  }
  return `Add only claims that belong in the "${section}" section of the "${article}" article.`;
}

// CANCEL: the running role stops at its next check and its AI call is aborted. What is
// already committed stays; Resume continues from the last finished role.
export async function cancelUploadEvent(eventId: string): Promise<"cancelling" | "cancelled" | "idle"> {
  const { db } = await getServerDeps();
  return db.call("cancel_upload_workflow", { p_event_id: eventId });
}

// RETRY: step 2 again for a failed upload, with the model chosen now
export async function retryUploadEvent(eventId: string, job: UploadJob = "articles"): Promise<ProcessUploadResult> {
  // The workflow claim validates source eligibility and serializes concurrent resumes.
  // An applied knowledge event may still have unfinished page or review work.
  return processUploadEvent(eventId, job);
}

// RERUN: a stored source gets a fresh upload event; step 2 runs on it next
export async function startSourceRerun(sourceId: string): Promise<Extract<StartUploadResult, { kind: "started" }>> {
  return { kind: "started", sourceId, eventId: await openRerunEvent(sourceId) };
}

// REPLACE STEP 1: the newer file is stored like any upload and the old one is archived,
// pointing at it; processUploadEvent runs on the returned event next
export async function replaceSourceWithFile(input: { sourceId: string; file: File; sourceDate: string }): Promise<Extract<StartUploadResult, { kind: "started" }>> {
  const started = await startUploadFromBytes({ bytes: new Uint8Array(await input.file.arrayBuffer()), fileName: input.file.name, browserType: input.file.type, sourceDate: input.sourceDate, replacement: true });
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
