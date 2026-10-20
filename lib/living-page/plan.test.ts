import { describe, expect, it } from "vitest";
import { needsRewrite, releaseIrrelevantClaims, revisionToActions, uncoveredUnitIds } from "./plan";
import type { SectionState } from "./types";

// A SECTION WITH ONE FLAGGED LINE, ONE CURRENT LINE AND ONE UNCOVERED CLAIM
const unit = (n: number) => ({ unitId: `u${n}`, revisionId: `r${n}`, content: `Claim ${n}.`, kind: "fact" as const, epistemicStatus: "supported" as const });
const line = (n: number, unitIds: string[], needsRewrite: boolean) =>
  ({ lineId: `l${n}`, lineRevisionId: `lr${n}`, position: n, content: `Line ${n}.`, author: "ai" as const, unitIds, needsRewrite });
const STATE: SectionState = {
  sectionId: "s1",
  title: "Overview",
  pageTitle: "Project Alpha",
  units: [unit(1), unit(2), unit(3)],
  lines: [line(0, ["u1"], true), line(1, ["u2"], false)],
};

describe("section plan", () => {
  it("finds the claims no line states and flags the section", () => {
    expect(uncoveredUnitIds(STATE)).toEqual(["u3"]);
    expect(needsRewrite(STATE)).toBe(true);
  });

  it("keeps edits to flagged lines and cited new lines only", () => {
    const actions = revisionToActions(
      {
        revise: [{ lineId: "l0", text: " New 1. ", unitIds: ["u1", "unknown"] }, { lineId: "l1", text: "Not allowed.", unitIds: ["u2"] }],
        retire: ["l1"],
        add: [{ text: "Claim 3.", unitIds: ["u3"] }, { text: "Uncited.", unitIds: [] }],
        modelVersion: "fake",
      },
      STATE,
    );
    expect(actions).toEqual([
      { type: "revise_line", targetId: "l0", expectedRevisionId: null, passageIds: [], speechAct: null, input: { content: "New 1.", unitRevisionIds: ["r1"], expectedLineRevisionId: "lr0" } },
      { type: "write_line", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input: { sectionId: "s1", position: 2, content: "Claim 3.", unitRevisionIds: ["r3"] } },
    ]);
  });

  it("removes an omitted claim the surviving lines do not cite", () => {
    const query = { article: true, unitIds: ["u1", "u2", "u3"] };
    expect(releaseIrrelevantClaims("s1", query, new Set(["u3"]), new Set(["u1", "u2"]))).toMatchObject({
      type: "update_section_query", targetId: "s1", input: { query: { article: true, unitIds: ["u1", "u2"] }, fromQuery: query },
    });
    expect(releaseIrrelevantClaims("s1", query, new Set(["u2"]), new Set(["u2"]))).toBeNull();
  });

  it("drops a chart whose numbers the cited claims do not state", () => {
    const chart = (a: number, b: number) => ["Totals:", "```chart bar Totals", `A: ${a}`, `B: ${b}`, "```"].join("\n");
    const actions = revisionToActions({ revise: [], retire: [], add: [{ text: chart(1, 2), unitIds: ["u1", "u2"] }, { text: chart(1, 9), unitIds: ["u1", "u2"] }], modelVersion: "fake" }, STATE);
    expect(actions.map((action) => (action.input as { content: string }).content)).toEqual([chart(1, 2), "Totals:"]);
  });

  it("drops a revised or new line whose prose states a number the cited claims do not", () => {
    const dropped: { text: string; numbers: number[] }[] = [];
    const actions = revisionToActions({
      revise: [{ lineId: "l0", text: "Claim 1 holds for 30 days.", unitIds: ["u1"] }],
      retire: [],
      add: [{ text: "Claim 3 applies.", unitIds: ["u3"] }, { text: "Claim 3 applies to 12 sites.", unitIds: ["u3"] }],
      modelVersion: "fake",
    }, STATE, (line) => dropped.push(line));
    expect(actions.map((action) => [action.type, (action.input as { content?: string }).content])).toEqual([["write_line", "Claim 3 applies."]]);
    expect(dropped).toEqual([{ text: "Claim 1 holds for 30 days.", numbers: [30] }, { text: "Claim 3 applies to 12 sites.", numbers: [12] }]);
  });
});
