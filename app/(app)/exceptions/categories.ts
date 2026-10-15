import type { Enums } from "@/lib/database/types";

// =====================================================================
// EXCEPTION CATEGORIES: the tabs on /exceptions. Each reason belongs to
// exactly one category, so every exception shows under one tab (and All).
// =====================================================================

export type ExceptionCategory = "conflicts" | "removals" | "updates" | "uncertain" | "structure";

export type CategoryTab = ExceptionCategory | "all";

export const CATEGORY_OF_REASON: Record<Enums<"exception_reason">, ExceptionCategory> = {
  decision_conflict: "conflicts",
  source_tie: "conflicts",
  deletion: "removals",
  low_confidence: "uncertain",
  domain_tree_review: "structure",
  update_request: "updates",
};

// TAB ORDER AND WORDS
export const CATEGORY_TABS: { id: CategoryTab; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Everything the checks could not decide" },
  { id: "conflicts", label: "Conflicts", hint: "Sources or decisions that disagree" },
  { id: "removals", label: "Removals", hint: "Changes that would retire knowledge" },
  { id: "updates", label: "Update requests", hint: "The AI wants to change a line a person wrote" },
  { id: "uncertain", label: "Low confidence", hint: "The AI was unsure enough to ask first" },
  { id: "structure", label: "Structure", hint: "Reviews of the domain tree" },
];

// Whether an exception with this reason shows under the tab
export function inTab(tab: CategoryTab, reason: Enums<"exception_reason">): boolean {
  return tab === "all" || CATEGORY_OF_REASON[reason] === tab;
}
