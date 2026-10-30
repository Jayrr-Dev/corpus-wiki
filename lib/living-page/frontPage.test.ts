import { describe, expect, it } from "vitest";
import { buildFrontArticles, dailyOrder, editionDay, excerptBlocks, frontSelections, plainExcerpt, type FrontArticle } from "./frontPage";
import type { Tables } from "@/lib/database/types";

const article = (id: string): FrontArticle => ({ id, title: id, slug: id, domain_id: null, parent_page_id: null, body: "", excerpt: "A meaningful article paragraph. ".repeat(15), changedAt: "2026-10-15T12:00:00Z", sectionCount: 1 });

describe("front page selection", () => {
  it("is stable regardless of query ordering and rotates on the next local day", () => {
    const items = [article("a"), article("b"), article("c")];
    expect(dailyOrder(items, "2026-10-15")).toEqual(dailyOrder([...items].reverse(), "2026-10-15"));
    expect(dailyOrder(items, "2026-10-16")[0]?.id).not.toBe(dailyOrder(items, "2026-10-15")[0]?.id);
    expect(editionDay(new Date("2026-10-16T02:00:00Z"), "America/Edmonton")).toBe("2026-10-15");
  });
  it("never repeats articles across panels, including sparse collections", () => {
    for (const count of [0, 1, 2, 8, 14]) {
      const selection = frontSelections(Array.from({ length: count }, (_, i) => article(String(i))), "2026-10-15");
      const ids = [selection.featured, ...selection.recent, ...selection.discover, ...selection.rediscover].filter((a) => !!a).map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it("does not feature empty articles or expose markdown syntax", () => {
    expect(frontSelections([{ ...article("empty"), excerpt: "" }], "2026-10-15").featured).toBeUndefined();
    expect(plainExcerpt("## Intro\n**Read** [this](https://example.com) ![secret](image.png)\n```chart bar\nA: 12\n```" )).toBe("Intro Read this");
  });
  it("flattens a table into words for short excerpts", () => {
    expect(plainExcerpt("Each region:\n| Region | URL |\n|---|---|\n| us-central1 | a.com |\n| eu-west1 | b.com |")).toBe("Each region: Region, URL; us-central1, a.com; eu-west1, b.com");
  });
  it("keeps tables and lists as blocks for the featured panel", () => {
    expect(excerptBlocks("Each **region**:\n| Region | model_id |\n|---|---|\n| us | `a_b` |\n\n* First\n* Second")).toEqual([
      { kind: "text", text: "Each region:" },
      { kind: "table", header: ["Region", "model_id"], rows: [["us", "a_b"]] },
      { kind: "bullets", items: ["First", "Second"] },
    ]);
  });
  it("stops the featured excerpt at the budget, at a whole table row", () => {
    const table = "| A | B |\n|---|---|\n| 1234 | 5678 |\n| 1234 | 5678 |\n| 1234 | 5678 |";
    expect(excerptBlocks(`${table}\n\nAfter the table`, 12)).toEqual([{ kind: "table", header: ["A", "B"], rows: [["1234", "5678"], ["1234", "5678"]] }]);
    expect(excerptBlocks("One two three four five six", 12)).toEqual([{ kind: "text", text: "One two…" }]);
  });
  it("excludes retired sections and uses manual line edits for recent activity", () => {
    const pages = [{ ...article("a"), retired_at: null, entity_id: null, created_at: "2026-01-01T00:00:00Z" }] as Tables<"pages">[];
    const sections = [{ id: "s", page_id: "a", position: 0, body: "Current text", built_at: null, retired_at: null }, { id: "gone", page_id: "a", position: 1, body: "Removed text", built_at: null, retired_at: "2026-02-01" }];
    const result = buildFrontArticles(pages, sections, [{ section_id: "s", last_changed_at: "2026-10-15T12:00:00Z" }]);
    expect(result[0]).toMatchObject({ excerpt: "Current text", changedAt: "2026-10-15T12:00:00Z", sectionCount: 1 });
  });
});
