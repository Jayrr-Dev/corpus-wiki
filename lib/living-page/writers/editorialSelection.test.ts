import { beforeEach, expect, it, vi } from "vitest";
import { chatJson } from "@/lib/ai/chat";
import { checkEditorialDraft, selectEditorialClaims } from "./editorialSelection";
import type { SectionReviseInput } from "../types";

vi.mock("@/lib/ai/chat", () => ({ chatJson: vi.fn() }));
const input: SectionReviseInput = { pageTitle: "Company", sectionTitle: "Company profile", lines: [], uncoveredUnitIds: ["fact"], units: [{ unitId: "fact", revisionId: "r", kind: "fact", epistemicStatus: "supported", content: "Company is based in Edmonton." }], pageContext: [{ section: "Overview", text: "Company is based in Edmonton." }] };
beforeEach(() => vi.resetAllMocks());
const answer = (reason: "already_covered" | "source_metadata", contextSection: string | null = "Overview", ref = "C1") => vi.mocked(chatJson).mockResolvedValue({ value: { omit: [{ ref, reason, contextSection, explanation: "This exact fact is already stated." }] }, model: "test", tokensIn: 1, tokensOut: 1 });

it("allows a reviewed duplicate to stay in the introduction without being restated", async () => {
  answer("already_covered");
  expect(await selectEditorialClaims({ apiKey: "test" }, input)).toMatchObject({ omittedUnitIds: ["fact"] });
});
it("does not remove introduction facts just because the body repeats them", async () => {
  answer("already_covered");
  await expect(selectEditorialClaims({ apiKey: "test" }, { ...input, sectionTitle: "Overview" })).rejects.toThrow("no supporting section");
});
it("rejects an invented claim or a nonexistent supporting section", async () => {
  answer("source_metadata", null, "C99");
  await expect(selectEditorialClaims({ apiKey: "test" }, input)).rejects.toThrow("Invalid editorial omission");
  answer("already_covered", "Imaginary section");
  await expect(selectEditorialClaims({ apiKey: "test" }, input)).rejects.toThrow("no supporting section");
});
it("does not select omissions when there are protected lines", async () => {
  expect(await selectEditorialClaims({ apiKey: "test" }, { ...input, lines: [{ lineId: "person", lineRevisionId: "r", author: "person", content: "Keep this", position: 0, needsRewrite: false, unitIds: ["fact"] }] })).toMatchObject({ omittedUnitIds: [] });
  expect(chatJson).not.toHaveBeenCalled();
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
it("rejects editorial findings that do not identify a supplied paragraph", async () => {
  vi.mocked(chatJson).mockResolvedValue({ value: { issues: [{ line: "L99", problem: "Repeated" }] }, model: "test", tokensIn: 1, tokensOut: 1 });
  await expect(checkEditorialDraft({ apiKey: "test" }, input, [{ ref: "L1", text: "Company is privately held." }])).rejects.toThrow("Invalid editorial review");
});
