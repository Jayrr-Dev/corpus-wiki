import type { DocSetSummary } from "@/lib/docs/types";
import { SCOPE_KIND_LABELS, type ScopeOptions } from "@/lib/knowledge/scopeTypes";

// Short dates in lists (AGENTS.md)
export const shortDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// "Topic · Operations › Clusters"
export function scopeName(set: Pick<DocSetSummary, "scopeKind" | "scopeId">, options: ScopeOptions): string {
  const kind = SCOPE_KIND_LABELS[set.scopeKind];
  if (set.scopeKind === "glossary") return kind;
  const label = options[set.scopeKind].find((option) => option.id === set.scopeId)?.label;
  return label ? `${kind} · ${label}` : kind;
}
