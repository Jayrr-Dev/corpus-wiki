import { expect, it } from "vitest";
import { exploreOffset, publicationInput, publicationSlug } from "./validation";
import { isPublicPath, isPublicWikiPath } from "@/lib/supabase/proxy";

it("keeps only the dedicated reader and metrics paths public", () => {
  for (const path of ["/explore", "/explore/", "/s/abc/wiki/test", "/embed/abc", "/api/public-wiki/metrics"]) {
    expect(isPublicPath(path)).toBe(true); expect(isPublicWikiPath(path)).toBe(true);
  }
  for (const path of ["/publishing", "/settings", "/p/secret", "/sources", "/api/public-wiki/private", "/explorer", "/something", "/embedded"]) {
    expect(isPublicPath(path)).toBe(false); expect(isPublicWikiPath(path)).toBe(false);
  }
});

it("bounds search pagination and rejects guessable publication slugs", () => {
  expect(exploreOffset("20")).toBe(20); expect(exploreOffset("99999")).toBe(10000);
  for (const value of ["-4", "NaN", "20.5", "Infinity"]) expect(exploreOffset(value)).toBe(0);
  expect(publicationSlug.safeParse("a".repeat(32)).success).toBe(true);
  for (const slug of ["my-space", "../private", "a".repeat(500)]) expect(publicationSlug.safeParse(slug).success).toBe(false);
});

it("validates publication scope and allows immediate withdrawal without selected pages", () => {
  const page = { id: "10000000-0000-4000-8000-000000000001", fingerprint: "a".repeat(32) };
  const base = { visibility: "public", title: "Wiki", description: "", publisher: "", embedEnabled: false, pages: [page] };
  expect(publicationInput.safeParse(base).success).toBe(true);
  expect(publicationInput.safeParse({ ...base, pages: [] }).success).toBe(false);
  expect(publicationInput.safeParse({ ...base, pages: [page, page] }).success).toBe(false);
  expect(publicationInput.safeParse({ ...base, visibility: "private", pages: [] }).success).toBe(true);
  expect(publicationInput.safeParse({ ...base, description: "a".repeat(501) }).success).toBe(false);
});
