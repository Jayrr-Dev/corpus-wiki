import { expect, it, vi } from "vitest";
import { composerImageGenerator } from "./generate";
import type { ComposerArticle } from "./compose";

const article: ComposerArticle = { title: "Test", sourceUrl: "test", paragraphs: [{ id: "P1", text: "A planning team reviews a plan.", section: "Planning" }], existingFigures: [], selectedSections: ["Planning"], newFigureBudget: 1 };
it("exposes separate raster and vector tools sharing a single spending budget", async () => {
  const raster = vi.fn().mockRejectedValue(new Error("Raster failed"));
  const vector = vi.fn();
  const generator = composerImageGenerator("page", raster, vector);
  expect(generator.tool(article, true).name).toBe("generate_vector_image");
  const args = { after: "P1", prompt: "Scene", description: "Scene" };
  await expect(generator.tool(article).run(args)).rejects.toThrow("Raster failed");
  await expect(generator.tool(article, true).run(args)).rejects.toThrow("already attempted");
  expect(vector).not.toHaveBeenCalled();
});
it("restricts the image tool to the selected section before spending", async () => {
  const generate = vi.fn();
  const tool = composerImageGenerator("page", generate).tool(article);
  await expect(tool.run({ after: "unknown", prompt: "Scene", description: "Scene" })).rejects.toThrow("selected section");
  expect(generate).not.toHaveBeenCalled();
});
it("never repeats a failed paid generation automatically", async () => {
  const generate = vi.fn().mockRejectedValue(new Error("Provider failed"));
  const tool = composerImageGenerator("page", generate).tool(article);
  const args = { after: "P1", prompt: "Scene", description: "Scene" };
  await expect(tool.run(args)).rejects.toThrow("Provider failed");
  await expect(tool.run(args)).rejects.toThrow("already attempted");
  expect(generate).toHaveBeenCalledTimes(1);
});
