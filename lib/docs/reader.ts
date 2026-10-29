import { type DocBlock, parseDocBlock } from "./blocks";
import { OUTLINE_GROUP_LABELS, OUTLINE_GROUPS } from "./outline";
import type { DocClaimRow, DocPageRow, DocSetView } from "./types";

// =====================================================================
// READER MODEL (/docs/[id]): the page tree, a page's blocks by section,
// its "On this page" headings and the claims behind each citation.
// Pure: the reader component renders what these return.
// =====================================================================

export type ReaderSection = { id: string; anchor: string; title: string; intro: boolean; blocks: { key: string; block: DocBlock; stale: boolean }[] };
export type ReaderHeading = { anchor: string; text: string; level: 2 | 3 };

export const sectionAnchor = (sectionId: string) => `task-${sectionId.slice(0, 8)}`;
export const subtaskAnchor = (lineId: string) => `step-${lineId.slice(0, 8)}`;

// A page's sections with their blocks in order (unwritten sections have no blocks yet)
export function readerSections(page: DocPageRow): ReaderSection[] {
  return page.sections.map((section) => ({
    id: section.id,
    anchor: sectionAnchor(section.id),
    title: section.title,
    intro: section.intro,
    blocks: section.lines.map((line) => ({ key: line.lineId, block: parseDocBlock(line.content), stale: line.isStale })),
  }));
}

// "On this page": each task (H2) and the sub-tasks under it (H3)
export function pageHeadings(sections: readonly ReaderSection[]): ReaderHeading[] {
  return sections.flatMap((section) => section.intro ? [] : [
    { anchor: section.anchor, text: section.title, level: 2 as const },
    ...section.blocks.flatMap(({ key, block }) => (block.type === "heading" ? [{ anchor: subtaskAnchor(key), text: block.text, level: 3 as const }] : [])),
  ]);
}

// The page tree: pages under their task group (set up, use, change, remove), in set order
export function pageTree(pages: readonly DocPageRow[]): { label: string | null; pages: DocPageRow[] }[] {
  const grouped = OUTLINE_GROUPS.map((group) => ({ label: OUTLINE_GROUP_LABELS[group], pages: pages.filter((page) => page.group === group) })).filter((entry) => entry.pages.length);
  const loose = pages.filter((page) => !page.group);
  return [...(loose.length ? [{ label: null, pages: loose }] : []), ...grouped];
}

// Citations name claims (unit ids); the reader shows each claim's current revision text
export function claimsByUnit(set: Pick<DocSetView, "claims">): Map<string, DocClaimRow> {
  return new Map(set.claims.map((claim) => [claim.unitId, claim]));
}
