import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { conversationMarkdown, conversationPages, isChatExport, NOT_A_CHAT_EXPORT, parseChatExport, readChatExport, UNTITLED_CHAT } from "./chatExport";
import { CHAT_EXPORT_FORMAT, formatOf, UPLOAD_ACCEPT, UPLOAD_FORMAT_NAMES, uploadAcceptFor, uploadFormatNamesFor, uploadFormatsFor } from "./formats";
import { splitIntoPassages } from "./passages";
import { isZip, zipEntries } from "./zipEntry";

const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "__fixtures__", name)));
const exportJson = () => fixture("chatgpt-export/conversations.json");

// A one-entry zip built here, so the reader is checked against a writer it does not share code with
function zipOf(name: string, content: Uint8Array, deflate = true): Uint8Array {
  const data = deflate ? new Uint8Array(deflateRawSync(content)) : content;
  const nameBytes = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, deflate ? 8 : 0, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, content.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, deflate ? 8 : 0, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, content.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);
  const out = new Uint8Array(local.length + data.length + central.length + end.length);
  out.set(local, 0);
  out.set(data, local.length);
  out.set(central, local.length + data.length);
  out.set(end, local.length + data.length + central.length);
  return out;
}

describe("ChatGPT export: reading conversations", () => {
  it("reads each of the three conversations with its title and the time it started", () => {
    const conversations = readChatExport(exportJson());
    expect(conversations.map((c) => c.title)).toEqual(["Beta launch plan", "Weather lookup", UNTITLED_CHAT]);
    expect(conversations.map((c) => c.createdAt)).toEqual(["2026-01-01T00:00:00.123Z", "2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"]);
    expect(conversations[0]?.id).toBe("c1-beta-launch");
  });

  it("follows the thread shown, leaving out an edited question's abandoned branch and the hidden system message", () => {
    const [beta] = readChatExport(exportJson());
    expect(beta?.messages).toEqual([
      { speaker: "User", text: "Which platform should the beta ship on first?" },
      { speaker: "ChatGPT", text: "Ship on iOS first.\n\nMost of your testers already use iPhones." },
      { speaker: "User", text: "Great. When should it go out?" },
      { speaker: "ChatGPT", text: "Aim for March 2027, after the payments work lands." },
    ]);
  });

  it("leaves out tool calls and tool results, and keeps only the text of a message with an image", () => {
    const [, weather] = readChatExport(exportJson());
    expect(weather?.messages).toEqual([
      { speaker: "User", text: "Is it going to rain in Lisbon tomorrow?" },
      { speaker: "ChatGPT", text: "Yes, there is an 80% chance of rain in Lisbon tomorrow." },
    ]);
  });

  it("reads the export .zip the same as its conversations.json", () => {
    const zip = fixture("chatgpt-export.zip");
    expect(isZip(zip)).toBe(true);
    expect(readChatExport(zip)).toEqual(readChatExport(exportJson()));
  });

  it("finds conversations.json inside a folder of the zip, deflated or stored", () => {
    for (const deflate of [true, false]) {
      const zip = zipOf("export-2026/conversations.json", exportJson(), deflate);
      expect(zipEntries(zip).map((entry) => entry.name)).toEqual(["export-2026/conversations.json"]);
      expect(readChatExport(zip)).toHaveLength(3);
    }
  });

  it("falls back to message times when there is no current message, and to the first message's time", () => {
    const [conversation] = parseChatExport([{ title: "  Spaced  ", mapping: {
      b: { message: { author: { role: "assistant" }, create_time: 20, content: { content_type: "text", parts: ["Second"] } } },
      a: { message: { author: { role: "user" }, create_time: 10, content: { content_type: "text", parts: ["First cite"] } } },
    } }]);
    expect(conversation).toEqual({ id: null, title: "Spaced", createdAt: "1970-01-01T00:00:10.000Z", messages: [{ speaker: "User", text: "First cite" }, { speaker: "ChatGPT", text: "Second" }] });
  });

  it("drops conversations with nothing said, and survives a parent loop", () => {
    expect(parseChatExport([{ title: "Empty", mapping: {}, current_node: null }])).toEqual([]);
    const looped = parseChatExport([{ title: "Loop", current_node: "a", mapping: {
      a: { parent: "b", message: { author: { role: "user" }, content: { content_type: "text", parts: ["A"] } } },
      b: { parent: "a", message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["B"] } } },
    } }]);
    expect(looped[0]?.messages.map((m) => m.text)).toEqual(["B", "A"]);
  });
});

describe("ChatGPT export: detection by content", () => {
  it("knows an export by its content, whatever the file is called", () => {
    expect(isChatExport(exportJson())).toBe(true);
    expect(isChatExport(fixture("chatgpt-export.zip"))).toBe(true);
  });

  it("refuses JSON that is not an export, a zip without conversations.json and other files", () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(isChatExport(encode('{"name":"package"}'))).toBe(false);
    expect(isChatExport(encode('[{"title":"no mapping"}]'))).toBe(false);
    expect(isChatExport(encode("not json"))).toBe(false);
    expect(isChatExport(fixture("beta-handbook.docx"))).toBe(false);
    expect(() => readChatExport(encode('{"name":"package"}'))).toThrow(NOT_A_CHAT_EXPORT);
    expect(() => readChatExport(zipOf("notes.txt", encode("hi")))).toThrow(/No conversations\.json was found in this zip/);
  });
});

describe("ChatGPT export: passages", () => {
  it("makes each message one passage labelled by its speaker", () => {
    const [beta] = readChatExport(exportJson());
    const passages = splitIntoPassages(conversationPages(beta!));
    expect(passages.map((p) => [p.position, p.speakerLabel, p.text])).toEqual([
      [0, "User", "User: Which platform should the beta ship on first?"],
      [1, "ChatGPT", "ChatGPT: Ship on iOS first. Most of your testers already use iPhones."],
      [2, "User", "User: Great. When should it go out?"],
      [3, "ChatGPT", "ChatGPT: Aim for March 2027, after the payments work lands."],
    ]);
    expect(passages.every((p) => Object.keys(p.location).length === 0)).toBe(true);
  });

  it("cuts a very long message at sentence ends, every piece keeping its speaker", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const passages = splitIntoPassages([{ page: null, text: long, speaker: "ChatGPT" }]);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every((p) => p.speakerLabel === "ChatGPT" && p.text.startsWith("ChatGPT: "))).toBe(true);
  });

  it("does not let a message starting with # become the heading of the rest", () => {
    const passages = splitIntoPassages([{ page: null, text: "# Title", speaker: "User" }, { page: null, text: "Next", speaker: "ChatGPT" }]);
    expect(passages.map((p) => p.location)).toEqual([{}, {}]);
  });

  it("stores the conversation as a Markdown transcript", () => {
    const [, , untitled] = readChatExport(exportJson());
    expect(conversationMarkdown(untitled!)).toBe(
      "# Untitled chat\n\nChatGPT conversation\n\nStarted: 2026-03-01T00:00:00.000Z\n\n## User\n\nRemind me: who owns the onboarding doc?\n\n## ChatGPT\n\nPriya owns it; she updates it every quarter.\n",
    );
  });
});

describe("ChatGPT export: an upload format behind the chat_import flag", () => {
  it("is not an upload format while the flag is off", () => {
    for (const flags of [undefined, {}, { chat_import: false }, { billing: true }]) {
      expect(formatOf("conversations.json", "application/json", flags)).toBeNull();
      expect(formatOf("chatgpt-export.zip", "application/zip", flags)).toBeNull();
      expect(uploadFormatsFor(flags).map((f) => f.id)).not.toContain("chat");
      expect(uploadAcceptFor(flags)).not.toContain(".json");
      expect(uploadFormatNamesFor(flags)).not.toContain("ChatGPT");
    }
    expect(UPLOAD_ACCEPT).not.toContain(".zip");
    expect(UPLOAD_FORMAT_NAMES).not.toContain("ChatGPT");
  });

  it("knows conversations.json and the export .zip by name while the flag is on", () => {
    const on = { chat_import: true };
    expect(formatOf("conversations.json", "", on)).toBe(CHAT_EXPORT_FORMAT);
    expect(formatOf("ChatGPT-Export.ZIP", "", on)?.id).toBe("chat");
    expect(formatOf("export", "application/json", on)?.id).toBe("chat");
    expect(formatOf("notes.md", "", on)?.id).toBe("markdown");
    expect(uploadAcceptFor(on)).toContain(".zip");
    expect(uploadFormatNamesFor(on)).toBe("PDF, Word, Markdown, Text, Image, Video or ChatGPT export");
  });
});
