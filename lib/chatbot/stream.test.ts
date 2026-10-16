import { describe, expect, it } from "vitest";
import { partialAnswer } from "./stream";

describe("streamed answer decoding", () => {
  it("decodes every chunk boundary without exposing JSON or citations metadata", () => {
    const answer = '### Safety\n\nUse **labels** and "SDS". Path \\ [K1]';
    const json = JSON.stringify({ answer, citations: ["K1"] });
    let previous = "";
    for (let end = 0; end <= json.length; end++) {
      const partial = partialAnswer(json.slice(0, end));
      expect(answer.startsWith(partial)).toBe(true);
      expect(partial.startsWith(previous)).toBe(true);
      previous = partial;
    }
    expect(previous).toBe(answer);
  });
  it("waits for complete Unicode escapes", () => {
    expect(partialAnswer('{"answer":"Hello \\u20')).toBe("Hello ");
    expect(partialAnswer('{"answer":"Hello \\u2022')).toBe("Hello •");
    expect(partialAnswer('{"citations":[]')).toBe("");
  });
  it("builds readable sections progressively, even when the model emits no line breaks", () => {
    const json = JSON.stringify({ answer: "Three themes.", sections: [{ heading: "Safety", body: "Check labels [K1]." }, { heading: "Quality", body: "Inspect early." }], citations: ["K1"] });
    expect(partialAnswer(json)).toBe("Three themes.\n\n### Safety\n\nCheck labels [K1].\n\n### Quality\n\nInspect early.");
    expect(partialAnswer(json.slice(0, json.indexOf("Inspect") + 3)).endsWith("### Quality\n\nIns")).toBe(true);
  });
});
