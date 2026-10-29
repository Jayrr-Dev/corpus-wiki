import type { DbRpc } from "@/lib/db/rpc";
import { conversationMarkdown, conversationPages, readChatExport } from "./chatExport";
import { sha256 } from "./hash";
import { splitIntoPassages } from "./passages";
import { recordUpload } from "./pipeline";

// =====================================================================
// CHAT IMPORT (behind the chat_import flag): a ChatGPT export becomes one
// source per conversation, titled by the chat's title and dated by when it
// started, each message one passage labelled by its speaker. Every source
// then runs the same reconcile -> commit -> rebuild steps as any upload.
// Runtime-neutral: storage and the hash lookup are passed in (tests fake them).
// =====================================================================

export type ChatImportDeps = {
  db: DbRpc;
  storeFile: (path: string, bytes: Uint8Array, mimeType: string) => Promise<string>;
  findSourceByHash: (hash: string) => Promise<string | null>;
};

// WHAT HAPPENED TO EACH CONVERSATION: a new source with its upload event, or one stored before
export type ChatImportItem =
  | { kind: "started"; title: string; sourceId: string; eventId: string }
  | { kind: "skipped"; title: string; sourceId: string };

const MIME_TYPE = "text/markdown";

// Records every conversation in the export, one after another. `fallbackDate` (YYYY-MM-DD)
// dates a conversation the export gives no time for.
export async function importChatExport(deps: ChatImportDeps, input: { bytes: Uint8Array; fallbackDate: string }): Promise<ChatImportItem[]> {
  const conversations = readChatExport(input.bytes);
  if (conversations.length === 0) throw new Error("No conversations with messages were found in this export.");
  const items: ChatImportItem[] = [];
  for (const conversation of conversations) {
    const passages = splitIntoPassages(conversationPages(conversation));
    if (passages.length === 0) continue;
    const bytes = new TextEncoder().encode(conversationMarkdown(conversation));
    const hash = sha256(bytes);
    const known = await deps.findSourceByHash(hash);
    if (known) {
      items.push({ kind: "skipped", title: conversation.title, sourceId: known });
      continue;
    }
    const storagePath = await deps.storeFile(`${hash}.md`, bytes, MIME_TYPE);
    // ingest_source, not ingest_uploaded_file: many chats share a title ("New chat") and are still different
    const started = await recordUpload(deps.db, {
      title: conversation.title,
      mimeType: MIME_TYPE,
      sourceDate: conversation.createdAt ?? `${input.fallbackDate}T00:00:00Z`,
      hash,
      storagePath,
      passages,
      byteSize: bytes.byteLength,
      pageCount: null,
    });
    items.push({ ...started, title: conversation.title });
  }
  return items;
}
