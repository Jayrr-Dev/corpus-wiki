import { describe, expect, it } from "vitest";
import type { SectionLine, SectionReviseInput } from "../types";
import { buildMessages, buildRefs, REGROUP_RULE } from "./tokenFactory";

const line = (lineId: string, unitId: string, needsRewrite: boolean): SectionLine =>
  ({ lineId, lineRevisionId: `${lineId}-r`, position: 0, content: `Line ${lineId}.`, author: "ai", unitIds: [unitId], needsRewrite });

const input = (lines: SectionLine[]): SectionReviseInput => ({
  pageTitle: "ULA application process", sectionTitle: "Application process", uncoveredUnitIds: [], lines,
  units: ["a", "b"].map((unitId) => ({ unitId, revisionId: `${unitId}-r`, content: `Claim ${unitId}.`, kind: "fact", epistemicStatus: "established" })),
});
const system = (lines: SectionLine[]) => buildMessages(input(lines), buildRefs(input(lines)))[0]?.content;

describe("writer prompt", () => {
  it("asks for regrouped paragraphs when every line is rewritten (Update)", () => {
    expect(system([line("1", "a", true), line("2", "b", true)])).toContain(REGROUP_RULE);
  });

  it("leaves line-by-line edits alone when only some lines changed, or there is one line", () => {
    expect(system([line("1", "a", true), line("2", "b", false)])).not.toContain(REGROUP_RULE);
    expect(system([line("1", "a", true)])).not.toContain(REGROUP_RULE);
    expect(system([])).not.toContain(REGROUP_RULE);
  });
});
