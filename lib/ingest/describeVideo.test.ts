import { describe, expect, it } from "vitest";
import {
  buildDescribeVideoMessages,
  DEFAULT_TRANSCRIBE_MODEL,
  describeVideoAnswerToText,
  formatVideoTime,
  frameTimes,
  groupTranscript,
  resolveTranscribeModel,
  videoPages,
} from "./describeVideo";
import { splitIntoPassages } from "./passages";

describe("video sources", () => {
  it("writes times as mm:ss, minutes counting on past an hour", () => {
    expect(formatVideoTime(0)).toBe("00:00");
    expect(formatVideoTime(83.9)).toBe("01:23");
    expect(formatVideoTime(4503)).toBe("75:03");
    expect(formatVideoTime(-2)).toBe("00:00");
  });

  it("takes frames from the middle of equal stretches, never the very start or end", () => {
    expect(frameTimes(60, 3)).toEqual([10, 30, 50]);
    expect(frameTimes(0)).toEqual([0]);
    expect(frameTimes(Number.NaN)).toEqual([0]);
  });

  it("joins Whisper's short segments into paragraphs that keep their start time", () => {
    const long = "word ".repeat(80).trim();
    expect(groupTranscript([
      { start: 0, text: " Welcome to the update. " },
      { start: 3.2, text: "Revenue grew twelve percent." },
      { start: 7, text: "  " },
      { start: 9, text: long },
      { start: 20, text: "Maria leads logistics." },
    ])).toEqual([
      { start: 0, text: "Welcome to the update. Revenue grew twelve percent." },
      { start: 9, text: `${long} Maria leads logistics.` },
    ]);
  });

  it("puts the description first (the caption, with no time), then the transcript at its times", () => {
    const passages = splitIntoPassages(videoPages({
      description: "Recording of the Acme quarterly update.\n\nA slide reads Q3 revenue up 12 percent.",
      transcript: [{ start: 0, text: "Welcome to the update." }, { start: 640, text: "x ".repeat(240) }, { start: 700, text: "The Rotterdam warehouse opens in March." }],
    }));
    expect(passages.map((passage) => [passage.text.slice(0, 40), passage.location])).toEqual([
      ["Recording of the Acme quarterly update.", {}],
      ["A slide reads Q3 revenue up 12 percent.", {}],
      ["Welcome to the update.", { time: "00:00" }],
      ["x ".repeat(20), { time: "10:40" }],
      ["The Rotterdam warehouse opens in March.", { time: "11:40" }],
    ]);
  });

  it("keeps the transcript when the model wrote no description", () => {
    expect(videoPages({ description: " ", transcript: [{ start: 5, text: "Hello." }] })).toEqual([{ page: null, text: "Hello.", time: "00:05" }]);
  });

  it("sends the transcript, then each frame after its time", () => {
    const [system, user] = buildDescribeVideoMessages("update.mp4", [{ time: 2.5, jpeg: new Uint8Array([1, 2, 3]) }], [{ start: 61, text: " Revenue grew. " }]);
    expect(system?.role).toBe("system");
    expect(user?.content).toEqual([
      { type: "text", text: "File name: update.mp4\n\nTranscript:\n[01:01] Revenue grew." },
      { type: "text", text: "Frame at 00:02:" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" } },
    ]);
    const [, silent] = buildDescribeVideoMessages("silent.webm", [], []);
    expect(silent?.content).toEqual([{ type: "text", text: "File name: silent.webm\n\nTranscript:\n(no speech)" }]);
  });

  it("drops details that only report what was said (the transcript carries those)", () => {
    expect(describeVideoAnswerToText({
      summary: "Acme quarterly update on Q3 revenue.",
      details: ["The transcript states that revenue grew 12 percent.", "The speaker says Maria leads logistics.", "A title card reads Acme Q3 revenue up 12 percent."],
    })).toBe("Acme quarterly update on Q3 revenue.\n\nA title card reads Acme Q3 revenue up 12 percent.");
  });

  it("transcribes with Whisper, AI_TRANSCRIBE_MODEL when set", () => {
    expect(resolveTranscribeModel({} as NodeJS.ProcessEnv)).toBe(DEFAULT_TRANSCRIBE_MODEL);
    expect(resolveTranscribeModel({ AI_TRANSCRIBE_MODEL: "onnx-community/whisper-small" } as unknown as NodeJS.ProcessEnv)).toBe("onnx-community/whisper-small");
  });
});
