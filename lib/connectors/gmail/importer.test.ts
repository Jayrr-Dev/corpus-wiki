import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import type { GmailApi, GmailThread } from "./api";
import { importLabels } from "./importer";
import { gmailStore } from "./store";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

function thread(id: string, subject: string, attachment?: { name: string; type: string }): GmailThread {
  return {
    id,
    messages: [{
      id: `${id}-m1`,
      threadId: id,
      payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "From", value: "Ann <ann@example.com>" }, { name: "Date", value: "Mon, 1 Jan 2024 10:00:00 +0000" }, { name: "Subject", value: subject }],
        parts: [
          { mimeType: "text/plain", body: { data: b64(`Body of ${subject}`) } },
          ...(attachment ? [{ mimeType: attachment.type, filename: attachment.name, body: { attachmentId: `${id}-a1` } }] : []),
        ],
      },
    }],
  };
}

// An in-memory gmail_imported_threads behind the same DbRpc the app uses
function fakeDb() {
  const imported = new Map<string, string | null>();
  const call = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    if (fn === "gmail_imported_thread_ids") return (args.p_thread_ids as string[]).filter((id) => imported.has(`${String(args.p_account_email)}:${id}`));
    if (fn === "gmail_record_thread") { imported.set(`${String(args.p_account_email)}:${String(args.p_thread_id)}`, args.p_source_id as string | null); return true; }
    throw new Error(`unexpected ${fn}`);
  });
  return { db: { call } as unknown as DbRpc, imported, call };
}

function fakeApi(threads: Record<string, GmailThread>, byLabel: Record<string, string[]>): GmailApi & { getThread: ReturnType<typeof vi.fn> } {
  return {
    profileEmail: vi.fn(async () => "me@example.com"),
    listLabels: vi.fn(async () => []),
    listThreadIds: vi.fn(async (label: string) => byLabel[label] ?? []),
    getThread: vi.fn(async (id: string) => threads[id]!),
    getAttachment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
}

describe("importLabels", () => {
  let n = 0;
  const startThread = vi.fn(async () => ({ kind: "started" as const, sourceId: `s${++n}`, eventId: `e${n}` }));
  // Only formats the pipeline reads become sources (like startUploadFromAttachment)
  const startAttachment = vi.fn(async (input: { fileName: string }) => (input.fileName.endsWith(".pdf") ? { kind: "started" as const, sourceId: `s${++n}`, eventId: `e${n}` } : null));
  beforeEach(() => { n = 0; vi.clearAllMocks(); });

  it("imports each thread once across labels, with subject, sent date and one passage per message", async () => {
    const { db, imported } = fakeDb();
    const api = fakeApi({ t1: thread("t1", "Plan"), t2: thread("t2", "Budget") }, { L1: ["t1", "t2"], L2: ["t2"] });
    const summary = await importLabels({ api, store: gmailStore(db), startThread, startAttachment }, { accountEmail: "me@example.com", labelIds: ["L1", "L2"] });
    expect(summary).toMatchObject({ imported: 2, skipped: 0, failed: 0, more: false, eventIds: ["e1", "e2"] });
    expect(api.getThread).toHaveBeenCalledTimes(2);
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Plan",
      sentAt: "2024-01-01T10:00:00.000Z",
      messages: [expect.objectContaining({ senderName: "Ann", text: "Body of Plan" })],
    }));
    expect([...imported.keys()]).toEqual(["me@example.com:t1", "me@example.com:t2"]);
  });

  it("skips threads imported before without reading them again", async () => {
    const { db } = fakeDb();
    const store = gmailStore(db);
    const api = fakeApi({ t1: thread("t1", "Plan"), t2: thread("t2", "Budget") }, { L1: ["t1"] });
    await importLabels({ api, store, startThread, startAttachment }, { accountEmail: "me@example.com", labelIds: ["L1"] });
    api.getThread.mockClear();
    startThread.mockClear();

    (api.listThreadIds as ReturnType<typeof vi.fn>).mockResolvedValue(["t1", "t2"]);
    const again = await importLabels({ api, store, startThread, startAttachment }, { accountEmail: "me@example.com", labelIds: ["L1"] });
    expect(again).toMatchObject({ imported: 1, skipped: 1 });
    expect(api.getThread).toHaveBeenCalledTimes(1);
    expect(api.getThread).toHaveBeenCalledWith("t2");
    expect(startThread).toHaveBeenCalledTimes(1);
  });

  it("sends supported attachments through the upload pipeline and passes others by", async () => {
    const { db } = fakeDb();
    const api = fakeApi({ t1: thread("t1", "Plan", { name: "plan.pdf", type: "application/pdf" }), t2: thread("t2", "Zip", { name: "x.zip", type: "application/zip" }) }, { L1: ["t1", "t2"] });
    const summary = await importLabels({ api, store: gmailStore(db), startThread, startAttachment }, { accountEmail: "me@example.com", labelIds: ["L1"] });
    expect(startAttachment).toHaveBeenCalledWith({ bytes: new Uint8Array([1, 2, 3]), fileName: "plan.pdf", mimeType: "application/pdf", sourceDate: "2024-01-01" });
    expect(summary.attachments).toBe(1);
    expect(summary.eventIds).toHaveLength(3);
  });

  it("counts a thread whose text was stored before as skipped, and still records it", async () => {
    const { db, imported } = fakeDb();
    const api = fakeApi({ t1: thread("t1", "Plan") }, { L1: ["t1"] });
    const stored = vi.fn(async () => ({ kind: "skipped" as const, sourceId: "old" }));
    const summary = await importLabels({ api, store: gmailStore(db), startThread: stored, startAttachment }, { accountEmail: "me@example.com", labelIds: ["L1"] });
    expect(summary).toMatchObject({ imported: 0, skipped: 1, eventIds: [] });
    expect(imported.get("me@example.com:t1")).toBe("old");
  });

  it("leaves a thread that fails for the next run", async () => {
    const { db, imported } = fakeDb();
    const api = fakeApi({}, { L1: ["t1"] });
    api.getThread.mockRejectedValue(new Error("Gmail answered 500"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await importLabels({ api, store: gmailStore(db), startThread, startAttachment }, { accountEmail: "me@example.com", labelIds: ["L1"] });
    log.mockRestore();
    expect(summary).toMatchObject({ imported: 0, failed: 1 });
    expect(imported.size).toBe(0);
  });

  it("imports at most `limit` new threads and says more are left", async () => {
    const { db } = fakeDb();
    const api = fakeApi({ t1: thread("t1", "A"), t2: thread("t2", "B"), t3: thread("t3", "C") }, { L1: ["t1", "t2", "t3"] });
    const summary = await importLabels({ api, store: gmailStore(db), startThread, startAttachment }, { accountEmail: "me@example.com", labelIds: ["L1"], limit: 2 });
    expect(summary).toMatchObject({ imported: 2, more: true });
  });

  it("needs a label", async () => {
    const { db } = fakeDb();
    await expect(importLabels({ api: fakeApi({}, {}), store: gmailStore(db), startThread, startAttachment }, { accountEmail: "me@example.com", labelIds: [] })).rejects.toThrow(/label/);
  });
});
