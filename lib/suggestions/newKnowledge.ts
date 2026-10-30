import type { Tables } from "@/lib/database/types";

// =====================================================================
// NEW KNOWLEDGE (the Updates dialog on /pages). Sorts the wiki's open
// work into three stages and decides when the dialog opens by itself.
//   in_progress  a person accepted it and it is being written
//   pending      a suggestion waits for a person's answer
//   not started  claims on no article and in no suggestion yet
// =====================================================================

type SuggestionState = Pick<Tables<"article_suggestions">, "status" | "signals">;
export type SuggestionStage = "in_progress" | "pending" | "closed";

// A created article is saved as applied before its text is written.
export function isWritingSuggestion(item: SuggestionState) {
  const signals = item.signals as { writing?: boolean } | null;
  return item.status === "applied" && Boolean(signals?.writing);
}

export function suggestionStage(item: SuggestionState): SuggestionStage {
  if (item.status === "accepting" || isWritingSuggestion(item)) return "in_progress";
  if (item.status === "pending" || item.status === "failed" || item.status === "stale") return "pending";
  return "closed";
}

// Claims nobody has looked at: on no article, held by no suggestion, and not turned down
export function notStartedKnowledge(
  units: readonly { id: string; created_at: string }[],
  skip: Iterable<string>,
): { count: number; newestAt: string | null } {
  const skipped = new Set(skip);
  const waiting = units.filter((unit) => !skipped.has(unit.id));
  const newestAt = waiting.reduce<string | null>(
    (newest, unit) => (!newest || Date.parse(unit.created_at) > Date.parse(newest) ? unit.created_at : newest),
    null,
  );
  return { count: waiting.length, newestAt };
}

export type UploadWorkflow = { event_id: string; state: string };

const UPLOAD_EVENT_RUNNING = new Set(["received", "extracting", "reconciling", "checking"]);
const WORKFLOW_RUNNING = new Set(["pending", "running", "waiting"]);

// Uploads not finished yet. The workflow decides; before it starts only the event exists.
export function runningUploads(
  uploads: readonly { id: string; status: string }[],
  workflows: readonly UploadWorkflow[],
): number {
  const stateOf = new Map(workflows.map((workflow) => [workflow.event_id, workflow.state]));
  return uploads.filter((upload) => {
    const state = stateOf.get(upload.id);
    return state ? WORKFLOW_RUNNING.has(state) : UPLOAD_EVENT_RUNNING.has(upload.status);
  }).length;
}

// The time of the newest thing a person has not seen. Waiting suggestions count too.
export function newestWaiting(newestAt: string | null, pending: readonly { created_at: string }[]): string | null {
  return [newestAt, ...pending.map((item) => item.created_at)].reduce<string | null>(
    (newest, time) => (time && (!newest || Date.parse(time) > Date.parse(newest)) ? time : newest),
    null,
  );
}

// Opens only for something newer than the person last closed. An upload still running may
// place its own claims, so it waits.
export function shouldPrompt(newest: string | null, seen: string | null, uploading: number): boolean {
  if (!newest || uploading > 0) return false;
  return !seen || Date.parse(newest) > Date.parse(seen);
}
