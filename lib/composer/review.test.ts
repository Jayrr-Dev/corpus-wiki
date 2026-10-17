import { it, expect, vi } from "vitest";
import { reviewedComposition } from "./review";
import { chatJson } from "@/lib/ai/chat";
import { composeArticle } from "./compose";
import { selectCandidateSections } from "./candidates";
vi.mock("./candidates", async (importOriginal) => ({ ...await importOriginal<typeof import("./candidates")>(), selectCandidateSections: vi.fn().mockResolvedValue({ selected: ["Article"], assessments: [] }) }));
vi.mock("@/lib/ai/chat", () => ({ chatJson: vi.fn() }));
vi.mock("./compose", () => ({ composeArticle: vi.fn() }));
const article = { title: "Example", sourceUrl: "/p/example", paragraphs: [{ id: "P1", text: "Supported" }], existingFigures: [] };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><text x="40" y="80" font-size="32">Example</text></svg>';
const value = { figures: [{ svg, after: "P1", evidence: ["P1"], learningGoal: "Explain", caption: "Caption", alt: "Example" }], omitted: "" };
const good = { usefulness: 4, grounding: 4, restraint: 4, visualDesign: 3, accessibility: 3, problems: [], fixes: [] };
const result = (value: unknown) => ({ value, model: "test", tokensIn: 10, tokensOut: 20 });
it("repairs a rejected diagram and retains the rejection in the audit callback", async () => {
  vi.mocked(composeArticle).mockResolvedValue(result(value) as Awaited<ReturnType<typeof composeArticle>>);
  vi.mocked(chatJson).mockResolvedValueOnce(result({ ...good, grounding: 1, problems: ["Wrong endpoint"], fixes: ["Point at the actual shape"] })).mockResolvedValueOnce(result(good));
  const onAttempt = vi.fn();
  const final = await reviewedComposition({ apiKey: "test" }, article, { onAttempt });
  expect(onAttempt.mock.calls.map(([a]) => a.accepted)).toEqual([false, true]);
  expect(vi.mocked(composeArticle).mock.calls.at(-1)?.[2]).toContain("Wrong endpoint");
  expect(final.attempt?.accepted).toBe(true);
});
it("does not accept executable SVG even if a model gives it full marks", async () => {
  vi.mocked(composeArticle).mockResolvedValue(result({ ...value, figures: [{ ...value.figures[0], svg: svg.replace('</svg>', '<script>bad()</script></svg>') }] }) as Awaited<ReturnType<typeof composeArticle>>);
  vi.mocked(chatJson).mockResolvedValue(result(good));
  await expect(reviewedComposition({ apiKey: "test" }, article)).rejects.toThrow('did not pass review');
});
it("permits restraint when no figure adds value", async () => {
  vi.mocked(composeArticle).mockResolvedValue(result({ figures: [], omitted: 'Already illustrated well.' }) as Awaited<ReturnType<typeof composeArticle>>);
  const final = await reviewedComposition({ apiKey: "test" }, article);
  expect(final.attempt).toBeNull();
});
it("loops on a failed pixel review even when the text reviewer approves", async () => {
  vi.mocked(composeArticle).mockResolvedValue(result(value) as Awaited<ReturnType<typeof composeArticle>>);
  vi.mocked(chatJson).mockResolvedValue(result(good));
  const inspectComposition = vi.fn().mockResolvedValueOnce({ accepted: false, grades: [], uninspected: [], problems: ["The thumbnail hides the earthworks"] })
    .mockResolvedValueOnce({ accepted: true, grades: [], uninspected: [], problems: [] });
  const onAttempt = vi.fn();
  const final = await reviewedComposition({ apiKey: "test" }, article, { inspectComposition, onAttempt });
  expect(onAttempt.mock.calls.map(([a]) => a.accepted)).toEqual([false, true]);
  expect(vi.mocked(composeArticle).mock.calls.at(-1)?.[2]).toContain("thumbnail hides the earthworks");
  expect(final.attempt?.visual?.accepted).toBe(true);
});
it("lets inspected pixels own taste while retaining the factual veto", async () => {
  vi.mocked(composeArticle).mockResolvedValue(result(value) as Awaited<ReturnType<typeof composeArticle>>);
  vi.mocked(chatJson).mockResolvedValue(result({ ...good, usefulness: 3, grounding: 3 }));
  const inspectComposition = vi.fn().mockResolvedValue({ accepted: true, grades: [{ id: "P1", after: "P1", total: 18, accepted: true }], uninspected: [], problems: [] });
  expect((await reviewedComposition({ apiKey: "test" }, article, { inspectComposition })).attempt?.accepted).toBe(true);
  vi.mocked(chatJson).mockResolvedValue(result({ ...good, problems: ["Caption contradicts the source"] }));
  await expect(reviewedComposition({ apiKey: "test" }, article, { inspectComposition })).rejects.toThrow("did not pass review");
});
it("honors an explicit manual section without automatic candidate ranking", async () => {
  vi.mocked(selectCandidateSections).mockClear();
  vi.mocked(composeArticle).mockResolvedValue(result(value) as Awaited<ReturnType<typeof composeArticle>>);
  vi.mocked(chatJson).mockResolvedValue(result(good));
  const final = await reviewedComposition({ apiKey: "test" }, { ...article, manualPlacementIds: ["P1"] });
  expect(selectCandidateSections).not.toHaveBeenCalled();
  expect(final.selection.selected).toEqual(["Article"]);
  expect(final.attempt?.accepted).toBe(true);
});

