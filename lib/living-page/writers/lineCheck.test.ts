import { InvalidStructuredAnswerError } from "@/lib/ai/chat";
import { roleForPurpose } from "@/lib/ai/roles";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionReviseInput } from "../types";
import { checkEditorialDraft } from "./editorialSelection";
import { TokenFactorySectionWriter } from "./tokenFactory";

// These tests isolate citation checking; editorial selection/review has its own suite.
vi.mock("./editorialSelection", () => ({
  selectEditorialClaims: async () => ({ omittedUnitIds: [], tokensIn: 0, tokensOut: 0 }),
  checkEditorialDraft: vi.fn(async () => ({ verdicts: [], tokensIn: 0, tokensOut: 0 })),
}));

// The model is a queue of answers per call name (section_lines, line_fact_check); every request is kept
function fakeModel(answers: Record<string, unknown[]>) {
  const requests: { name: string; body: { messages: { role: string; content: string }[] } }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const name = body.response_format.json_schema.name as string;
    requests.push({ name, body });
    const answer = answers[name]?.shift();
    if (!answer) throw new Error(`No answer queued for ${name}`);
    if (body.stream) return new Response(`data: ${JSON.stringify({ model: "test", choices: [{ delta: { content: JSON.stringify(answer) }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(checkEditorialDraft).mockReset().mockResolvedValue({ verdicts: [], tokensIn: 0, tokensOut: 0 });
  });

  it("preserves supported coverage when only editorial overlap remains after repairs", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 4; i++) vi.mocked(checkEditorialDraft).mockResolvedValueOnce({ verdicts: [{ line: "A1", supported: false, problem: "Editorial: An orienting phrase overlaps the introduction." }], tokensIn: 0, tokensOut: 0 });
    fakeModel({ section_lines: Array.from({ length: 4 }, () => writerAnswer(GOOD, FIXED)), line_fact_check: Array.from({ length: 4 }, () => verdicts(["A1", true], ["A2", true])) });
    const result = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection({ ...INPUT, pageContext: [{ section: "Overview", text: "Hearing protection is required." }] });
    expect(result.add).toHaveLength(2);
    expect(warning).toHaveBeenCalledWith("Section kept supported detail for page editorial review", expect.objectContaining({ section: INPUT.sectionTitle }));
    warning.mockRestore();
  });

  it("skips the draft editorial check on automatic stale rewrites", async () => {
    const requests = fakeModel({ section_lines: [writerAnswer(GOOD, FIXED)], line_fact_check: [verdicts(["A1", true], ["A2", true])] });
    const result = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection({ ...INPUT, skipEditorialReview: true, pageContext: [{ section: "Overview", text: "Hearing protection is required." }] });
    expect(result.add).toHaveLength(2);
    expect(checkEditorialDraft).not.toHaveBeenCalled();
    expect(requests.map(request => request.name)).toEqual(["section_lines", "line_fact_check"]);
  });

  it("runs on the Reviewer's model", () => {
    expect(roleForPurpose("line_fact_check")).toBe("reviewer");
    expect(roleForPurpose("line_fact_confirm")).toBe("reviewer");
  });
  it("repairs a factual regression introduced by an editorial pass even after overlap is resolved", async () => {
    const overlap = { verdicts: [{ line: "A1", supported: false, problem: "Editorial: Merge repeated wording." }], tokensIn: 0, tokensOut: 0 };
    vi.mocked(checkEditorialDraft).mockResolvedValueOnce(overlap).mockResolvedValueOnce(overlap)
      .mockResolvedValueOnce({ verdicts: [], tokensIn: 0, tokensOut: 0 }).mockResolvedValueOnce({ verdicts: [], tokensIn: 0, tokensOut: 0 });
    const requests = fakeModel({
      section_lines: [writerAnswer(GOOD, FIXED), writerAnswer(GOOD, FIXED), writerAnswer(GOOD, INVENTED), writerAnswer(GOOD, FIXED)],
      line_fact_check: [verdicts(["A1", true], ["A2", true]), verdicts(["A1", true], ["A2", true]), verdicts(["A1", true], ["A2", false, "The program is planned, not operating."]), verdicts(["A1", true], ["A2", true])],
      line_fact_confirm: [UPHELD],
    });
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection({ ...INPUT, pageContext: [{ section: "Overview", text: "ExampleCo has hearing protection requirements." }] });
    expect(revision.add.map(line => line.text)).toEqual([GOOD.text, FIXED.text]);
    const lastDraft = requests.filter(request => request.name === "section_lines").at(-1)!;
    expect(JSON.parse(lastDraft.body.messages.at(-1)!.content).factualIssues).toEqual([expect.objectContaining({ line: "A2", problem: "The program is planned, not operating." })]);
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

  it("rejects an incomplete draft when dropping a failed line would lose required evidence", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeModel({
      section_lines: [writerAnswer(GOOD, INVENTED), writerAnswer(GOOD, INVENTED)],
      line_fact_check: [verdicts(["A1", true], ["A2", false, "invented tests"]), verdicts(["A1", true], ["A2", false, "invented tests"])],
      line_fact_confirm: [UPHELD, UPHELD],
    });
    await expect(new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT)).rejects.toThrow("no incomplete draft was saved");
    expect(warn).toHaveBeenCalledWith("Writer line dropped by the fact-check", expect.objectContaining({ line: "A2", problem: "invented tests" }));
    warn.mockRestore();
  });

  it("rejects the complete patch batch when a revised line fails evidence checks", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const input: SectionReviseInput = { ...INPUT, uncoveredUnitIds: [], lines: [
      { lineId: "l1", lineRevisionId: "lr1", position: 0, content: "Old noise text.", author: "ai", unitIds: ["noise"], needsRewrite: true },
      { lineId: "l2", lineRevisionId: "lr2", position: 1, content: "Old plan text.", author: "ai", unitIds: ["plan"], needsRewrite: true },
    ] };
    const answer = { revise: [{ line: "L1", patches: [{ old_str: "Old noise text.", new_str: GOOD.text }], claims: GOOD.claims }, { line: "L2", patches: [{ old_str: "Old plan text.", new_str: INVENTED.text }], claims: INVENTED.claims }], retire: [], add: [] };
    fakeModel({ section_lines: [answer, answer], line_fact_check: [verdicts(["L1", true], ["L2", false, "x"]), verdicts(["L1", true], ["L2", false, "x"])], line_fact_confirm: [UPHELD, UPHELD] });
    await expect(new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(input)).rejects.toThrow("no patches were saved");
    vi.restoreAllMocks();
  });

  it("repairs an invalid exact match against the original and keeps untouched punctuation", async () => {
    const original = "  ExampleCo plans to introduce a Hearing Conservation Program.  ";
    const input: SectionReviseInput = { ...INPUT, units: [INPUT.units[1]!], uncoveredUnitIds: [], lines: [
      { lineId: "l1", lineRevisionId: "lr1", position: 0, content: original, author: "ai", unitIds: ["plan"], needsRewrite: true },
    ] };
    const answer = (old_str: string) => ({ revise: [{ line: "L1", patches: [{ old_str, new_str: "intends" }], claims: ["C1"] }], retire: [], add: [] });
    const requests = fakeModel({ section_lines: [answer("Plans"), answer("plans")], line_fact_check: [verdicts(["L1", true])] });
    const progress = { step: vi.fn(), thinking: vi.fn(), draft: vi.fn(), done: vi.fn() };
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(input, progress);
    expect(revision).toMatchObject({ textPatches: true, revise: [{ lineId: "l1", text: original.replace("plans", "intends"), unitIds: ["plan"] }] });
    expect(requests[1]!.body.messages.at(-1)!.content).toContain("No patches were applied");
    expect(progress.draft).not.toHaveBeenCalled();
  });

  it("matches a verdict that echoes the line's text instead of its ref", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeModel({
      section_lines: [writerAnswer(GOOD, INVENTED), writerAnswer(GOOD, INVENTED)],
      line_fact_check: [verdicts([GOOD.text, true], [` ${INVENTED.text.toUpperCase()} `, false, "x"]), verdicts(["A1", true], [INVENTED.text, false, "x"])],
      line_fact_confirm: [UPHELD, UPHELD],
    });
    await expect(new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT)).rejects.toThrow("no incomplete draft was saved");
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

  it("checks a missing verdict explicitly before returning the draft", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const requests = fakeModel({ section_lines: [writerAnswer(GOOD, FIXED)], line_fact_check: [verdicts(["A1", true]), verdicts(["A2", true])] });
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT);
    expect(revision.add).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith("Fact-check omitted verdicts; requesting focused checks", expect.objectContaining({ missing: ["A2"] }));
    expect(requests.map(request => request.name)).toEqual(["section_lines", "line_fact_check", "line_fact_check"]);
    expect(JSON.parse(requests[2]!.body.messages.at(-1)!.content).lines.map((line: { ref: string }) => line.ref)).toEqual(["A2"]);
    expect(revision).toMatchObject({ tokensIn: 30, tokensOut: 15 });
    warn.mockRestore();
  });
  it("does not return a draft when the focused verdict remains absent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const requests = fakeModel({ section_lines: [writerAnswer(GOOD, FIXED)], line_fact_check: [verdicts(["A1", true]), verdicts(), verdicts()] });
    await expect(new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT)).rejects.toBeInstanceOf(InvalidStructuredAnswerError);
    expect(requests.map(request => request.name)).toEqual(["section_lines", "line_fact_check", "line_fact_check", "line_fact_check"]);
    vi.restoreAllMocks();
  });
});
