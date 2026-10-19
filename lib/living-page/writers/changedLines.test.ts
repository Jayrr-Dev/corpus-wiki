import { expect, it, vi } from "vitest";
import { chatJson } from "@/lib/ai/chat";
import type { SectionLine, SectionReviseInput } from "../types";
import { TokenFactorySectionWriter } from "./tokenFactory";

vi.mock("@/lib/ai/chat", async (original) => ({ ...await original<object>(), chatJson: vi.fn() }));

const line = (index: number, unitIds: string[], revisions: string[]): SectionLine =>
  ({ lineId: `l${index}`, lineRevisionId: `l${index}-r`, position: index, content: `Paragraph ${["one", "two", "three"][index - 1]} text.`, author: "ai", unitIds, unitRevisionIds: revisions, needsRewrite: true });

it("re-checks only paragraphs whose wording or evidence changed, and re-selects only new or revised claims", async () => {
  const sent: Record<string, unknown[]> = {};
  vi.mocked(chatJson).mockImplementation(async (_settings, request) => {
    const last = String(request.messages.findLast(message => message.role === "user")!.content);
    if (!last.startsWith("{")) throw new Error(`${request.name}: ${last.slice(0, 300)}`);
    const user = JSON.parse(last) as { lines?: { ref: string }[]; claims?: { ref: string }[] };
    sent[request.name] = [...(sent[request.name] ?? []), ...(user.lines ?? user.claims ?? []).map(item => item.ref)];
    const answer = (value: unknown) => ({ value, tokensIn: 1, tokensOut: 1, model: "test" });
    if (request.name === "independent_section_editorial_selection") return answer({ omit: [] });
    if (request.name === "section_lines") return answer({ retire: [], add: [], revise: [
      { line: "L1", patches: [], claims: ["C1"] }, // a claim left: citation-only update, wording unchanged
      { line: "L2", patches: [{ old_str: "Paragraph two text.", new_str: "Paragraph two, revised." }], claims: ["C2"] }, // its claim was revised
      { line: "L3", patches: [], claims: ["C1"] }, // nothing changed
    ] });
    if (request.name === "line_fact_check") return answer({ lines: (user.lines ?? []).map(item => ({ ref: item.ref, problem: "", missingCitations: [], unstatedCitations: [], supported: true })) });
    if (request.name === "independent_section_editorial_review") return answer({ issues: [] });
    throw new Error(request.name);
  });
  const input: SectionReviseInput = {
    pageTitle: "Enneagram", sectionTitle: "Levels", uncoveredUnitIds: [], pageContext: [{ section: "Overview", text: "The Enneagram has nine types." }],
    units: [{ unitId: "a", revisionId: "a-r", content: "Claim a.", kind: "fact", epistemicStatus: "established" }, { unitId: "c", revisionId: "c-r2", content: "Claim c, revised.", kind: "fact", epistemicStatus: "established" }],
    lines: [line(1, ["a", "b"], ["a-r", "b-r"]), line(2, ["c"], ["c-r1"]), line(3, ["a"], ["a-r"])],
  };
  await new TokenFactorySectionWriter({ apiKey: "test" }).reviseSection(input);
  expect(sent.independent_section_editorial_selection).toEqual(["C2"]);
  expect(sent.line_fact_check).toEqual(["L1", "L2"]);
  expect(sent.independent_section_editorial_review).toEqual(["L2"]);
});
