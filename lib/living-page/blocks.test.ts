import { describe, expect, it } from "vitest";
import { blockSummary, isBlock, parseBlocks, withSupportedCharts } from "./blocks";

describe("parseBlocks", () => {
  it("reads a plain line as one paragraph, as before", () => {
    const line = "Employee-owned PPE is not allowed. Supervisors report to management.";
    expect(parseBlocks(line)).toEqual([{ kind: "text", text: line }]);
    expect(isBlock(line)).toBe(false);
  });

  it("reads a lead-in sentence followed by a bulleted list", () => {
    expect(parseBlocks("Basic items, worn at all times, include:\n- Hard hats\n- Safety glasses\n* Safety footwear")).toEqual([
      { kind: "text", text: "Basic items, worn at all times, include:" },
      { kind: "bullets", items: ["Hard hats", "Safety glasses", "Safety footwear"] },
    ]);
  });

  it("reads numbered steps and a callout", () => {
    expect(parseBlocks("1. Report the accident\n2) Notify management\n> Critical injuries go to the authorities.")).toEqual([
      { kind: "numbered", items: ["Report the accident", "Notify management"] },
      { kind: "callout", text: "Critical injuries go to the authorities." },
    ]);
  });

  it("reads a pipe table with or without the rule row, padding short rows", () => {
    const expected = { kind: "table", header: ["Class", "Examples"], rows: [["A", "Fighting, theft"], ["B", ""]] };
    expect(parseBlocks("| Class | Examples |\n|---|---|\n| A | Fighting, theft |\n| B |")).toEqual([expected]);
    expect(parseBlocks("| Class | Examples |\n| A | Fighting, theft |\n| B |")).toEqual([expected]);
  });

  it("reads a chart with its kind, title and values", () => {
    expect(parseBlocks("```chart bar Incidents by quarter\nQ1: 4\nQ2: 1,200\nShare: 45%\n```")).toEqual([
      { kind: "chart", chart: "bar", title: "Incidents by quarter", points: [
        { label: "Q1", value: 4, display: "4" },
        { label: "Q2", value: 1200, display: "1,200" },
        { label: "Share", value: 45, display: "45%" },
      ] },
    ]);
  });

  it("keeps a broken chart as text instead of losing words", () => {
    const parts = parseBlocks("```chart bar Hours\nCrew A: lots\n```");
    expect(parts.every((part) => part.kind === "text")).toBe(true);
    expect(parseBlocks("```chart radar Hours\nA: 1\nB: 2\n```")[0]?.kind).toBe("text");
    expect(parseBlocks("```chart bar Hours\nA: 1\nB: 2")[0]?.kind).toBe("text");
  });

  it("summarizes a block as one run of words", () => {
    expect(blockSummary("Items:\n- Hard hats\n- Gloves")).toBe("Items: Hard hats; Gloves");
  });
});

describe("withSupportedCharts", () => {
  const chart = "Incidents rose.\n```chart bar Incidents by quarter\nQ1: 4\nQ2: 6\n```";

  it("keeps a chart whose every value is in a cited claim", () => {
    expect(withSupportedCharts(chart, ["There were 4 incidents in Q1.", "Q2 had 6 incidents."])).toBe(chart);
  });

  it("removes a chart with a value no claim states, keeping the rest of the line", () => {
    expect(withSupportedCharts(chart, ["There were 4 incidents in Q1."])).toBe("Incidents rose.");
  });

  it("leaves lines without charts untouched", () => {
    expect(withSupportedCharts("- 7 items", [])).toBe("- 7 items");
  });
});
