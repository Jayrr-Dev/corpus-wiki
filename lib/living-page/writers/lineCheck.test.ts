import { afterEach, describe, expect, it, vi } from "vitest";
import { roleForPurpose } from "@/lib/ai/roles";
import type { SectionReviseInput } from "../types";
import { TokenFactorySectionWriter } from "./tokenFactory";

// The model is a queue of answers per call name (section_lines, line_fact_check); every request is kept
function fakeModel(answers: Record<string, unknown[]>) {
  const requests: { name: string; body: { messages: { role: string; content: string }[] } }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const name = body.response_format.json_schema.name as string;
    requests.push({ name, body });
    const answer = answers[name]?.shift();
    if (!answer) throw new Error(`No answer queued for ${name}`);
    return new Response(JSON.stringify({ model: "test", usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer) } }] }));
  }));
  return requests;
}

const INPUT: SectionReviseInput = {
  pageTitle: "Noise protection at ExampleCo", sectionTitle: "Hearing protection", lines: [], uncoveredUnitIds: ["noise", "plan"],
  units: [
    { unitId: "noise", revisionId: "r1", content: "ExampleCo requires hearing protection for employees exposed to noise of 85 dB or greater.", kind: "procedure", epistemicStatus: "established" },
    { unitId: "plan", revisionId: "r2", content: "ExampleCo plans to introduce a Hearing Conservation Program.", kind: "fact", epistemicStatus: "supported" },
  ],
};
const GOOD = { text: "Hearing protection is required at ExampleCo for employees exposed to noise of 85 dB or greater.", claims: ["C1"] };
const INVENTED = { text: "ExampleCo runs a Hearing Conservation Program with annual hearing tests.", claims: ["C2"] };
const FIXED = { text: "ExampleCo plans to introduce a Hearing Conservation Program.", claims: ["C2"] };
const writerAnswer = (...add: unknown[]) => ({ revise: [], retire: [], add });
const UPHELD = { lineHasFault: true, reason: "The claim says the program is only planned." };
const REJECTED = { lineHasFault: false, reason: "The claim states this." };
const verdicts = (...lines: [string, boolean, string?, string[]?][]) => ({ lines: lines.map(([ref, supported, problem, missingCitations]) => ({ ref, supported, problem: problem ?? "", missingCitations: missingCitations ?? [], unstatedCitations: [] })) });

describe("line fact-check", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs on the Reviewer's model", () => {
    expect(roleForPurpose("line_fact_check")).toBe("reviewer");
    expect(roleForPurpose("line_fact_confirm")).toBe("reviewer");
  });

  it("keeps supported lines after one check, showing each line only its cited claims", async () => {
    const requests = fakeModel({ section_lines: [writerAnswer(GOOD, FIXED)], line_fact_check: [verdicts(["A1", true], ["A2", true])] });
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT);
    expect(requests.map((request) => request.name)).toEqual(["section_lines", "line_fact_check"]);
    const checked = JSON.parse(requests[1]!.body.messages.at(-1)!.content);
    expect(checked.lines).toEqual([
      { ref: "A1", text: GOOD.text, claims: [expect.objectContaining({ ref: "C1", claim: INPUT.units[0]!.content })] },
      { ref: "A2", text: FIXED.text, claims: [expect.objectContaining({ ref: "C2", claim: INPUT.units[1]!.content })] },
    ]);
    expect(revision.add).toEqual([{ text: GOOD.text, unitIds: ["noise"] }, { text: FIXED.text, unitIds: ["plan"] }]);
    expect(revision).toMatchObject({ tokensIn: 20, tokensOut: 10 });
  });

  it("sends a failed line back once with the problem and keeps the fix", async () => {
    const requests = fakeModel({
      section_lines: [writerAnswer(GOOD, INVENTED), writerAnswer(GOOD, FIXED)],
      line_fact_check: [verdicts(["A1", true], ["A2", false, "\"runs\" and \"annual hearing tests\": the claim says the program is only planned."]), verdicts(["A1", true], ["A2", true])],
      line_fact_confirm: [UPHELD],
    });
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT);
    expect(requests.map((request) => request.name)).toEqual(["section_lines", "line_fact_check", "line_fact_confirm", "section_lines", "line_fact_check"]);
    expect(JSON.parse(requests[2]!.body.messages.at(-1)!.content)).toMatchObject({ line: INVENTED.text, objection: expect.stringContaining("annual hearing tests") });
    const repair = requests[3]!.body.messages.at(-1)!.content;
    expect(repair).toContain("annual hearing tests");
    expect(repair).toContain("Keep every other line exactly as it was");
    expect(revision.add.map((line) => line.text)).toEqual([GOOD.text, FIXED.text]);
    expect(revision).toMatchObject({ tokensIn: 50, tokensOut: 25 });
  });

  it("drops a line that still fails after the fix and keeps the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeModel({
      section_lines: [writerAnswer(GOOD, INVENTED), writerAnswer(GOOD, INVENTED)],
      line_fact_check: [verdicts(["A1", true], ["A2", false, "invented tests"]), verdicts(["A1", true], ["A2", false, "invented tests"])],
      line_fact_confirm: [UPHELD, UPHELD],
    });
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT);
    expect(revision.add).toEqual([{ text: GOOD.text, unitIds: ["noise"] }]);
    expect(warn).toHaveBeenCalledWith("Writer line dropped by the fact-check", expect.objectContaining({ line: "A2", problem: "invented tests" }));
    warn.mockRestore();
  });

  it("checks revised lines by their line ref and drops only the failed one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const input: SectionReviseInput = { ...INPUT, uncoveredUnitIds: [], lines: [
      { lineId: "l1", lineRevisionId: "lr1", position: 0, content: "Old noise text.", author: "ai", unitIds: ["noise"], needsRewrite: true },
      { lineId: "l2", lineRevisionId: "lr2", position: 1, content: "Old plan text.", author: "ai", unitIds: ["plan"], needsRewrite: true },
    ] };
    const answer = { revise: [{ line: "L1", ...GOOD }, { line: "L2", ...INVENTED }], retire: [], add: [] };
    fakeModel({ section_lines: [answer, answer], line_fact_check: [verdicts(["L1", true], ["L2", false, "x"]), verdicts(["L1", true], ["L2", false, "x"])], line_fact_confirm: [UPHELD, UPHELD] });
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(input);
    expect(revision.revise).toEqual([{ lineId: "l1", text: GOOD.text, unitIds: ["noise"] }]);
    vi.restoreAllMocks();
  });

  it("matches a verdict that echoes the line's text instead of its ref", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeModel({
      section_lines: [writerAnswer(GOOD, INVENTED), writerAnswer(GOOD, INVENTED)],
      line_fact_check: [verdicts([GOOD.text, true], [` ${INVENTED.text.toUpperCase()} `, false, "x"]), verdicts(["A1", true], [INVENTED.text, false, "x"])],
      line_fact_confirm: [UPHELD, UPHELD],
    });
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT);
    expect(revision.add.map((line) => line.text)).toEqual([GOOD.text]);
    vi.restoreAllMocks();
  });

  it("keeps a line without asking for a fix when the second opinion rejects the objection", async () => {
    const requests = fakeModel({ section_lines: [writerAnswer(GOOD, FIXED)], line_fact_check: [verdicts(["A1", false, "misread"], ["A2", true])], line_fact_confirm: [REJECTED] });
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT);
    expect(requests.map((request) => request.name)).toEqual(["section_lines", "line_fact_check", "line_fact_confirm"]);
    expect(revision.add).toHaveLength(2);
  });

  it("adds a citation the line forgot instead of failing it", async () => {
    const both = { text: `${GOOD.text} ExampleCo plans to introduce a Hearing Conservation Program.`, claims: ["C1"] };
    const requests = fakeModel({ section_lines: [writerAnswer(both)], line_fact_check: [verdicts(["A1", false, "plans to introduce a program: C1 does not say this", ["C2", "C9"]])], line_fact_confirm: [REJECTED] });
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT);
    expect(JSON.parse(requests[1]!.body.messages.at(-1)!.content).sectionClaims.map((claim: { ref: string }) => claim.ref)).toEqual(["C1", "C2"]);
    expect(JSON.parse(requests[2]!.body.messages.at(-1)!.content).claims.map((claim: { ref: string }) => claim.ref)).toEqual(["C1", "C2"]);
    expect(requests.map((request) => request.name)).toEqual(["section_lines", "line_fact_check", "line_fact_confirm"]);
    expect(revision.add).toEqual([{ text: both.text, unitIds: ["noise", "plan"] }]);
  });

  it("shows the writer what the page's other sections already say", async () => {
    const requests = fakeModel({ section_lines: [writerAnswer(GOOD, FIXED)], line_fact_check: [verdicts(["A1", true], ["A2", true])] });
    const pageContext = [{ section: "Overview", text: "ExampleCo requires hearing protection." }, { section: "Programs", text: "x".repeat(9000) }];
    await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection({ ...INPUT, pageContext });
    const sent = JSON.parse(requests[0]!.body.messages.at(-1)!.content);
    expect(sent.otherSections[0]).toEqual(pageContext[0]);
    expect(sent.otherSections[1].text.length).toBeLessThan(8100);
    expect(requests[0]!.body.messages.some((message) => message.content.includes("otherSections shows what the page's other sections already say"))).toBe(true);
  });

  it("keeps and logs a line the check gives no verdict for", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeModel({ section_lines: [writerAnswer(GOOD, FIXED)], line_fact_check: [verdicts(["A1", true])] });
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT);
    expect(revision.add).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith("Fact-check gave no verdict for some lines; they are kept", expect.objectContaining({ missing: ["A2"] }));
    warn.mockRestore();
  });
});
