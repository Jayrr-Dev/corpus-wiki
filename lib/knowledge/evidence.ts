import type { Tables } from "@/lib/database/types";

// =====================================================================
// EVIDENCE STATE: what the sources behind a unit look like now (the
// unit_evidence view), and the lifecycle state of a source file.
// =====================================================================

// unsourced: a person's own claim · sourced: every cited file active ·
// stale: a cited file is archived or replaced · lost: a cited file was deleted
export type Evidence = "sourced" | "stale" | "lost" | "unsourced";

const EVIDENCE_VALUES: readonly Evidence[] = ["sourced", "stale", "lost", "unsourced"];

// The view's text column as the closed set (anything unexpected reads as sourced)
export function toEvidence(value: string | null | undefined): Evidence {
  return EVIDENCE_VALUES.find((evidence) => evidence === value) ?? "sourced";
}

export type SourceState = "active" | "archived" | "replaced";

// A replaced file is archived and points at its newer version
export function sourceState(source: Pick<Tables<"sources">, "archived_at" | "replaced_by_id">): SourceState {
  if (source.replaced_by_id) return "replaced";
  return source.archived_at ? "archived" : "active";
}
