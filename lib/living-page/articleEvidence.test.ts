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
  it("matches hyphen and whitespace variants without changing paragraph wording", () => {
    const text = "The modified-work program uses Safety  data sheets. Modified–work program.";
    const chunks = linkArticleText(text, [{ label: "modified work program", href: "/p/safety#return" }, { label: "Safety data sheets", href: "/p/safety#chemicals" }]);
    expect(chunks.filter((chunk) => chunk.href)).toEqual([{ text: "modified-work program", href: "/p/safety#return" }, { text: "Safety  data sheets", href: "/p/safety#chemicals" }]);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
  });

  it("keeps explicit article links ahead of inferred aliases", () => {
    expect(linkArticleText("Modified-work program", [{ label: "Modified work program", href: "/p/explicit" }, { label: "Modified-work program", href: "/p/inferred#section" }])[0]?.href).toBe("/p/explicit");
  });
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

describe("article figures", () => {
  const mediaLines = [
    { lineId: "l1", unitRevisionIds: ["r-text"] },
    { lineId: "l2", unitRevisionIds: ["r-image"] },
    { lineId: "l3", unitRevisionIds: ["r-image", "r-video"] },
  ] as ShownLine[];
  const mediaRevisions = [
    { id: "r-text", passage_ids: ["p-text"] },
    { id: "r-image", passage_ids: ["p-image"] },
    { id: "r-video", passage_ids: ["p-video"] },
  ] as Tables<"revisions">[];
  const mediaPassages = [
    { id: "p-text", source_id: "doc", text: "Handbook text", location: {} },
    { id: "p-image", source_id: "img", text: "Q4 revenue was 5.0 million USD.", location: {} },
    { id: "p-video", source_id: "vid", text: "The demo shows the arm picking a box.", location: {} },
  ] as Tables<"passages">[];
  const mediaSources = [
    { id: "doc", title: "Handbook.pdf", source_date: "2025-01-01", mime_type: "application/pdf" },
    { id: "img", title: "revenue.png", source_date: "2025-02-01", mime_type: "image/png" },
    { id: "vid", title: "demo.mp4", source_date: "2025-03-01", mime_type: "video/mp4" },
  ] as Tables<"sources">[];

  it("shows each image or video once, beside the first line citing it, captioned by its summary", () => {
    const evidence = buildArticleEvidence(mediaLines, mediaRevisions, mediaPassages, mediaSources, new Map([["img", "Bar chart of Acme revenue."]]));
    expect(evidence.figuresByLine.get("l1")).toBeUndefined();
    expect(evidence.figuresByLine.get("l2")).toEqual([
      { key: "img", sourceId: "img", kind: "image", title: "revenue.png", caption: "Bar chart of Acme revenue.", src: "/api/sources/img/file", referenceNumber: 2 },
    ]);
    // The image already stands beside l2; the video is new on l3 and, without a summary, uses the cited passage
    expect(evidence.figuresByLine.get("l3")).toEqual([
      { key: "vid", sourceId: "vid", kind: "video", title: "demo.mp4", caption: "The demo shows the arm picking a box.", src: "/api/sources/vid/file", referenceNumber: 3 },
    ]);
  });

  it("shows a picture embedded in a document beside the first line citing its description", () => {
    const path = `figures/${"a".repeat(64)}.png`;
    const docPassages = [
      { id: "p-text", source_id: "doc", text: "Handbook text", location: {} },
      { id: "p-image", source_id: "doc", text: "Figure 1: Site plan of lot 2.", location: { figure: path } },
      { id: "p-video", source_id: "doc", text: "The plan marks the right-of-way.", location: { figure: path } },
    ] as Tables<"passages">[];
    const evidence = buildArticleEvidence(mediaLines, mediaRevisions, docPassages, mediaSources);
    expect(evidence.figuresByLine.get("l1")).toBeUndefined();
    expect(evidence.figuresByLine.get("l2")).toEqual([
      { key: path, sourceId: "doc", kind: "image", title: "Handbook.pdf", caption: "Figure 1: Site plan of lot 2.", src: `/api/sources/doc/figure?path=${encodeURIComponent(path)}`, referenceNumber: 1 },
    ]);
    // The same picture is not drawn again for a later line citing it
    expect(evidence.figuresByLine.get("l3")).toBeUndefined();
  });
});
