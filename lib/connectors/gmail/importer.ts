import type { StartUploadResult } from "@/lib/ingest/types";
import type { MessageDraft } from "@/lib/ingest/passages";
import type { GmailApi } from "./api";
import type { GmailStore } from "./store";
import { type EmailThread, parseThread, threadMarkdown } from "./thread";

// =====================================================================
// GMAIL IMPORT RUN: every thread under the chosen labels that this Space
// has not imported yet becomes a source (step 1 of the upload pipeline);
// attachments in a supported format go through the same step 1 as an
// uploaded file. Threads imported before are skipped without being read.
// Step 2 (reconciliation) runs on the opened events afterwards.
// Runtime-neutral: the Gmail API, the store and the ingest steps are passed in.
// =====================================================================

// How many new threads one run imports; Import now again picks up the rest
export const MAX_THREADS_PER_RUN = 50;
// How many thread ids are listed per label to find the new ones
const MAX_LISTED_PER_LABEL = 500;

export type ImportDeps = {
  api: GmailApi;
  store: GmailStore;
  startThread: (input: { subject: string; sentAt: string; markdown: string; messages: readonly MessageDraft[] }) => Promise<StartUploadResult | null>;
  startAttachment: (input: { bytes: Uint8Array; fileName: string; mimeType: string; sourceDate: string }) => Promise<StartUploadResult | null>;
};

export type ImportSummary = {
  imported: number; // threads stored as new sources
  skipped: number; // threads imported before, or whose text was already stored
  attachments: number; // attachments stored as new sources
  failed: number; // threads that could not be read (tried again next run)
  more: boolean; // new threads are left for the next run
  eventIds: string[]; // upload events to run step 2 on
};

export async function importLabels(deps: ImportDeps, input: { accountEmail: string; labelIds: readonly string[]; limit?: number }): Promise<ImportSummary> {
  const limit = input.limit ?? MAX_THREADS_PER_RUN;
  const summary: ImportSummary = { imported: 0, skipped: 0, attachments: 0, failed: 0, more: false, eventIds: [] };
  if (input.labelIds.length === 0) throw new Error("Pick at least one label to import.");

  // Thread ids across the labels, each once (a thread can carry several labels)
  const listed: string[] = [];
  for (const labelId of input.labelIds) {
    for (const id of await deps.api.listThreadIds(labelId, MAX_LISTED_PER_LABEL)) if (!listed.includes(id)) listed.push(id);
  }
  const known = await deps.store.importedThreadIds(input.accountEmail, listed);
  const fresh = listed.filter((id) => !known.has(id));
  summary.skipped = listed.length - fresh.length;
  summary.more = fresh.length > limit;

  for (const threadId of fresh.slice(0, limit)) {
    let thread: EmailThread;
    let started: StartUploadResult | null;
    try {
      thread = parseThread(await deps.api.getThread(threadId));
      started = await deps.startThread({ subject: thread.subject, sentAt: thread.sentAt, markdown: threadMarkdown(thread), messages: thread.messages });
    } catch (error) {
      console.error(`Gmail thread ${threadId} could not be imported:`, error);
      summary.failed++;
      continue;
    }
    if (started?.kind === "started") {
      summary.imported++;
      summary.eventIds.push(started.eventId);
    } else summary.skipped++;
    for (const attachment of thread.attachments) {
      try {
        const bytes = attachment.attachmentId
          ? await deps.api.getAttachment(attachment.messageId, attachment.attachmentId)
          : new Uint8Array(Buffer.from(attachment.inlineData ?? "", "base64url"));
        const file = await deps.startAttachment({ bytes, fileName: attachment.fileName, mimeType: attachment.mimeType, sourceDate: attachment.sentAt.slice(0, 10) });
        if (file?.kind === "started") {
          summary.attachments++;
          summary.eventIds.push(file.eventId);
        }
      } catch (error) {
        // An unreadable attachment never stops the thread from counting as imported
        console.error(`Gmail attachment ${attachment.fileName} could not be imported:`, error);
      }
    }
    await deps.store.recordThread(input.accountEmail, threadId, started?.sourceId ?? null);
  }
  return summary;
}
