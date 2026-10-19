import type { PageReviewSnapshot } from "./pageReview";

type RecordValue = Record<string, unknown>;
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.filter((item): item is RecordValue => !!item && typeof item === "object") : [];
const pick = (value: object, keys: string[]) => Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, (value as RecordValue)[key]]));
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

// An estimate, not a model tokenizer. UTF-8 bytes avoid undercounting non-Latin text.
export const estimateReviewTokens = (text: string) => Math.ceil(Buffer.byteLength(text, "utf8") / 3);

// citedEvidence holds the batch's claims, passages and sources, which stay the same while the
// page's lines are retried or reviewed again; it is sent first so the provider can cache it.
// evidence holds the rest (page, sections, lines, repairs, scope, related context).
export type ReviewBatch = { snapshot: PageReviewSnapshot; evidence: string; citedEvidence?: string; readOnly?: boolean };

// Lossless fallback for a bundle too large to review as a whole. Each record is
// serialized independently, with offsets so even a huge text/metadata field can
// be reconstructed exactly. Never turn partial evidence into a whole-line edit.
function fragmentBundle(context: RecordValue, snapshot: PageReviewSnapshot, tokenBudget: number, bundleIndex: number): ReviewBatch[] {
  const batches: ReviewBatch[] = [];
  for (const [kind, value] of Object.entries(context)) {
    const items = Array.isArray(value) ? value : [value];
    for (const [recordIndex, record] of items.entries()) {
      const serialized = JSON.stringify(record);
      const recordId = record && typeof record === "object" ? record.id ?? record.line_id ?? null : null;
      const payload = (start: number, end: number) => JSON.stringify({
        scope: { completeArticle: false, fragmentedEvidence: true, readOnly: true, bundleIndex },
        fragment: { kind, recordIndex, recordId, start, end, totalLength: serialized.length, encoding: "json-utf16", text: serialized.slice(start, end) },
      });
      let start = 0;
      while (start < serialized.length) {
        let low = start + 1;
        let high = serialized.length;
        let end = start;
        // Measure the escaped envelope too, not just the raw substring.
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          if (estimateReviewTokens(payload(start, middle)) <= tokenBudget - 100) { end = middle; low = middle + 1; }
          else high = middle - 1;
        }
        // Prefer a nearby natural boundary; preserve every character, including whitespace.
        if (end < serialized.length) {
          const boundary = serialized.lastIndexOf(" ", end - 1) + 1;
          if (boundary > start + (end - start) * 0.75) end = boundary;
          if (end > start && /[\uD800-\uDBFF]/.test(serialized[end - 1]!) && /[\uDC00-\uDFFF]/.test(serialized[end]!)) end--;
        }
        if (end <= start) throw new Error("The review budget is too small for an evidence fragment.");
        batches.push({ snapshot, evidence: payload(start, end), readOnly: true });
        start = end;
      }
    }
  }
  // Pack small metadata records together rather than paying for one call per ID.
  const packed: ReviewBatch[] = [];
  let fragments: RecordValue[] = [];
  const encode = (items: RecordValue[]) => JSON.stringify({ scope: { completeArticle: false, fragmentedEvidence: true, readOnly: true, bundleIndex }, fragments: items });
  for (const batch of batches) {
    const fragment = JSON.parse(batch.evidence).fragment as RecordValue;
    if (fragments.length && estimateReviewTokens(encode([...fragments, fragment])) > tokenBudget) {
      packed.push({ snapshot, evidence: encode(fragments), readOnly: true });
      fragments = [];
    }
    fragments.push(fragment);
  }
  if (fragments.length) packed.push({ snapshot, evidence: encode(fragments), readOnly: true });
  return packed;
}

// Prefer complete line -> claim -> passage bundles; fragment oversized bundles losslessly.
// The original snapshot remains untouched for the database's concurrency check.
export function buildReviewBatches(snapshot: PageReviewSnapshot, related: unknown, repairs: unknown[], tokenBudget: number) {
  if (!Number.isFinite(tokenBudget) || tokenBudget <= 1000) throw new Error("The model's context budget leaves no room for review evidence. Choose a larger context window.");
  const raw = snapshot as PageReviewSnapshot & RecordValue;
  const claims = records(raw.claims);
  const passages = records(raw.passages);
  const sources = records(raw.sources);
  const relatedPages = new Map<string, RecordValue>();
  const relatedClaims = records(related).map((claim) => {
    const pageIds = records(claim.pages).flatMap((page) => {
      if (typeof page.id !== "string" || page.id === snapshot.page.id) return [];
      relatedPages.set(page.id, page);
      return [page.id];
    });
    return { ...claim, pages: undefined, pageIds };
  });
  const contextFor = (lines: PageReviewSnapshot["lines"]) => {
    const revisionIds = new Set(lines.flatMap((line) => line.unit_revision_ids ?? []));
    const selectedClaims = claims.filter((claim) => revisionIds.has(String(claim.id)));
    const passageIds = new Set(selectedClaims.flatMap((claim) => strings(claim.passage_ids)));
    const selectedPassages = passages.filter((passage) => passageIds.has(String(passage.id)));
    const sourceIds = new Set(selectedPassages.map((passage) => passage.source_id));
    const sectionIds = new Set(lines.map((line) => line.section_id));
    return {
      page: pick(snapshot.page, ["id", "title", "slug"]),
      sections: (snapshot.sections ?? []).filter((section) => sectionIds.has(section.id)).map((section) => pick(section, ["id", "title", "mode", "position"])),
      lines: lines.map((line) => pick(line, ["line_id", "section_id", "content", "author", "unit_revision_ids", "position"])),
      claims: selectedClaims.map((claim) => pick(claim, ["id", "unit_id", "title", "content", "passage_ids", "source_date", "author"])),
      passages: selectedPassages.map((passage) => pick(passage, ["id", "text", "source_id", "location", "speaker_label", "confidence", "position"])),
      sources: sources.filter((source) => sourceIds.has(source.id)),
      automaticRepairs: repairs,
    };
  };
  const fits = (value: unknown) => estimateReviewTokens(JSON.stringify(value)) <= tokenBudget;
  // Leave room for scope metadata and supplementary context.
  const groups: PageReviewSnapshot["lines"][] = [];
  const oversized = new Set<PageReviewSnapshot["lines"][number]>();
  let current: PageReviewSnapshot["lines"] = [];
  for (const line of snapshot.lines) {
    if (current.length && estimateReviewTokens(JSON.stringify(contextFor([...current, line]))) > tokenBudget - 1000) {
      groups.push(current);
      current = [];
    }
    current.push(line);
    if (estimateReviewTokens(JSON.stringify(contextFor(current))) > tokenBudget - 1000) {
      oversized.add(line);
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  let limitedRelated = false;
  const batches = groups.flatMap((lines, index): ReviewBatch[] => {
    if (lines.some((line) => oversized.has(line))) {
      if (relatedClaims.length) limitedRelated = true;
      return fragmentBundle(contextFor(lines), { ...snapshot, lines, pages: [] }, tokenBudget, index);
    }
    const payload = {
      ...contextFor(lines),
      scope: { batch: index + 1, totalBatches: groups.length, completeArticle: groups.length === 1, relatedContextLimited: false },
      relatedKnowledge: [] as RecordValue[], relatedPages: [] as RecordValue[], pages: [] as PageReviewSnapshot["pages"],
    };
    // Optional discovery context never displaces the page's own cited evidence.
    for (const claim of relatedClaims) {
      const newPages = claim.pageIds.flatMap((id) => payload.relatedPages.some((page) => page.id === id) ? [] : [relatedPages.get(id)!]);
      const candidate = { ...payload, relatedKnowledge: [...payload.relatedKnowledge, claim], relatedPages: [...payload.relatedPages, ...newPages] };
      candidate.pages = candidate.relatedPages.map((page) => ({ id: String(page.id), title: String(page.title) }));
      if (fits(candidate)) Object.assign(payload, candidate);
      else { payload.scope.relatedContextLimited = true; limitedRelated = true; }
    }
    const batchSnapshot = { ...snapshot, lines, sections: (snapshot.sections ?? []).filter((section) => lines.some((line) => line.section_id === section.id)), pages: payload.pages };
    const { claims: cited, passages: citedPassages, sources: citedSources, ...rest } = payload;
    const citedEvidence = cited.length || citedPassages.length || citedSources.length ? JSON.stringify({ claims: cited, passages: citedPassages, sources: citedSources }) : undefined;
    return [{ snapshot: batchSnapshot, evidence: JSON.stringify(rest), ...(citedEvidence ? { citedEvidence } : {}) }];
  });
  return { batches, limitedRelated };
}
