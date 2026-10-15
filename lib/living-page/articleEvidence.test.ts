import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database/types";
import type { ShownLine } from "@/lib/queries/sectionLines";
import { buildArticleEvidence, formatReferencePages, linkArticleText } from "./articleEvidence";

const lines = [
  { lineId: "l1", unitRevisionIds: ["old"] },
  { lineId: "l2", unitRevisionIds: ["old", "other"] },
] as ShownLine[];
const revisions = [{ id: "old", passage_ids: ["p1"] }, { id: "current", passage_ids: ["p2"] }, { id: "other", passage_ids: ["p2"] }] as Tables<"revisions">[];
const passages = [{ id: "p1", source_id: "s1", text: "Original evidence", location: { page: 7 } }, { id: "p2", source_id: "s2", text: "Different evidence", location: {} }] as Tables<"passages">[];
const sources = [{ id: "s1", title: "Handbook", source_date: "2025-01-01" }, { id: "s2", title: "Update", source_date: "2026-01-01" }] as Tables<"sources">[];

describe("article citations", () => {
  it("follows the cited revision and reuses numbers for shared evidence", () => {
    const evidence = buildArticleEvidence(lines, revisions, passages, sources);
    expect(evidence.byLine.get("l1")?.map((ref) => ref.number)).toEqual([1]);
    expect(evidence.byLine.get("l2")?.map((ref) => ref.number)).toEqual([1, 2]);
    expect(evidence.references[0]).toMatchObject({ title: "Handbook", quote: "Original evidence", page: 7 });
    expect(evidence.references).toHaveLength(2);
  });

  it("does not invent references when evidence is missing", () => {
    expect(buildArticleEvidence(lines, [], passages, sources).references).toEqual([]);
    expect(buildArticleEvidence(lines, revisions, [], sources).references).toEqual([]);
  });
});

describe("internal article links", () => {
  it("links actual known subjects and avoids repeated links in one paragraph", () => {
    const chunks = linkArticleText("Acme requires PPE. Acme reports incidents.", [{ label: "Acme", href: "/entities/acme" }]);
    expect(chunks.filter((chunk) => chunk.href)).toEqual([{ text: "Acme", href: "/entities/acme" }]);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe("Acme requires PPE. Acme reports incidents.");
  });

  it("escapes punctuation and matches whole words without interpreting markup", () => {
    const text = "C++ and C++X <script>safe text</script>";
    const chunks = linkArticleText(text, [{ label: "C++", href: "/p/cpp" }]);
    expect(chunks.filter((chunk) => chunk.href)).toEqual([{ text: "C++", href: "/p/cpp" }]);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
  });
});

describe("compact bibliography", () => {
  it("consolidates a document while retaining every cited passage and backlink", () => {
    const sameDocumentPassages = passages.map((passage) => ({ ...passage, source_id: "s1" }));
    const evidence = buildArticleEvidence(lines, revisions, sameDocumentPassages, sources);
    expect(evidence.references).toHaveLength(1);
    expect(evidence.references[0]?.passages).toHaveLength(2);
    expect(evidence.references[0]?.backlinks.map((link) => link.lineId)).toEqual(["l1", "l2"]);
    expect(evidence.byLine.get("l2")).toHaveLength(1);
    expect(evidence.byLine.get("l2")?.[0]?.citedPages).toEqual([7]);
    expect(evidence.byLine.get("l1")?.[0]?.anchorId).not.toBe(evidence.byLine.get("l2")?.[0]?.anchorId);
  });
  it("formats distinct page ranges compactly", () => {
    expect(formatReferencePages([9, 5, 8, 1, 5])).toBe("1, 5, 8–9");
  });
});
