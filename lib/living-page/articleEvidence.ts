import type { Tables } from "@/lib/database/types";
import { type MediaKind, mediaKindOf } from "@/lib/ingest/formats";
import type { ShownLine } from "@/lib/queries/sectionLines";

export type ReferencePassage = { id: string; quote: string; page: number | null };
export type ArticleReference = {
  number: number; firstLineId: string; passageId: string; sourceId: string; title: string; date: string;
  quote: string; page: number | null; passages: ReferencePassage[]; backlinks: { lineId: string; anchorId: string }[];
};
export type ArticleCitation = ArticleReference & { anchorId: string; citedPages: number[] };
// A PICTURE OR FILM SOURCE, or a picture embedded in a document, drawn once beside the first line
// that cites it, its description as caption; `key` tells figures from the same source apart
export type ArticleFigure = { key: string; sourceId: string; kind: MediaKind; title: string; caption: string; src: string; referenceNumber: number };
export type ArticleEvidence = { references: ArticleReference[]; byLine: Map<string, ArticleCitation[]>; figuresByLine: Map<string, ArticleFigure[]> };

// One bibliography entry per document; exact passage/page evidence stays attached
// to each occurrence, following the revision actually cited by the paragraph.
// `captions` holds each image or video source's summary (its first passage); without one the
// figure is captioned with the first passage the article cites from it.
export function buildArticleEvidence(lines: ShownLine[], revisions: Tables<"revisions">[], passages: Tables<"passages">[], sources: Tables<"sources">[], captions: ReadonlyMap<string, string> = new Map()): ArticleEvidence {
  const revisionById = new Map(revisions.map((row) => [row.id, row]));
  const passageById = new Map(passages.map((row) => [row.id, row]));
  const sourceById = new Map(sources.map((row) => [row.id, row]));
  const references: ArticleReference[] = [];
  const bySource = new Map<string, ArticleReference>();
  const byLine = new Map<string, ArticleCitation[]>();
  // Pictures embedded in a document (location.figure), each at the first line citing its description
  const embedded = new Map<string, EmbeddedFigure>();
  for (const line of lines) {
    const cited = new Map<string, { reference: ArticleReference; pages: Set<number> }>();
    const ids = [...new Set(line.unitRevisionIds.flatMap((id) => revisionById.get(id)?.passage_ids ?? []))];
    for (const id of ids) {
      const passage = passageById.get(id);
      const source = passage ? sourceById.get(passage.source_id) : undefined;
      if (!passage || !source) continue;
      const location = passage.location as { page?: unknown; figure?: unknown } | null;
      const page = typeof location?.page === "number" ? location.page : null;
      let reference = bySource.get(source.id);
      if (!reference) {
        reference = { number: references.length + 1, firstLineId: line.lineId, passageId: id, sourceId: source.id, title: source.title, date: source.source_date, quote: passage.text, page, passages: [], backlinks: [] };
        references.push(reference);
        bySource.set(source.id, reference);
      }
      if (!reference.passages.some((entry) => entry.id === id)) reference.passages.push({ id, quote: passage.text, page });
      if (!cited.has(source.id)) cited.set(source.id, { reference, pages: new Set() });
      if (typeof location?.figure === "string" && !embedded.has(location.figure)) {
        embedded.set(location.figure, { path: location.figure, lineId: line.lineId, reference, caption: passage.text });
      }
      if (page !== null) cited.get(source.id)!.pages.add(page);
    }
    byLine.set(line.lineId, [...cited.values()].map(({ reference, pages }) => {
      const anchorId = `citation-${reference.number}-${line.lineId}`;
      reference.backlinks.push({ lineId: line.lineId, anchorId });
      return { ...reference, anchorId, citedPages: [...pages].sort((a, b) => a - b) };
    }));
  }
  return { references, byLine, figuresByLine: buildArticleFigures(references, sourceById, captions, [...embedded.values()]) };
}

type EmbeddedFigure = { path: string; lineId: string; reference: ArticleReference; caption: string };

// The stored file, through the route that signs a short-lived URL for it
export const sourceFileSrc = (sourceId: string) => `/api/sources/${sourceId}/file`;
export const embeddedFigureSrc = (sourceId: string, path: string) => `/api/sources/${sourceId}/figure?path=${encodeURIComponent(path)}`;

// One figure per image or video source, and one per picture embedded in a cited document,
// beside the first line citing it (in article order)
function buildArticleFigures(references: ArticleReference[], sourceById: ReadonlyMap<string, Tables<"sources">>, captions: ReadonlyMap<string, string>, embedded: EmbeddedFigure[]): Map<string, ArticleFigure[]> {
  const figuresByLine = new Map<string, ArticleFigure[]>();
  const place = (lineId: string, figure: ArticleFigure) => figuresByLine.set(lineId, [...(figuresByLine.get(lineId) ?? []), figure]);
  for (const reference of references) {
    const kind = mediaKindOf(sourceById.get(reference.sourceId)?.mime_type);
    if (!kind) continue;
    place(reference.firstLineId, { key: reference.sourceId, sourceId: reference.sourceId, kind, title: reference.title, caption: captions.get(reference.sourceId) ?? reference.quote, src: sourceFileSrc(reference.sourceId), referenceNumber: reference.number });
  }
  for (const { path, lineId, reference, caption } of embedded) {
    place(lineId, { key: path, sourceId: reference.sourceId, kind: "image", title: reference.title, caption, src: embeddedFigureSrc(reference.sourceId, path), referenceNumber: reference.number });
  }
  return figuresByLine;
}

export function formatReferencePages(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const groups: string[] = [];
  for (let index = 0; index < sorted.length; index++) {
    const start = sorted[index]!;
    let end = start;
    while (sorted[index + 1] === end + 1) end = sorted[++index]!;
    groups.push(start === end ? String(start) : `${start}–${end}`);
  }
  return groups.join(", ");
}

export type ArticleLink = { label: string; href: string };
export function linkArticleText(text: string, links: ArticleLink[]): { text: string; href?: string }[] {
  const candidates = links.filter((link) => link.label.trim().length > 2).sort((a, b) => b.label.length - a.label.length);
  const used = new Set<string>();
  const result: { text: string; href?: string }[] = [];
  const escaped = candidates.map((link) => link.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return [{ text }];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) result.push({ text: text.slice(cursor, match.index) });
    const target = candidates.find((link) => link.label.toLocaleLowerCase() === match[0].toLocaleLowerCase());
    result.push({ text: match[0], href: target && !used.has(target.href) ? target.href : undefined });
    if (target) used.add(target.href);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor) });
  return result;
}
