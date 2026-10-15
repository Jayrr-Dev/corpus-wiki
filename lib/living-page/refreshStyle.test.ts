import { describe, expect, it } from "vitest";
import { assertStyleCoverage, styleRefreshState } from "./refreshStyle";
import type { SectionState } from "./types";

const state: SectionState = {
  sectionId: "s", title: "Overview", pageTitle: "ExampleCo", units: [
    { unitId: "a", revisionId: "ra", content: "Protection is required at 85 dB.", kind: "fact", epistemicStatus: "supported" },
    { unitId: "b", revisionId: "rb", content: "The program is planned.", kind: "fact", epistemicStatus: "supported" },
  ], lines: [
    { lineId: "generated", lineRevisionId: "lg", position: 0, content: "Generated text", author: "ai", unitIds: ["a"], needsRewrite: false },
    { lineId: "manual", lineRevisionId: "lm", position: 1, content: "Handwritten text", author: "person", unitIds: ["b"], needsRewrite: true },
  ],
};
const input = () => ({ ...styleRefreshState(state), sectionTitle: state.title, uncoveredUnitIds: [] });
describe("explicit article style refresh", () => {
  it("flags generated prose while preserving handwritten text and original state", () => {
    expect(styleRefreshState(state).lines.map((line) => line.needsRewrite)).toEqual([true, false]);
    expect(state.lines[0]?.needsRewrite).toBe(false);
    expect(state.lines[1]?.needsRewrite).toBe(true);
  });
  it("accepts changed wording without losing the claim covered by a manual line", () => {
    expect(() => assertStyleCoverage(input(), { modelVersion:"test", revise:[{lineId:"generated",text:"Protection is mandatory at 85 dB.",unitIds:["a"]}], retire:[],add:[] })).not.toThrow();
  });
  it("rejects a rewrite that drops a claim before anything is committed", () => {
    expect(() => assertStyleCoverage(input(), { modelVersion:"test", revise:[], retire:["generated"],add:[] })).toThrow("omitted 1 claims");
  });
  it("does not count invented citations or attempted edits to a protected line", () => {
    expect(() => assertStyleCoverage(input(), { modelVersion:"test", revise:[{lineId:"manual",text:"Replacement",unitIds:["a","b"]}], retire:["generated"],add:[] })).toThrow("omitted 1 claims");
  });
});
