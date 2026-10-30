import { expect, test } from "vitest";
import { splitFeatured } from "./explore";
import type { ExploreResult } from "./types";

function space(slug: string, pages: number, day: number, picture = false): ExploreResult["spaces"][number] {
  return { slug, title: slug, description: "", publisher: "", published_at: `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`, page_count: pages, thumbnail_version: picture ? "abc" : null, matching_pages: [] };
}

test("a short list has no Featured row", () => {
  const spaces = [space("a", 9, 1), space("b", 2, 2), space("c", 1, 3)];
  expect(splitFeatured(spaces)).toEqual({ featured: [], recent: spaces });
});

test("Spaces with a picture lead, then the most articles, then the newest", () => {
  const spaces = [space("newest", 5, 9), space("big", 40, 8), space("older", 5, 7), space("pictured", 1, 6, true)];
  expect(splitFeatured(spaces).featured.map(s => s.slug)).toEqual(["pictured", "big", "newest"]);
});

test("New keeps its date order and never repeats a Featured Space", () => {
  const spaces = [space("a", 1, 9), space("b", 20, 8), space("c", 2, 7), space("d", 30, 6), space("e", 25, 5)];
  const { featured, recent } = splitFeatured(spaces);
  expect(recent.map(s => s.slug)).toEqual(["a", "c"]);
  expect(featured.filter(s => recent.includes(s))).toEqual([]);
});
