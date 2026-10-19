import { describe, expect, it } from "vitest";
import type { SectionLine, SectionReviseInput } from "../types";
import { buildMessages, buildRefs, missingDraftClaims, PATCH_RULE, withoutInlineClaimAnnotations, withNumericSupportVerdicts } from "./tokenFactory";
import { unsupportedProseNumbers } from "../blocks";

const line = (lineId: string, unitId: string, needsRewrite: boolean): SectionLine =>
  ({ lineId, lineRevisionId: `${lineId}-r`, position: 0, content: `Line ${lineId}.`, author: "ai", unitIds: [unitId], needsRewrite });

const input = (lines: SectionLine[]): SectionReviseInput => ({
  pageTitle: "ULA application process", sectionTitle: "Application process", uncoveredUnitIds: [], lines,
  units: ["a", "b"].map((unitId) => ({ unitId, revisionId: `${unitId}-r`, content: `Claim ${unitId}.`, kind: "fact", epistemicStatus: "established" })),
});

describe("internal citation annotations", () => {
  const claims = [{ ref: "C17", claim: "The flowchart has five lanes." }, { ref: "C25", claim: "The Designer files the permit." }];
  it("removes known internal annotations without dropping a supported workflow paragraph", () => {
    const draft = { revise: [], retire: [], add: [{ text: "The flowchart has five lanes (C17, C25):\n1. The Designer files the permit [C25].", claims: ["C17", "C25"] }] };
    const cleaned = withoutInlineClaimAnnotations(draft, claims);
    expect(cleaned.add[0]?.text).toBe("The flowchart has five lanes:\n1. The Designer files the permit.");
    expect(cleaned.add[0]?.claims).toEqual(["C17", "C25"]);
    expect(unsupportedProseNumbers(cleaned.add[0]!.text, claims.map((c) => c.claim))).toEqual([]);
  });
  it("retains genuine source labels, unknown annotations and unsupported factual numbers", () => {
    const draft = { revise: [], retire: [], add: [{ text: "Inspect the terminals (C17, C25) at 99 meters (C99).", claims: ["C17", "C25"] }] };
    const cleaned = withoutInlineClaimAnnotations(draft, [{ ...claims[0]!, claim: "Inspect terminal C17 and terminal C25." }, claims[1]!]);
    expect(cleaned.add[0]?.text).toBe(draft.add[0]?.text);
    expect(unsupportedProseNumbers(cleaned.add[0]!.text, claims.map((c) => c.claim))).toContain(99);
  });
  it("does not erase a reference that the paragraph failed to cite structurally", () => {
    const draft = { revise: [], retire: [], add: [{ text: "The Designer files the permit (C25).", claims: ["C17"] }] };
    expect(withoutInlineClaimAnnotations(draft, claims).add[0]?.text).toBe(draft.add[0]?.text);
  });
});

describe("repairing numbers before the final commit guard", () => {
  const claims = [{ ref: "C1", claim: "The process is shown as a flowchart." }, { ref: "C2", claim: "The 3.1 ULA flowchart describes the application." }];
  it("requests repair when an AI-approved line omits the citation supporting its number", () => {
    const answer = { revise: [], retire: [], add: [{ text: "The 3.1 ULA process is shown as a flowchart.", claims: ["C1"] }] };
    const verdicts = withNumericSupportVerdicts(answer, claims, ["ULA process"], [{ line: "A1", supported: true, problem: "" }]);
    expect(verdicts[0]?.supported).toBe(false);
    expect(verdicts[0]?.problem).toContain("3.1");
    answer.add[0]!.claims.push("C2");
    expect(withNumericSupportVerdicts(answer, claims, ["ULA process"], [{ line: "A1", supported: true, problem: "" }])[0]?.supported).toBe(true);
  });
  it("keeps a genuinely invented factual quantity rejected", () => {
    const answer = { revise: [], retire: [], add: [{ text: "The process takes 99 days.", claims: ["C1", "C2"] }] };
    expect(withNumericSupportVerdicts(answer, claims, [], [])[0]?.supported).toBe(false);
  });
});
const system = (lines: SectionLine[]) => buildMessages(input(lines), buildRefs(input(lines))).map((message) => message.content).join(" ");

it("requests the missing substantive detail when a rewrite retires its old paragraph", () => {
  const original = input([line("1", "a", true), line("2", "b", true)]);
  expect(missingDraftClaims(original, { revise: [{ line: "L1", text: "Claim a.", claims: ["C1"] }], retire: ["L2"], add: [] })).toEqual(["C2"]);
  expect(missingDraftClaims(original, { revise: [{ line: "L1", text: "Claims a and b.", claims: ["C1", "C2"] }], retire: ["L2"], add: [] })).toEqual([]);
});

describe("writer prompt", () => {
  it("uses precise patches for all existing sections", () => {
    expect(system([line("1", "a", true), line("2", "b", true)])).toContain(PATCH_RULE);
    expect(system([line("1", "a", true), line("2", "b", false)])).toContain(PATCH_RULE);
    expect(system([line("1", "a", true)])).toContain(PATCH_RULE);
    expect(system([])).not.toContain(PATCH_RULE);
  });
});
