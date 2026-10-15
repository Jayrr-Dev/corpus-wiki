import { describe, expect, it } from "vitest";
import {
  buildDescribeImageMessages,
  DEFAULT_VISION_MODEL,
  describeImageAnswerToText,
  MAX_IMAGE_BYTES,
  requireDescribableImage,
  resolveVisionModel,
} from "./describeMedia";
import { splitIntoPassages } from "./passages";

describe("image descriptions", () => {
  it("sends the picture inline as a data URL next to its file name", () => {
    const [system, user] = buildDescribeImageMessages({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", fileName: "chart.png" });
    expect(system?.role).toBe("system");
    expect(user?.content).toEqual([
      { type: "text", text: "File name: chart.png" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
    ]);
  });

  it("writes the summary first, one passage per detail, with no stray headings or bullets", () => {
    const text = describeImageAnswerToText({
      summary: "  Bar chart of Acme   revenue. ",
      details: ["# Q1 revenue was 2.0 million USD.", "- Q4 revenue was 5.0 million USD.", "", "- Q4 revenue was 5.0 million USD."],
    });
    expect(splitIntoPassages([{ page: null, text }]).map((passage) => passage.text)).toEqual([
      "Bar chart of Acme revenue.",
      "Q1 revenue was 2.0 million USD.",
      "Q4 revenue was 5.0 million USD.",
    ]);
  });

  it("uses a vision model, AI_VISION_MODEL when set", () => {
    expect(resolveVisionModel({} as NodeJS.ProcessEnv)).toBe(DEFAULT_VISION_MODEL);
    expect(resolveVisionModel({ AI_VISION_MODEL: "google/gemma-3-27b-it" } as unknown as NodeJS.ProcessEnv)).toBe("google/gemma-3-27b-it");
  });

  it("refuses an image too large to send", () => {
    expect(() => requireDescribableImage({ bytes: new Uint8Array(MAX_IMAGE_BYTES + 1), mimeType: "image/png", fileName: "big.png" })).toThrow(/up to 10 MB/);
  });
});
