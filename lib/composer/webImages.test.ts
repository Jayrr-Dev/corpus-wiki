import { afterEach, expect, it, vi } from "vitest";
import { commonsImage, downloadCommonsImage } from "./webImages";
import { composerWebImages } from "./importImages";
import type { ComposerArticle, ComposerAsset } from "./compose";

const page = { pageid: 42, title: "File:Tree.jpg", imageinfo: [{ url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Tree.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Tree.jpg", mime: "image/jpeg", extmetadata: {
  Artist: { value: '<a href="https://example.com">Jane</a>' }, LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" }, ImageDescription: { value: "<p>A tree.</p>" }
} }] };
afterEach(() => vi.unstubAllGlobals());
it("reuses search results across runs and refreshes after their expiry", async () => {
  let now = 0;
  const entries = new Map<string, { value: unknown; expires: number }>();
  const cache = { get: async (key: string) => { const e = entries.get(key); return e && e.expires > now ? e.value : null; }, set: async (key: string, value: unknown, ttl: number) => { entries.set(key, { value, expires: now + ttl }); } };
  const search = vi.fn().mockResolvedValue([commonsImage(page)!]);
  const assess = vi.fn().mockResolvedValue([]);
  const article: ComposerArticle = { title: "Trees", sourceUrl: "", paragraphs: [], existingFigures: [] };
  const run = async (query = "Tree") => { const [tool] = composerWebImages(async () => {}, search, undefined, assess, cache).tools(article); return tool!.run({ query }); };
  await run(); await run();
  expect(search).toHaveBeenCalledTimes(1);
  now = 86401; await run();
  expect(search).toHaveBeenCalledTimes(2);
  await run("Oak"); expect(search).toHaveBeenCalledTimes(3);
});
it("extracts verified source metadata and rejects unknown rights or active media", () => {
  expect(commonsImage(page)).toMatchObject({ creator: "Jane", description: "A tree.", license: "CC BY-SA 4.0" });
  expect(commonsImage({ ...page, imageinfo: [{ ...page.imageinfo[0]!, mime: "image/svg+xml" }] })).toBeNull();
  expect(commonsImage({ ...page, imageinfo: [{ ...page.imageinfo[0]!, extmetadata: {} }] })).toBeNull();
  expect(commonsImage({ ...page, imageinfo: [{ ...page.imageinfo[0]!, url: "https://localhost/tree.jpg" }] })).toBeNull();
});
it("uses verified standard-size thumbnails from Wikimedia's thumbnail host", async () => {
  const thumburl = "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Tree.jpg/500px-Tree.jpg";
  const image = commonsImage({ ...page, imageinfo: [{ ...page.imageinfo[0]!, thumburl }] })!;
  expect(image.displayUrl).toBe(thumburl);
  const request = vi.fn().mockResolvedValue(new Response(new Uint8Array([255,216,255,0]), { headers: { "content-type": "image/jpeg" } }));
  vi.stubGlobal("fetch", request);
  await downloadCommonsImage(image);
  expect(request.mock.calls[0]![0]).toBe(thumburl);
  expect(commonsImage({ ...page, imageinfo: [{ ...page.imageinfo[0]!, thumburl: "https://evil.example/image.jpg" }] })?.displayUrl).toBeUndefined();
});
it("cannot upload a rejected candidate even if the model asks for it", async () => {
  const save = vi.fn();
  const article: ComposerArticle = { title: "Trees", sourceUrl: "", paragraphs: [{ id: "P1", text: "Tree" }], existingFigures: [] };
  const web = composerWebImages(async () => {}, async () => [commonsImage(page)!], save, async () => [{ id: "42", accepted: false, total: 5, subjectMatch: 1, learningValue: 1, composition: 1, thumbnailClarity: 1, contextualFit: 1, reason: "Wrong subject", problems: ["Wrong subject"] }]);
  const [find, upload] = web.tools(article);
  await find!.run({ query: "Tree" });
  await expect(upload!.run({ candidateId: "42", after: "P1" })).rejects.toThrow("did not pass visual");
  expect(save).not.toHaveBeenCalled();
});
it("validates downloaded bytes and disallows redirected downloads", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("<html>Not an image</html>", { headers: { "content-type": "image/jpeg" } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(downloadCommonsImage(commonsImage(page)!)).rejects.toThrow("supported raster");
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  fetcher.mockResolvedValue(new Response(new Uint8Array([255,216,255,0]), { headers: { "content-type": "image/jpeg" } }));
  expect((await downloadCommonsImage(commonsImage(page)!)).extension).toBe("jpg");
});
it("requires a search selection, restricts placement, and deduplicates concurrent imports", async () => {
  const asset: ComposerAsset = { id: "10000000-0000-4000-8000-000000000001", title: "Tree", description: "Tree", type: "other", origin: "external", tags: [], attribution: "Jane", license: "CC BY-SA 4.0" };
  const save = vi.fn().mockResolvedValue(asset), search = vi.fn().mockResolvedValue([commonsImage(page)!]);
  const article: ComposerArticle = { title: "Trees", sourceUrl: "/p/trees", paragraphs: [{ id: "P1", text: "Tree", section: "Trees" }], selectedSections: ["Trees"], existingFigures: [], newFigureBudget: 1 };
  const web = composerWebImages(async () => {}, search, save, async () => [{ id: "42", accepted: true, total: 20, subjectMatch: 4, learningValue: 4, composition: 4, thumbnailClarity: 4, contextualFit: 4, reason: "Clear subject", problems: [] }]);
  const [find, upload] = web.tools(article);
  await expect(upload!.run({ candidateId: "42", after: "P1" })).rejects.toThrow("verified candidate");
  await find!.run({ query: "Tree" });
  await expect(upload!.run({ candidateId: "42", after: "unknown" })).rejects.toThrow("selected section");
  const results = await Promise.all([upload!.run({ candidateId: "42", after: "P1" }), upload!.run({ candidateId: "42", after: "P1" })]);
  expect(results[0]).toMatchObject({ assetId: asset.id });
  expect(save).toHaveBeenCalledTimes(1);
  expect(article.availableAssets).toEqual([asset]);
  expect(web.created).toEqual([asset.id]);
});
it("caps searches and preserves cancellation before requests", async () => {
  const search = vi.fn().mockResolvedValue([]);
  const article: ComposerArticle = { title: "Test", sourceUrl: "", paragraphs: [], existingFigures: [] };
  const [find] = composerWebImages(async () => {}, search).tools(article);
  for (const query of ["one", "two", "three", "four", "five"]) await find!.run({ query });
  await expect(find!.run({ query: "six" })).rejects.toThrow("limit");
  expect(search).toHaveBeenCalledTimes(5);
  const [cancelled] = composerWebImages(async () => { throw new Error("Cancelled"); }, search).tools(article);
  await expect(cancelled!.run({ query: "tree" })).rejects.toThrow("Cancelled");
  expect(search).toHaveBeenCalledTimes(5);
});
