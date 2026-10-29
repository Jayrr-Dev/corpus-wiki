import { describe, expect, it } from "vitest";
import { messagePassages } from "@/lib/ingest/passages";
import type { GmailMessage } from "./api";
import { htmlToText, parseThread, senderName, stripQuoted, threadMarkdown } from "./thread";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

function message(id: string, input: { from: string; date: string; subject?: string; text?: string; html?: string; attachments?: { name: string; type: string; id: string }[] }): GmailMessage {
  const body = input.text !== undefined
    ? [{ mimeType: "text/plain", body: { data: b64(input.text) } }]
    : [{ mimeType: "text/html", body: { data: b64(input.html ?? "") } }];
  return {
    id,
    threadId: "t1",
    payload: {
      mimeType: "multipart/mixed",
      headers: [{ name: "From", value: input.from }, { name: "Date", value: input.date }, ...(input.subject ? [{ name: "Subject", value: input.subject }] : [])],
      parts: [
        { mimeType: "multipart/alternative", parts: body },
        ...(input.attachments ?? []).map((file) => ({ mimeType: file.type, filename: file.name, body: { attachmentId: file.id, size: 10 } })),
      ],
    },
  };
}

describe("parseThread", () => {
  const thread = parseThread({
    id: "t1",
    messages: [
      message("m2", { from: "Bob <bob@example.com>", date: "Tue, 2 Jan 2024 09:00:00 +0000", subject: "Re: Plan", text: "Sounds good.\n\nOn Mon, 1 Jan 2024 Ann wrote:\n> Here is the plan." }),
      message("m1", { from: "\"Ann Lee\" <ann@example.com>", date: "Mon, 1 Jan 2024 10:30:00 +0000", subject: "Plan", text: "Here is the plan.\nSecond line.", attachments: [{ name: "plan.pdf", type: "application/pdf", id: "a1" }] }),
    ],
  });

  it("titles the thread by its first subject and dates it by its first message", () => {
    expect(thread.subject).toBe("Plan");
    expect(thread.sentAt).toBe("2024-01-01T10:30:00.000Z");
  });

  it("keeps each message's sender, date and own text in order", () => {
    expect(thread.messages.map((m) => [m.senderName, m.sentAt, m.text])).toEqual([
      ["Ann Lee", "2024-01-01T10:30:00.000Z", "Here is the plan.\nSecond line."],
      ["Bob", "2024-01-02T09:00:00.000Z", "Sounds good."],
    ]);
  });

  it("lists attachments with their message and date", () => {
    expect(thread.attachments).toEqual([{ messageId: "m1", attachmentId: "a1", inlineData: null, fileName: "plan.pdf", mimeType: "application/pdf", sentAt: "2024-01-01T10:30:00.000Z" }]);
  });

  it("makes one passage per message, located by sender and date", () => {
    const passages = messagePassages(thread.subject, thread.messages);
    expect(passages).toHaveLength(2);
    expect(passages[0]).toMatchObject({ position: 0, text: "Here is the plan. Second line.", speakerLabel: "Ann Lee", location: { heading: "Plan", sender: "\"Ann Lee\" <ann@example.com>", sentAt: "2024-01-01T10:30:00.000Z" } });
    expect(passages[1]).toMatchObject({ position: 1, text: "Sounds good.", speakerLabel: "Bob" });
  });

  it("renders a Markdown copy", () => {
    expect(threadMarkdown(thread)).toContain("# Plan\n\n## \"Ann Lee\" <ann@example.com> · 2024-01-01T10:30:00.000Z");
  });
});

describe("message text", () => {
  it("falls back to HTML", () => {
    const thread = parseThread({ id: "t", messages: [message("m", { from: "a@b.c", date: "Mon, 1 Jan 2024 10:00:00 +0000", html: "<p>Hello&nbsp;<b>there</b></p><style>p{}</style>" })] });
    expect(thread.messages[0]?.text).toBe("Hello there");
    expect(thread.subject).toBe("(no subject)");
  });

  it("drops messages with no text", () => {
    const thread = parseThread({ id: "t", messages: [message("m", { from: "a@b.c", date: "Mon, 1 Jan 2024 10:00:00 +0000", text: "> only quoted" })] });
    expect(thread.messages).toEqual([]);
  });

  it("reads sender names", () => {
    expect(senderName("Jane <j@x.com>")).toBe("Jane");
    expect(senderName("<j@x.com>")).toBe("j@x.com");
    expect(senderName("j@x.com")).toBe("j@x.com");
  });

  it("cuts quoted replies and forwarded originals", () => {
    expect(stripQuoted("Yes.\n\n-----Original Message-----\nFrom: x")).toBe("Yes.");
    expect(htmlToText("a<br>b")).toBe("a\nb");
  });
});
