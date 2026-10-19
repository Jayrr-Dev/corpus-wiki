import { expect, it } from "vitest";
import { illustrationSections } from "./illustrationSections";
import type { ShownIllustration } from "@/lib/composer/types";

const image = (id: string, sectionId: string, sectionTitle: string, sectionPosition: number) => ({ id, sectionId, sectionTitle, sectionPosition, src: `/original/${id}` }) as ShownIllustration;

it("omits orphaned images without recreating retired sections", () => {
  const water = { id: "new-water", title: "Water and gas", position: 10 };
  const figures = [image("tree-image", "old-tree", "Tree roots", 8), image("water-image", water.id, water.title, 3), image("hydrant-image", "old-drainage", "Drainage and hydrants", 5)];
  const outline = illustrationSections([water], figures);
  expect(outline.map((entry) => entry.title)).toEqual(["Water and gas"]);
  expect(outline.map((entry) => entry.figures.map((figure) => figure.id))).toEqual([["water-image"]]);
  expect(outline[0]!.section).toBe(water);
  expect(outline).toHaveLength(1);
});

it("does not move orphaned images into the introduction or duplicate a section", () => {
  const introduction = { id: "intro", title: "Overview", position: 0 };
  const figures = [image("first", "old-section", "Original heading", 2), image("second", "old-section", "Original heading", 2)];
  const outline = illustrationSections([introduction], figures);
  expect(outline).toHaveLength(1);
  expect(outline[0]!.figures).toEqual([]);

});
