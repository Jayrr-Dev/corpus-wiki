import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONVERTERS } from "./convert";
import {
  DIRECT_UPLOAD_FORMATS,
  FORMAT_FLAGS,
  formatOf,
  mediaKindOf,
  PLANNED_FORMATS,
  storedMimeType,
  UPLOAD_ACCEPT,
  UPLOAD_FORMATS,
  uploadAcceptFor,
  uploadFormatNamesFor,
} from "./formats";
import { splitIntoPassages } from "./passages";

// Reads a small sample file from __fixtures__
const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "__fixtures__", name)));

describe("one pipeline, one converter per format", () => {
  it("knows each format by extension, even when the browser sends no MIME type", () => {
    expect(formatOf("Notes.DOCX", "")?.id).toBe("docx");
    expect(formatOf("readme.md", "text/plain")?.id).toBe("markdown");
    expect(formatOf("photo.png", "image/png")?.id).toBe("image");
    expect(formatOf("clip.mp4", "video/mp4")?.id).toBe("video");
    expect(formatOf("Interview.MOV", "")?.id).toBe("video");
    expect(formatOf("talk.webm", "video/webm")?.id).toBe("video");
    expect(formatOf("song.mp3", "audio/mpeg")).toBeNull();
    expect(PLANNED_FORMATS).not.toContain("video");
    expect(UPLOAD_ACCEPT).toContain(".pdf");
    expect(UPLOAD_ACCEPT).toContain(".jpg");
  });

  it("stores an image with its own type, even when the browser sends none", () => {
    const image = formatOf("Team.JPG", "")!;
    expect(storedMimeType(image, "Team.JPG", "")).toBe("image/jpeg");
    expect(storedMimeType(image, "chart.webp", "image/webp")).toBe("image/webp");
    expect(mediaKindOf("image/png")).toBe("image");
    expect(mediaKindOf("video/mp4")).toBe("video");
    expect(mediaKindOf("application/pdf")).toBeNull();
  });

  it("stores a video with its own type and sends it straight to Storage, past the form's 20 MB", () => {
    const video = formatOf("clip.mov", "")!;
    expect(storedMimeType(video, "clip.mov", "")).toBe("video/quicktime");
    expect(storedMimeType(video, "clip.mp4", "video/mp4")).toBe("video/mp4");
    expect(mediaKindOf(storedMimeType(video, "clip.webm", ""))).toBe("video");
    expect(DIRECT_UPLOAD_FORMATS).toEqual(["video", "audio"]);
  });

  describe("audio behind the audio_ingest flag", () => {
    const on = { audio_ingest: true };

    it("refuses audio while the flag is off, and keeps it out of the accept list", () => {
      for (const flags of [undefined, {}, { audio_ingest: false }]) {
        expect(formatOf("song.mp3", "audio/mpeg", flags)).toBeNull();
        expect(formatOf("memo.m4a", "", flags)).toBeNull();
        expect(formatOf("note.webm", "audio/webm", flags)?.id).toBe("video");
        expect(uploadAcceptFor(flags)).not.toMatch(/\.mp3|\.m4a|\.wav|\.ogg|audio\//);
        expect(uploadFormatNamesFor(flags)).not.toContain("Audio");
      }
      expect(UPLOAD_ACCEPT).not.toContain("audio/");
      expect(UPLOAD_FORMATS.map((f) => f.id)).not.toContain("audio");
      expect(FORMAT_FLAGS.audio).toBe("audio_ingest");
    });

    it("knows each audio file by extension, or by audio/webm for a shared .webm, once the flag is on", () => {
      expect(formatOf("song.mp3", "", on)?.id).toBe("audio");
      expect(formatOf("Memo.M4A", "audio/x-m4a", on)?.id).toBe("audio");
      expect(formatOf("call.wav", "audio/wav", on)?.id).toBe("audio");
      expect(formatOf("podcast.ogg", "", on)?.id).toBe("audio");
      expect(formatOf("recording.webm", "audio/webm", on)?.id).toBe("audio");
      expect(formatOf("recording.weba", "", on)?.id).toBe("audio");
      expect(formatOf("talk.webm", "video/webm", on)?.id).toBe("video");
      expect(formatOf("talk.webm", "", on)?.id).toBe("video");
      expect(formatOf("blob", "audio/mpeg", on)?.id).toBe("audio");
      expect(uploadAcceptFor(on)).toContain(".mp3");
      expect(uploadAcceptFor(on)).toContain("audio/webm");
      expect(uploadFormatNamesFor(on)).toMatch(/Video or Audio$/);
      expect(PLANNED_FORMATS).not.toContain("audio");
    });

    it("stores audio with an audio type and is not shown as a figure", () => {
      const audio = formatOf("song.mp3", "", on)!;
      expect(storedMimeType(audio, "song.mp3", "")).toBe("audio/mpeg");
      expect(storedMimeType(audio, "memo.m4a", "")).toBe("audio/mp4");
      expect(storedMimeType(audio, "recording.webm", "")).toBe("audio/webm");
      expect(storedMimeType(audio, "call.wav", "audio/x-wav")).toBe("audio/x-wav");
      expect(mediaKindOf("audio/mpeg")).toBeNull();
      expect(DIRECT_UPLOAD_FORMATS).toContain(audio.id);
    });
  });

  it("reads a PDF page by page into located passages", async () => {
    const passages = splitIntoPassages(await CONVERTERS.pdf(fixture("acme-onboarding.pdf")));
    expect(passages[0]?.location.page).toBe(1);
    expect(passages.map((p) => p.text).join(" ")).toContain("Python 3.13");
  });

  it("keeps a page's book section on each of its passages", () => {
    const passages = splitIntoPassages([{ page: 200, text: "A claim.\n\nAnother.", sectionPath: ["Assessment", "CHAPTER 6", "Misidentifications"] }]);
    expect(passages.map((passage) => passage.location.sectionPath)).toEqual([
      ["Assessment", "CHAPTER 6", "Misidentifications"],
      ["Assessment", "CHAPTER 6", "Misidentifications"],
    ]);
  });

  it("reads a Word document into passages", async () => {
    const passages = splitIntoPassages(await CONVERTERS.docx(fixture("beta-handbook.docx")));
    expect(passages.map((p) => p.text)).toContain("Decision: Beta ships on iOS first, in March 2027.");
  });

  it("stores and describes a Word document's picture in its place, skipping icons", async () => {
    const stored: { path: string; mimeType: string; size: number }[] = [];
    const described: string[] = [];
    const pages = await CONVERTERS.docx(fixture("figure-report.docx"), {
      fileName: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      storeFigure: async (path, bytes, mimeType) => { stored.push({ path, mimeType, size: bytes.byteLength }); return path; },
      describeImage: async (image) => { described.push(image.fileName); return "Bar chart of Acme revenue.\n\nAcme revenue was 5.0 million USD in Q4."; },
    });
    expect(stored).toEqual([{ path: expect.stringMatching(/^figures\/[0-9a-f]{64}\.png$/), mimeType: "image/png", size: 12415 }]);
    expect(described).toEqual(["a picture in report.docx"]);
    const passages = splitIntoPassages(pages);
    expect(passages.map((p) => [p.text, p.location.figure ?? null])).toEqual([
      ["Revenue section.", null],
      ["Figure 1: Bar chart of Acme revenue.", stored[0]!.path],
      ["Acme revenue was 5.0 million USD in Q4.", stored[0]!.path],
      ["An icon:", null],
      ["Revenue grew in Q4.", null],
    ]);
  });

  it("still reads a Word document's text when a picture cannot be described", async () => {
    const pages = await CONVERTERS.docx(fixture("figure-report.docx"), {
      fileName: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      storeFigure: async (path) => path,
      describeImage: async () => { throw new Error("vision model down"); },
    });
    expect(splitIntoPassages(pages).map((p) => p.text)).toEqual(["Revenue section.", "An icon:", "Revenue grew in Q4."]);
  });

  it("reads Markdown with its headings as locations", async () => {
    const bytes = new TextEncoder().encode("# Plan\n\nShip in May.");
    const passages = splitIntoPassages(await CONVERTERS.markdown(bytes));
    expect(passages[1]).toMatchObject({ text: "Ship in May.", location: { heading: "Plan" } });
  });

  it("reads an image as the description a vision model writes of it, summary first", async () => {
    const bytes = fixture("acme-revenue-chart.png");
    const seen: { mimeType: string; fileName: string; size: number }[] = [];
    const pages = await CONVERTERS.image(bytes, {
      fileName: "acme-revenue-chart.png",
      mimeType: "image/png",
      describeImage: async (image) => {
        seen.push({ mimeType: image.mimeType, fileName: image.fileName, size: image.bytes.byteLength });
        return ["Bar chart of Acme Robotics' quarterly revenue.", "Q4 revenue was 5.0 million USD."].join("\n\n");
      },
    });
    expect(seen).toEqual([{ mimeType: "image/png", fileName: "acme-revenue-chart.png", size: bytes.byteLength }]);
    const passages = splitIntoPassages(pages);
    expect(passages.map((p) => p.text)).toEqual(["Bar chart of Acme Robotics' quarterly revenue.", "Q4 revenue was 5.0 million USD."]);
    expect(passages[0]?.location).toEqual({});
  });

  it("reads a video as its description, summary first, then the transcript at its times", async () => {
    const seen: string[] = [];
    const pages = await CONVERTERS.video(new Uint8Array([0, 0, 0, 24]), {
      fileName: "acme-update.mp4",
      mimeType: "video/mp4",
      readVideo: async (video) => {
        seen.push(`${video.fileName} ${video.mimeType} ${video.bytes.byteLength}`);
        return { description: "Recording of the Acme quarterly update.", transcript: [{ start: 0, text: "Revenue grew 12% in Q3." }, { start: 8.7, text: "The Rotterdam warehouse opens in March." }] };
      },
    });
    expect(seen).toEqual(["acme-update.mp4 video/mp4 4"]);
    expect(splitIntoPassages(pages).map((p) => [p.text, p.location])).toEqual([
      ["Recording of the Acme quarterly update.", {}],
      ["Revenue grew 12% in Q3. The Rotterdam warehouse opens in March.", { time: "00:00" }],
    ]);
  });

  it("reads a recording as its timestamped transcript, one passage per paragraph at its time", async () => {
    const seen: string[] = [];
    const long = "word ".repeat(100).trim();
    const pages = await CONVERTERS.audio(new Uint8Array([1, 2, 3]), {
      fileName: "standup.m4a",
      mimeType: "audio/mp4",
      readAudio: async (audio) => {
        seen.push(`${audio.fileName} ${audio.mimeType} ${audio.bytes.byteLength}`);
        return { transcript: [{ start: 0, text: " Revenue grew 12% in Q3. " }, { start: 4.2, text: "" }, { start: 9.9, text: long }, { start: 3725.4, text: "The Rotterdam warehouse opens in March." }] };
      },
    });
    expect(seen).toEqual(["standup.m4a audio/mp4 3"]);
    expect(pages.every((page) => page.page === null)).toBe(true);
    expect(splitIntoPassages(pages).map((p) => [p.text, p.location])).toEqual([
      ["Revenue grew 12% in Q3.", { time: "00:00" }],
      [long, { time: "00:09" }],
      ["The Rotterdam warehouse opens in March.", { time: "62:05" }],
    ]);
  });

  it("gives no passages for a silent recording, and refuses one with no speech-to-text reader", async () => {
    expect(await CONVERTERS.audio(new Uint8Array([1]), { fileName: "quiet.wav", mimeType: "audio/wav", readAudio: async () => ({ transcript: [] }) })).toEqual([]);
    await expect(CONVERTERS.audio(new Uint8Array([1]), { fileName: "x.mp3", mimeType: "audio/mpeg" })).rejects.toThrow(/speech-to-text/);
  });

  it("refuses a video when no model can read it", async () => {
    await expect(CONVERTERS.video(new Uint8Array([1]), { fileName: "x.mp4", mimeType: "video/mp4" })).rejects.toThrow(/NEBIUS_API_KEY/);
  });

  it("refuses an image when no model can describe it", async () => {
    await expect(CONVERTERS.image(fixture("acme-revenue-chart.png"), { fileName: "x.png", mimeType: "image/png" })).rejects.toThrow(/NEBIUS_API_KEY/);
  });
});
