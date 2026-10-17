import { beforeEach, it, expect, vi } from "vitest";
import { selectCandidateSections, isHighCandidate, type CandidateAssessment } from "./candidates";
import { chatJson } from "@/lib/ai/chat";
vi.mock("@/lib/ai/chat", () => ({ chatJson: vi.fn() }));
const high: CandidateAssessment = { section: "Clearance", visuallyExplainable: true, useful: true, supported: true, distinct: true, priority: 5, evidence: ["P1"], learningGoal: "Where the gap is measured", reason: "Spatial gap" };
const article = { title: "Test", sourceUrl: "/p/test", paragraphs: [{ id: "P1", text: "Gap", section: "Clearance" }, { id: "P2", text: "More gap", section: "Clearance" }, { id: "P3", text: "Workflow", section: "Process" }], existingFigures: [] };
beforeEach(() => vi.clearAllMocks());
it.each(["visuallyExplainable", "useful", "supported", "distinct"] as const)("requires the %s gate", (gate) => { expect(isHighCandidate({ ...high, [gate]: false })).toBe(false); });
it("does not qualify nice-to-have, unevidenced or decorative sections", () => { expect(isHighCandidate({ ...high, priority: 3 })).toBe(false); expect(isHighCandidate({ ...high, evidence: [] })).toBe(false); });
it("skips a whole illustrated section, not only the image's paragraph", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { sections: [{ ...high, section: "Process", evidence: ["P3"] }] }, model: "test", tokensIn: 1, tokensOut: 1 });
  const result = await selectCandidateSections({ apiKey: "test" }, { ...article, existingFigures: [{ after: "P2", learningGoal: "Gap" }] });
  expect(result.selected).toEqual(["Process"]);
  expect(JSON.parse(String(vi.mocked(chatJson).mock.calls[0]![1].messages[1]!.content)).sections).toEqual(["Process"]);
});
it("selects only the strongest missing section", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { sections: [high, { ...high, section: "Process", evidence: ["P3"], priority: 4 }] }, model: "test", tokensIn: 1, tokensOut: 1 });
  expect((await selectCandidateSections({ apiKey: "test" }, { ...article, newFigureBudget: 1 })).selected).toEqual(["Clearance"]);
});
it("makes no AI call when every section already has a figure", async () => {
  expect((await selectCandidateSections({ apiKey: "test" }, { ...article, existingFigures: [{ after: "P2", learningGoal: "Gap" }, { after: "P3", learningGoal: "Workflow" }] })).selected).toEqual([]);
  expect(chatJson).not.toHaveBeenCalled();
});
it("fills multiple distinct high candidates when the article has room", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { sections: [high, { ...high, section: "Process", evidence: ["P3"], priority: 4 }] }, model: "test", tokensIn: 1, tokensOut: 1 });
  expect((await selectCandidateSections({ apiKey: "test" }, { ...article, newFigureBudget: 2 })).selected).toEqual(["Clearance", "Process"]);
});
it("rejects invented sections and evidence from an unrelated section", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { sections: [{ ...high, section: "Invented" }] }, model: "test", tokensIn: 1, tokensOut: 1 });
  await expect(selectCandidateSections({ apiKey: "test" }, article)).rejects.toThrow("invalid section");
});
