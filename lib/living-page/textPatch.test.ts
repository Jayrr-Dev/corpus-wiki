import { describe, expect, it } from "vitest";
import { applyTextPatches } from "./textPatch";
import { materializePatchAnswer } from "./writers/patchAnswer";
import { revisionToActions } from "./plan";
import type { SectionReviseInput } from "./types";

describe("exact text patches", () => {
  it("copies untouched Unicode, whitespace and line breaks exactly, irrespective of patch order", () => {
    const original = "  Ω — old\r\n\tKeep 🧠 unchanged. Last word.  ";
    expect(applyTextPatches(original, [{ old_str: "Last", new_str: "Final" }, { old_str: "old", new_str: "new" }]))
      .toBe("  Ω — new\r\n\tKeep 🧠 unchanged. Final word.  ");
    expect(applyTextPatches(original, [])).toBe(original);
  });
  it.each([
    ["abc", [{ old_str: "", new_str: "x" }]],
    ["abc", [{ old_str: "ABC", new_str: "x" }]],
    ["aaa", [{ old_str: "aa", new_str: "x" }]],
    ["abc", [{ old_str: "ab", new_str: "x" }, { old_str: "bc", new_str: "y" }]],
    ["abc", [{ old_str: "a", new_str: "x" }, { old_str: "x", new_str: "y" }]],
  ] as const)("rejects ambiguous, missing, overlapping and sequential anchors", (original, patches) => {
    expect(() => applyTextPatches(original, patches)).toThrow();
  });
  it("supports anchored insertions and deletions", () => {
    expect(applyTextPatches("A B C", [{ old_str: "A", new_str: "A new" }, { old_str: " B", new_str: "" }])).toBe("A new C");
  });
});

const input: SectionReviseInput = {
  pageTitle: "Inspections", sectionTitle: "Schedule", uncoveredUnitIds: [],
  units: [{ unitId: "u", revisionId: "r", content: "Inspect weekly.", kind: "fact", epistemicStatus: "supported" }],
  lines: [{ lineId: "l", lineRevisionId: "lr", position: 0, content: "  Inspect weekly.  ", author: "ai", unitIds: ["u"], unitRevisionIds: ["r"], needsRewrite: true, needsCitationRefresh: false }],
};
const proposal = { revise: [{ line: "L1", patches: [], claims: ["C1"] }], retire: [], add: [] };
describe("patch adapters and citation-only edits", () => {
  it("permits unchanged editable paragraphs but requires a stale paragraph to be checked", () => {
    expect(materializePatchAnswer({ ...proposal, revise: [] }, input).revise).toEqual([]);
    expect(() => materializePatchAnswer({ ...proposal, revise: [] }, { ...input, lines: [{ ...input.lines[0]!, needsCitationRefresh: true }] })).toThrow();
  });
  it("rejects protected lines, unknown evidence and conflicting operations", () => {
    expect(() => materializePatchAnswer(proposal, { ...input, lines: [{ ...input.lines[0]!, author: "person" }] })).toThrow();
    expect(() => materializePatchAnswer({ ...proposal, revise: [{ ...proposal.revise[0]!, claims: ["C9"] }] }, input)).toThrow();
    expect(() => materializePatchAnswer({ ...proposal, retire: [{ line: "L1", old_text: input.lines[0]!.content }] }, input)).toThrow();
  });
  it("omits true no-ops, but keeps new citation revisions without trimming text", () => {
    const text = materializePatchAnswer(proposal, input).revise[0]!.text;
    const revision = { textPatches: true, modelVersion: "test", revise: [{ lineId: "l", text, unitIds: ["u"] }], retire: [], add: [] };
    const state = { ...input, title: input.sectionTitle, sectionId: "s" };
    expect(revisionToActions(revision, state)).toEqual([]);
    const actions = revisionToActions(revision, { ...state, units: [{ ...state.units[0]!, revisionId: "new-r" }] });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.input).toMatchObject({ content: input.lines[0]!.content, expectedLineRevisionId: "lr", unitRevisionIds: ["new-r"] });
  });
});
