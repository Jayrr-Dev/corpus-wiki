import { beforeEach, expect, it, vi } from "vitest";
import { chatJson, InvalidStructuredAnswerError } from "@/lib/ai/chat";
import { checkEditorialDraft, selectEditorialClaims } from "./editorialSelection";
import type { SectionReviseInput } from "../types";

vi.mock("@/lib/ai/chat", async original => ({ ...(await original<typeof import("@/lib/ai/chat")>()), chatJson: vi.fn() }));
const input: SectionReviseInput = { pageTitle: "Company", sectionTitle: "Company profile", lines: [], uncoveredUnitIds: ["fact"], units: [{ unitId: "fact", revisionId: "r", kind: "fact", epistemicStatus: "supported", content: "Company is based in Edmonton." }], pageContext: [{ section: "Overview", text: "Company is based in Edmonton." }] };
beforeEach(() => vi.resetAllMocks());
const answer = (reason: "already_covered" | "source_metadata", contextSection: string | null = "Overview", ref = "C1") => vi.mocked(chatJson).mockResolvedValue({ value: { omit: [{ ref, reason, contextSection, explanation: "This exact fact is already stated." }] }, model: "test", tokensIn: 1, tokensOut: 1 });

it("allows a reviewed duplicate to stay in the introduction without being restated", async () => {
  answer("already_covered");
  expect(await selectEditorialClaims({ apiKey: "test" }, input)).toMatchObject({ omittedUnitIds: ["fact"] });
});
it("does not remove introduction facts just because the body repeats them", async () => {
  answer("already_covered");
  expect(await selectEditorialClaims({ apiKey: "test" }, { ...input, sectionTitle: "Overview" })).toMatchObject({ omittedUnitIds: [] });
});
it("retains evidence when omission proposals invent a claim or supporting section", async () => {
  answer("source_metadata", null, "C99");
  expect(await selectEditorialClaims({ apiKey: "test" }, input)).toMatchObject({ omittedUnitIds: [] });
  answer("already_covered", "Imaginary section");
  expect(await selectEditorialClaims({ apiKey: "test" }, input)).toMatchObject({ omittedUnitIds: [] });
});
it("corrects an invented supporting section once without dropping unverified evidence", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { omit: [{ ref: "C1", reason: "already_covered", contextSection: "Imaginary section", explanation: "Already covered" }] }, model: "test", tokensIn: 3, tokensOut: 2 })
    .mockResolvedValueOnce({ value: { omit: [] }, model: "test", tokensIn: 5, tokensOut: 4 });
  expect(await selectEditorialClaims({ apiKey: "test" }, input)).toEqual({ omittedUnitIds: [], tokensIn: 8, tokensOut: 6 });
  expect(chatJson).toHaveBeenCalledTimes(2);
  const correction = JSON.parse(String(vi.mocked(chatJson).mock.calls[1]![1].messages.at(-1)!.content));
  expect(correction).toMatchObject({ supportingSections: ["Overview"], allowedClaimRefs: ["C1"], error: "Editorial omission has no supporting section." });
});
it("keeps all claims after two unsupported omission proposals instead of failing the section", async () => {
  answer("already_covered", "Imaginary section");
  expect(await selectEditorialClaims({ apiKey: "test" }, input)).toMatchObject({ omittedUnitIds: [], tokensIn: 2, tokensOut: 2 });
  expect(chatJson).toHaveBeenCalledTimes(2);
});
it("does not apply a partly valid omission list when another item is unsupported", async () => {
  vi.mocked(chatJson).mockResolvedValue({ value: { omit: [
    { ref: "C1", reason: "already_covered", contextSection: "Overview", explanation: "Same fact" },
    { ref: "C2", reason: "already_covered", contextSection: "Imaginary", explanation: "Unsupported" },
  ] }, model: "test", tokensIn: 1, tokensOut: 1 });
  const result = await selectEditorialClaims({ apiKey: "test" }, { ...input, units: [...input.units, { ...input.units[0]!, unitId: "new-detail", revisionId: "r2" }] });
  expect(result.omittedUnitIds).toEqual([]);
});
it("does not offer already-covered omissions when there is no supporting context", async () => {
  vi.mocked(chatJson).mockResolvedValue({ value: { omit: [] }, model: "test", tokensIn: 1, tokensOut: 1 });
  await selectEditorialClaims({ apiKey: "test" }, { ...input, sectionTitle: "Overview" });
  const schema = vi.mocked(chatJson).mock.calls[0]![1].schema;
  expect(schema.safeParse({ omit: [{ ref: "C1", reason: "already_covered", contextSection: null, explanation: "Already covered" }] }).success).toBe(false);
});
it("retains all claims and usage when the omission answer fails its schema", async () => {
  vi.mocked(chatJson).mockRejectedValueOnce(new InvalidStructuredAnswerError("Unknown supporting section", 12, 3));
  expect(await selectEditorialClaims({ apiKey: "test" }, input)).toEqual({ omittedUnitIds: [], tokensIn: 12, tokensOut: 3 });
});
it("still propagates provider or cancellation errors", async () => {
  vi.mocked(chatJson).mockRejectedValueOnce(new Error("Processing was cancelled."));
  await expect(selectEditorialClaims({ apiKey: "test" }, input)).rejects.toThrow("Processing was cancelled.");
});
it("does not select omissions when there are protected lines", async () => {
  expect(await selectEditorialClaims({ apiKey: "test" }, { ...input, lines: [{ lineId: "person", lineRevisionId: "r", author: "person", content: "Keep this", position: 0, needsRewrite: false, unitIds: ["fact"] }] })).toMatchObject({ omittedUnitIds: [] });
  expect(chatJson).not.toHaveBeenCalled();
});
it("constrains omissions to supplied refs and actual nonempty other sections", async () => {
  answer("source_metadata", null);
  await selectEditorialClaims({ apiKey: "test" }, { ...input, pageContext: [...input.pageContext!, { section: input.sectionTitle, text: "The section being rewritten." }, { section: "Empty", text: " " }] });
  const schema = vi.mocked(chatJson).mock.calls[0]![1].schema;
  const valid = { ref: "C1", reason: "already_covered", contextSection: "Overview", explanation: "Same whole claim" };
  expect(schema.safeParse({ omit: [valid] }).success).toBe(true);
  for (const changed of [{ ref: "C99" }, { contextSection: "Invented" }, { contextSection: "Empty" }, { contextSection: input.sectionTitle }]) {
    expect(schema.safeParse({ omit: [{ ...valid, ...changed }] }).success).toBe(false);
  }
});
it("can recognize an uncovered duplicate without changing a protected paragraph", async () => {
  answer("already_covered", "Overview", "C2");
  const units = [{ ...input.units[0]!, unitId: "protected" }, input.units[0]!];
  const result = await selectEditorialClaims({ apiKey: "test" }, { ...input, units,
    lines: [{ lineId: "person", lineRevisionId: "r", author: "person", content: "Keep this", position: 0, needsRewrite: false, unitIds: ["protected"] }] });
  expect(result.omittedUnitIds).toEqual(["fact"]);
  const request = vi.mocked(chatJson).mock.calls[0]![1];
  expect(JSON.parse(String(request.messages[1]!.content)).claims.map((claim: { ref: string }) => claim.ref)).toEqual(["C2"]);
});

it("returns a repair verdict for repeated identity even when the facts are supported", async () => {
  vi.mocked(chatJson).mockResolvedValue({ value: { issues: [{ line: "L1", quote: "engineering consultancy", problem: "'engineering consultancy' repeats the introduction's business identity." }] }, model: "test", tokensIn: 1, tokensOut: 1 });
  expect(await checkEditorialDraft({ apiKey: "test" }, input, [{ ref: "L1", text: "Company is an engineering consultancy." }])).toMatchObject({ verdicts: [{ line: "L1", supported: false, problem: expect.stringContaining("Editorial:") }] });
});
it("rechecks a hallucinated phrase instead of requiring the writer to remove absent words", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { issues: [{ line: "L1", quote: "engineering consultancy", problem: "Repeated identity" }] }, model: "test", tokensIn: 1, tokensOut: 1 })
    .mockResolvedValueOnce({ value: { issues: [] }, model: "test", tokensIn: 1, tokensOut: 1 });
  expect(await checkEditorialDraft({ apiKey: "test" }, input, [{ ref: "L1", text: "Privately held, the firm serves utility projects." }])).toMatchObject({ verdicts: [], tokensIn: 2 });
});
it("identifies the invalid quotation and current line so correction can retain a real issue", async () => {
  const text = "The company provides engineering services. The company serves utilities.";
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { issues: [{ line: "L1", quote: "The firm provides", problem: "Repeated sentence opening" }] }, model: "test", tokensIn: 2, tokensOut: 1 })
    .mockResolvedValueOnce({ value: { issues: [{ line: "L1", quote: "The company serves utilities.", problem: "Repeated sentence opening" }] }, model: "test", tokensIn: 3, tokensOut: 2 });
  expect(await checkEditorialDraft({ apiKey: "test" }, input, [{ ref: "L1", text }])).toMatchObject({ verdicts: [{ line: "L1", supported: false }], tokensIn: 5, tokensOut: 3 });
  const correction = JSON.parse(String(vi.mocked(chatJson).mock.calls[1]![1].messages.at(-1)!.content));
  expect(correction).toMatchObject({ invalidQuotes: [{ line: "L1", quote: "The firm provides", currentLine: text }], currentDraft: [{ ref: "L1", text }] });
});
it("discards unsupported quotes after one complete corrective review", async () => {
  vi.mocked(chatJson).mockResolvedValue({ value: { issues: [{ line: "L1", quote: "Absent phrase", problem: "Repeated" }] }, model: "test", tokensIn: 1, tokensOut: 1 });
  expect(await checkEditorialDraft({ apiKey: "test" }, input, [{ ref: "L1", text: "Current draft" }])).toMatchObject({ verdicts: [], tokensIn: 2, tokensOut: 2 });
  expect(chatJson).toHaveBeenCalledTimes(2);
});
it("discards editorial findings that do not identify a supplied paragraph", async () => {
  vi.mocked(chatJson).mockResolvedValue({ value: { issues: [{ line: "L99", problem: "Repeated" }] }, model: "test", tokensIn: 1, tokensOut: 1 });
  expect(await checkEditorialDraft({ apiKey: "test" }, input, [{ ref: "L1", text: "Company is privately held." }])).toMatchObject({ verdicts: [] });
});
it("preserves valid feedback when another finding still invents a quote", async () => {
  vi.mocked(chatJson).mockResolvedValue({ value: { issues: [
    { line: "L1", quote: "privately held", problem: "Valid editorial suggestion" },
    { line: "L1", quote: "absent phrase", problem: "Invented wording" },
  ] }, model: "test", tokensIn: 4, tokensOut: 2 });
  expect(await checkEditorialDraft({ apiKey: "test" }, input, [{ ref: "L1", text: "Company is privately held." }])).toMatchObject({
    tokensIn: 8, tokensOut: 4, verdicts: [{ line: "L1", supported: false, problem: "Editorial: Valid editorial suggestion" }],
  });
  expect(chatJson).toHaveBeenCalledTimes(2);
});
it("does not fail writing for malformed optional editorial feedback", async () => {
  vi.mocked(chatJson).mockRejectedValueOnce(new InvalidStructuredAnswerError("Missing quote", 10, 2));
  expect(await checkEditorialDraft({ apiKey: "test" }, input, [{ ref: "L1", text: "Company is privately held." }])).toMatchObject({ verdicts: [], tokensIn: 10, tokensOut: 2 });
});
