import { describe, expect, it } from "vitest";
import { buildReviewBatches, estimateReviewTokens } from "./reviewContext";
import type { PageReviewSnapshot } from "./pageReview";

const snapshot = { page: { id: "p", title: "Safety", slug: "safety" }, pages: [], sections: [], lines: [{ line_id: "l", content: "Weekly inspections.", unit_revision_ids: ["r"] }], claims: [{ id: "r", content: "Weekly inspections.", passage_ids: ["e"] }], passages: [{ id: "e", source_id: "s", text: "Inspect weekly.", confidence: 0.8 }], sources: [{ id: "s", title: "Manual" }] };

describe("review context packing", () => {
  it("deduplicates related page text without changing the concurrency snapshot", () => {
    const original = structuredClone(snapshot);
    const page = { id: "other", title: "Overview", content: "Related page text ".repeat(1000) };
    const { batches } = buildReviewBatches(snapshot, [{ content: "A", pages: [page] }, { content: "B", pages: [page] }], [], 20000);
    const evidence = JSON.parse(batches[0]!.evidence);
    expect(evidence.relatedPages).toEqual([page]);
    expect(evidence.relatedKnowledge.map((claim: { pageIds: string[] }) => claim.pageIds)).toEqual([["other"], ["other"]]);
    expect(snapshot).toEqual(original);
  });

  it("packs every line with its complete claims, passages and source", () => {
    const large = { ...snapshot, lines: Array.from({ length: 5 }, (_, i) => ({ line_id: `l${i}`, content: `Paragraph ${i}`, unit_revision_ids: [`r${i}`] })), claims: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, content: `Fact ${i}`, passage_ids: [`e${i}`] })), passages: Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, source_id: "s", text: `Evidence ${i} ` + "文".repeat(2000) })) };
    const { batches } = buildReviewBatches(large, [], [], 5000);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((batch) => batch.snapshot.lines)).toEqual(large.lines);
    for (const batch of batches) {
      expect(estimateReviewTokens(batch.evidence)).toBeLessThanOrEqual(5000);
      const data = JSON.parse(batch.evidence);
      expect(data.scope.completeArticle).toBe(false);
      for (const line of data.lines) {
        const claim = data.claims.find((claim: { id: string }) => claim.id === line.unit_revision_ids[0]);
        expect(data.passages.find((passage: { id: string }) => passage.id === claim.passage_ids[0])).toEqual(large.passages.find((passage) => passage.id === claim.passage_ids[0]));
      }
      expect(data.sources).toEqual(snapshot.sources);
    }
  });

  it("omits oversized optional context with an explicit scope flag", () => {
    const { batches, limitedRelated } = buildReviewBatches(snapshot, [{ content: "Related", pages: [{ id: "other", title: "Other", content: "x".repeat(30000) }] }], [], 3000);
    expect(limitedRelated).toBe(true);
    const data = JSON.parse(batches[0]!.evidence);
    expect(data.passages).toEqual(snapshot.passages);
    expect(data.scope.relatedContextLimited).toBe(true);
    expect(data.relatedPages).toEqual([]);
  });

  it("splits an oversized paragraph losslessly instead of stopping", () => {
    const large: PageReviewSnapshot = { ...snapshot, lines: [{ content: "x".repeat(20000) }] };
    const { batches } = buildReviewBatches(large, [], [], 3000);
    const fragments = batches.flatMap((batch) => JSON.parse(batch.evidence).fragments).filter((fragment) => fragment.kind === "lines");
    expect(fragments.length).toBeGreaterThan(1);
    expect(JSON.parse(fragments.map((fragment) => fragment.text).join(""))).toEqual(large.lines[0]);
    expect(batches.every((batch) => batch.readOnly && estimateReviewTokens(batch.evidence) <= 3000)).toBe(true);
  });

  it("retains complete oversized claims, citations and passages including Unicode and escaped text", () => {
    const text = '😀漢字 \\ "quoted"\n'.repeat(1800);
    const large = { ...snapshot, claims: [{ id: "r", content: text, passage_ids: ["e"] }], passages: [{ id: "e", source_id: "s", text, confidence: 0.8 }] };
    const original = structuredClone(large);
    const { batches } = buildReviewBatches(large, [], [], 3000);
    const fragments = batches.flatMap((batch) => JSON.parse(batch.evidence).fragments);
    for (const kind of ["lines", "claims", "passages", "sources"] as const) {
      const parts = fragments.filter((fragment) => fragment.kind === kind);
      let offset = 0;
      for (const part of parts) {
        expect(part.start).toBe(offset);
        expect(part.text.length).toBe(part.end - part.start);
        expect(part.text.isWellFormed()).toBe(true);
        offset = part.end;
      }
      expect(offset).toBe(parts[0].totalLength);
      expect(JSON.parse(parts.map((part) => part.text).join(""))).toEqual(large[kind][0]);
    }
    expect(large).toEqual(original);
    expect(batches.every((batch) => estimateReviewTokens(batch.evidence) <= 3000)).toBe(true);
  });
});
