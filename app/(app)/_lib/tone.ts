import type { Enums } from "@/lib/database/types";
import type { Evidence, SourceState } from "@/lib/knowledge/evidence";

// =====================================================================
// STATUS TONES: which accent (if any) a status earns. One table per enum,
// so every screen colours the same status the same way.
// =====================================================================

export type Tone = "applied" | "needs-you" | "failed" | "stale" | "faint" | "muted";

// CHANGE SETS: applied green, rejected red, partly applied orange, reverted faint
export const CHANGE_SET_TONE: Record<Enums<"change_set_status">, Tone> = {
  draft: "muted",
  checking: "muted",
  applied: "applied",
  partly_applied: "needs-you",
  rejected: "failed",
  reverted: "faint",
};

// ACTIONS: an exception is waiting on the person
export const ACTION_TONE: Record<Enums<"action_outcome">, Tone> = {
  pending: "muted",
  applied: "applied",
  exception: "needs-you",
  rejected: "failed",
  reverted: "faint",
};

// SHIFT EVENTS: in-flight steps stay gray until the pipeline finishes
export const EVENT_TONE: Record<Enums<"event_status">, Tone> = {
  received: "muted",
  extracting: "muted",
  reconciling: "muted",
  checking: "muted",
  applied: "applied",
  partly_applied: "needs-you",
  failed: "failed",
  reverted: "faint",
};

// EXCEPTIONS: open needs the person; answered ones are quiet
export const EXCEPTION_TONE: Record<Enums<"exception_status">, Tone> = {
  open: "needs-you",
  accepted: "applied",
  rejected: "faint",
};

// UNIT EVIDENCE: stale and lost knowledge stand out; sourced is quiet
export const EVIDENCE_TONE: Record<Evidence, Tone> = {
  sourced: "faint",
  unsourced: "faint",
  stale: "stale",
  lost: "failed",
};

// SOURCE FILES: an archived or replaced file no longer counts as evidence
export const SOURCE_STATE_TONE: Record<SourceState, Tone> = {
  active: "applied",
  archived: "stale",
  replaced: "faint",
};
