import type { DraftAction } from "@/lib/ai/types";

// =====================================================================
// CHANGE CONTROL TYPES: what callers send in and get back.
// =====================================================================

// EDITS A PERSON MAKES FROM A SCREEN (each becomes a one-action ChangeSet)
export type PersonActionType = "add_claim" | "revise_claim" | "retire_claim" | "link" | "set_epistemic_status";
export type PersonAction = Extract<DraftAction, { type: PersonActionType }>;

// RESULT OF ONE COMMIT (returned by commit_change_set)
export type CommitResult = {
  changeSetId: string;
  status: "applied" | "partly_applied" | "rejected";
  applied: number;
  exceptions: number;
  rejected: number;
};
