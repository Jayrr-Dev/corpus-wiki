import type { Coverage, ScopeKind } from "@/lib/knowledge/scopeTypes";
import type { OutlineGroup } from "./outline";

// =====================================================================
// DOC SET ROWS: what list_doc_sets and read_doc_set return (supabase/
// migrations/20261120200000_docs.sql). Declared here rather than in the
// generated database types. No server-only imports: the reader reads them.
// =====================================================================

export type DocSetStatus = "writing" | "ready" | "failed";

// DB: list_doc_sets (one row per set, newest first)
export type DocSetSummary = {
  id: string;
  title: string;
  scopeKind: ScopeKind;
  scopeId: string | null;
  coverage: Coverage;
  status: DocSetStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
  stalePages: number;
};

export type DocLineRow = { lineId: string; content: string; unitRevisionIds: string[]; isStale: boolean };
export type DocSectionRow = { id: string; title: string; intro: boolean; status: "current" | "stale" | "building"; builtAt: string | null; lines: DocLineRow[] };
export type DocPageRow = { id: string; title: string; slug: string; position: number; group: OutlineGroup | null; sections: DocSectionRow[] };
export type DocClaimRow = { revisionId: string; unitId: string; title: string | null; content: string };

// DB: read_doc_set
export type DocSetView = Omit<DocSetSummary, "pageCount" | "stalePages"> & { pages: DocPageRow[]; claims: DocClaimRow[] };

// A page whose sources changed after it was written: a cited claim has a newer revision,
// or a section waits for a rebuild it already had once
export function isPageStale(page: DocPageRow): boolean {
  return page.sections.some((section) => section.lines.some((line) => line.isStale) || (section.status === "stale" && section.builtAt !== null));
}

// A page with a section that has never been built
export function isPageUnwritten(page: DocPageRow): boolean {
  return page.sections.some((section) => section.builtAt === null && section.status === "stale");
}

// A page being written: a section is building, or (while the set is still writing) its first build is
// pending. Once the set is done, an unwritten page failed and offers Rebuild page instead of waiting.
export function isPageWriting(page: DocPageRow, setWriting = true): boolean {
  return page.sections.some((section) => section.status === "building") || (setWriting && isPageUnwritten(page));
}
