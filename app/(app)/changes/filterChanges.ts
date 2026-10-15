import type { Tables } from "@/lib/database/types";

// =====================================================================
// CHANGE FILTERS: what /changes can narrow by. Every value is a URL search
// param, so a filtered list can be linked or reloaded as it is.
// =====================================================================

export type ChangeKind = "knowledge" | "page_rewrite" | "article" | "links" | "duplicates";

export type ChangeWhen = "" | "today" | "week" | "month";

export type ChangeFilters = { status: string; by: string; kind: string; when: ChangeWhen };

export const CHANGE_FILTER_KEYS = ["status", "by", "kind", "when"] as const;

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  knowledge: "Knowledge changes",
  page_rewrite: "Page rewrites",
  article: "Article updates",
  links: "Links",
  duplicates: "Duplicate cleanup",
};

// Reads the filters from search params ("" = any)
export function readChangeFilters(params: { get: (key: string) => string | null }): ChangeFilters {
  const when = params.get("when");
  return {
    status: params.get("status") ?? "",
    by: params.get("by") ?? "",
    kind: params.get("kind") ?? "",
    when: when === "today" || when === "week" || when === "month" ? when : "",
  };
}

// What a change set did, from the summary its writer gives it (lib/living-page, lib/ingest, lib/server-actions/pages)
export function changeKind(summary: string): ChangeKind {
  if (/^Rewrote \d+ lines? of /.test(summary)) return "page_rewrite";
  if (summary.startsWith("Updated article")) return "article";
  if (summary.startsWith("Linked existing claims")) return "links";
  if (summary.startsWith("Cleaning cycle")) return "duplicates";
  return "knowledge";
}

// Earliest created_at a "when" filter keeps (start of today, or 7/30 days back)
function sinceFor(when: ChangeWhen, now: Date): number | null {
  if (!when) return null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = when === "today" ? 0 : when === "week" ? 6 : 29;
  return startOfToday - days * 24 * 60 * 60 * 1000;
}

export function filterChanges(changeSets: readonly Tables<"change_sets">[], filters: ChangeFilters, now = new Date()): Tables<"change_sets">[] {
  const since = sinceFor(filters.when, now);
  return changeSets.filter(
    (changeSet) =>
      (!filters.status || changeSet.status === filters.status) &&
      (!filters.by || changeSet.proposed_by === filters.by) &&
      (!filters.kind || changeKind(changeSet.summary) === filters.kind) &&
      (since === null || new Date(changeSet.created_at).getTime() >= since),
  );
}
