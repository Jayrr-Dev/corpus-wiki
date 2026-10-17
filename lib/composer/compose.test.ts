import { it, expect, vi } from "vitest";
import { composeArticle, type ComposerArticle } from "./compose";
import { chatJson } from "@/lib/ai/chat";
import { roleForPurpose, roleName } from "@/lib/ai/roles";
vi.mock("@/lib/ai/chat", () => ({ chatJson: vi.fn() }));
const article: ComposerArticle = { title: "Example", sourceUrl: "https://example.com", paragraphs: [{ id: "P1", text: "Evidence" }], existingFigures: [] };
const figure = { after: "P1", evidence: ["P1"], learningGoal: "Explain", caption: "Caption", alt: "Description", svg: "<svg/>" };
it("validates newly imported assets against the live library, not the prompt shortlist", async () => {
  const id = "10000000-0000-4000-8000-000000000009";
  const live = { ...article, availableAssets: [] as NonNullable<ComposerArticle["availableAssets"]> };
  vi.mocked(chatJson).mockImplementationOnce(async () => {
    live.availableAssets.push({ id, title: "Imported", description: "Full metadata", type: "photo", tags: [], origin: "external", attribution: "Creator", license: "Public domain" });
    return { value: { figures: [{ ...figure, svg: "", assetId: id }], omitted: "" }, tokensIn: 1, tokensOut: 1, model: "test" } as never;
  });
  expect((await composeArticle({ apiKey: "test" }, live)).value.figures[0]!.assetId).toBe(id);
});
it("requires a different image when manually replacing an illustration", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { figures: [figure], omitted: "" }, tokensIn: 1, tokensOut: 1, model: "test" });
  await expect(composeArticle({ apiKey: "test" }, { ...article, manualPlacementIds: ["P1"], replacingFigures: [{ svg: figure.svg }] })).rejects.toThrow("new image");
});
it("reuses a real library image without fabricating SVG", async () => {
  const id = "10000000-0000-4000-8000-000000000001";
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { figures: [{ ...figure, svg: "", assetId: id }], omitted: "" }, tokensIn: 1, tokensOut: 1, model: "test" });
  const result = await composeArticle({ apiKey: "test" }, { ...article, availableAssets: [{ id, title: "Official logo", type: "logo", description: "Identity", tags: [], origin: "external", attribution: "Official site", license: "Trademark" }] });
  expect(result.value.figures[0]?.assetId).toBe(id);
});
it("rejects invented asset ids", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { figures: [{ ...figure, svg: "", assetId: "10000000-0000-4000-8000-000000000001" }], omitted: "" }, tokensIn: 1, tokensOut: 1, model: "test" });
  await expect(composeArticle({ apiKey: "test" }, article)).rejects.toThrow("unavailable asset");
});
it("attributes compositions to their role", () => { expect(roleForPurpose("article_composition")).toBe("composer"); expect(roleName("composer")).toBe("Composer"); });
it("rejects invented evidence and placements", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { figures: [{ ...figure, evidence: ["P999"] }], omitted: "" }, tokensIn: 1, tokensOut: 1, model: "test" });
  await expect(composeArticle({ apiKey: "test" }, article)).rejects.toThrow("unknown paragraph");
});
it("prevents crowding an existing illustration", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { figures: [figure], omitted: "" }, tokensIn: 1, tokensOut: 1, model: "test" });
  await expect(composeArticle({ apiKey: "test" }, { ...article, existingFigures: [{ after: "P1", learningGoal: "Explain" }] })).rejects.toThrow("crowded");
});
it("sends saved role instructions and preserves the original article", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { figures: [figure], omitted: "" }, tokensIn: 1, tokensOut: 1, model: "test" });
  const before = JSON.stringify(article);
  await composeArticle({ apiKey: "test", roleInstructions: [{ role: "composer", instructions: "Custom visual style", version: 2 }] }, article);
  expect(JSON.stringify(article)).toBe(before);
  expect(vi.mocked(chatJson).mock.calls.at(-1)?.[1].messages[0]?.content).toContain("Custom visual style");
});
it("rejects two images in one section even at different paragraph placements", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { figures: [figure, { ...figure, after: "P2" }], omitted: "" }, tokensIn: 1, tokensOut: 1, model: "test" });
  await expect(composeArticle({ apiKey: "test" }, { ...article, paragraphs: [...article.paragraphs, { id: "P2", text: "More" }] })).rejects.toThrow("more than one image");
});
it("rejects a figure in a section that failed candidate selection", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { figures: [figure], omitted: "" }, tokensIn: 1, tokensOut: 1, model: "test" });
  await expect(composeArticle({ apiKey: "test" }, { ...article, selectedSections: [] })).rejects.toThrow("did not qualify");
});
it("locks a manual request to its section's paragraph ids", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { figures: [figure], omitted: "" }, tokensIn: 1, tokensOut: 1, model: "test" });
  await expect(composeArticle({ apiKey: "test" }, { ...article, paragraphs: [...article.paragraphs, { id: "P2", text: "Other" }], manualPlacementIds: ["P2"] })).rejects.toThrow("left the requested section");
});
