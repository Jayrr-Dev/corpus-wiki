import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { importChatExport } from "./chatImport";
import type { PassageDraft } from "./passages";

const exportBytes = () => new Uint8Array(readFileSync(join(import.meta.dirname, "__fixtures__", "chatgpt-export", "conversations.json")));

type Call = { fn: string; args: Record<string, unknown> };

// A fake database: ingest_source answers with a new source and event per call
function fakeDeps(known: Set<string> = new Set()) {
  const calls: Call[] = [];
  const stored: { path: string; text: string; mimeType: string }[] = [];
  let next = 0;
  const db = {
    call: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      next += 1;
      return { skipped: false, sourceId: `source-${next}`, eventId: `event-${next}` };
    }),
  } as unknown as DbRpc;
  const deps = {
    db,
    storeFile: vi.fn(async (path: string, bytes: Uint8Array, mimeType: string) => {
      stored.push({ path, text: new TextDecoder().decode(bytes), mimeType });
      return path;
    }),
    findSourceByHash: vi.fn(async (hash: string) => (known.has(hash) ? "old-source" : null)),
  };
  return { deps, calls, stored };
}

describe("chat import: one source per conversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records each conversation as its own source, titled by the chat and dated when it started", async () => {
    const { deps, calls, stored } = fakeDeps();
    const items = await importChatExport(deps, { bytes: exportBytes(), fallbackDate: "2026-10-29" });
    expect(items).toEqual([
      { kind: "started", title: "Beta launch plan", sourceId: "source-1", eventId: "event-1" },
      { kind: "started", title: "Weather lookup", sourceId: "source-2", eventId: "event-2" },
      { kind: "started", title: "Untitled chat", sourceId: "source-3", eventId: "event-3" },
    ]);
    // ingest_source: chats may share a title, so the same-name check of a file upload does not apply
    expect(calls.map((c) => c.fn)).toEqual(["ingest_source", "ingest_source", "ingest_source"]);
    expect(calls.map((c) => [c.args.p_title, c.args.p_source_date, c.args.p_mime_type, c.args.p_page_count])).toEqual([
      ["Beta launch plan", "2026-01-01T00:00:00.123Z", "text/markdown", null],
      ["Weather lookup", "2026-02-01T00:00:00.000Z", "text/markdown", null],
      ["Untitled chat", "2026-03-01T00:00:00.000Z", "text/markdown", null],
    ]);
    expect(stored.map((s) => s.mimeType)).toEqual(["text/markdown", "text/markdown", "text/markdown"]);
    expect(stored[0]?.text).toMatch(/^# Beta launch plan\n/);
    expect(calls[0]?.args.p_storage_path).toBe(stored[0]?.path);
  });

  it("stores each message as a passage labelled by its speaker", async () => {
    const { deps, calls } = fakeDeps();
    await importChatExport(deps, { bytes: exportBytes(), fallbackDate: "2026-10-29" });
    const passages = calls[1]?.args.p_passages as PassageDraft[];
    expect(passages.map((p) => [p.speakerLabel, p.text])).toEqual([
      ["User", "User: Is it going to rain in Lisbon tomorrow?"],
      ["ChatGPT", "ChatGPT: Yes, there is an 80% chance of rain in Lisbon tomorrow."],
    ]);
  });

  it("skips a conversation stored before, by the hash of its transcript", async () => {
    const first = fakeDeps();
    await importChatExport(first.deps, { bytes: exportBytes(), fallbackDate: "2026-10-29" });
    const betaHash = first.calls[0]?.args.p_hash as string;
    const again = fakeDeps(new Set([betaHash]));
    const items = await importChatExport(again.deps, { bytes: exportBytes(), fallbackDate: "2026-10-29" });
    expect(items[0]).toEqual({ kind: "skipped", title: "Beta launch plan", sourceId: "old-source" });
    expect(again.calls.map((c) => c.args.p_title)).toEqual(["Weather lookup", "Untitled chat"]);
    expect(again.deps.storeFile).toHaveBeenCalledTimes(2);
  });

  it("dates a conversation without a time by the date given with the upload", async () => {
    const { deps, calls } = fakeDeps();
    const bytes = new TextEncoder().encode(JSON.stringify([{ title: "Undated", mapping: { a: { message: { author: { role: "user" }, content: { content_type: "text", parts: ["Hi"] } } } } }]));
    await importChatExport(deps, { bytes, fallbackDate: "2026-10-29" });
    expect(calls[0]?.args.p_source_date).toBe("2026-10-29T00:00:00Z");
  });

  it("refuses an export with no conversations, and a file that is not an export, before storing anything", async () => {
    const { deps } = fakeDeps();
    await expect(importChatExport(deps, { bytes: new TextEncoder().encode("[]"), fallbackDate: "2026-10-29" })).rejects.toThrow("No conversations with messages were found in this export.");
    await expect(importChatExport(deps, { bytes: new TextEncoder().encode('{"a":1}'), fallbackDate: "2026-10-29" })).rejects.toThrow(/isn't a ChatGPT export/);
    expect(deps.storeFile).not.toHaveBeenCalled();
    expect(deps.db.call).not.toHaveBeenCalled();
  });
});
