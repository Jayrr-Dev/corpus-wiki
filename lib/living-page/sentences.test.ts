import { describe, expect, it } from "vitest";
import { composeBody, splitBody } from "./sentences";
import { keepCitedSentences } from "./writers/tokenFactory";

describe("composeBody", () => {
  it("joins sentences with one space and records exact offsets", () => {
    const { body, sentenceLinks } = composeBody([
      { text: "Alpha is a service.", unitIds: ["u1"] },
      { text: "  It ships in Q1.  ", unitIds: ["u2", "u3"] },
      { text: "   ", unitIds: ["u4"] },
    ]);
    expect(body).toBe("Alpha is a service. It ships in Q1.");
    expect(sentenceLinks).toEqual([
      { start: 0, end: 19, unitIds: ["u1"] },
      { start: 20, end: 35, unitIds: ["u2", "u3"] },
    ]);
    for (const link of sentenceLinks) expect(body.slice(link.start, link.end).trim()).toBe(body.slice(link.start, link.end));
  });

  it("gives an empty body for no sentences", () => {
    expect(composeBody([])).toEqual({ body: "", sentenceLinks: [] });
  });
});

describe("splitBody", () => {
  it("round-trips a composed body into linked spans", () => {
    const { body, sentenceLinks } = composeBody([
      { text: "One.", unitIds: ["a"] },
      { text: "Two.", unitIds: ["b"] },
    ]);
    const spans = splitBody(body, sentenceLinks);
    expect(spans.map((s) => s.text).join("")).toBe(body);
    expect(spans.map((s) => s.link?.unitIds ?? null)).toEqual([["a"], null, ["b"]]);
  });

  it("ignores links outside the body and keeps unlinked text", () => {
    const spans = splitBody("Hello world", [{ start: 6, end: 99, unitIds: ["x"] }]);
    expect(spans).toEqual([{ text: "Hello world", link: null }]);
  });
});

describe("keepCitedSentences", () => {
  it("drops unknown unit ids and sentences left citing nothing", () => {
    const kept = keepCitedSentences(
      [
        { text: "Known.", unitIds: ["u1", "invented", "u1"] },
        { text: "Invented.", unitIds: ["invented"] },
      ],
      new Set(["u1"]),
    );
    expect(kept).toEqual([{ text: "Known.", unitIds: ["u1"] }]);
  });
});
