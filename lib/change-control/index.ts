import type { DraftChangeSet } from "@/lib/ai/types";
import type { Enums } from "@/lib/database/types";
import type { DbRpc } from "@/lib/db/rpc";
import type { CommitResult, PersonAction } from "./types";

export type * from "./types";

// =====================================================================
// CHANGE CONTROL (agent B): thin TypeScript calls into the Postgres
// functions in supabase/migrations/20261014010000_change_control.sql,
// where the checks, the commit and undo live (one transaction each).
// =====================================================================

type Submitted = { changeSetId: string; eventId: string };

// WHO DRAFTED A CHANGESET AND WHY: an upload's AI, or a person's edit
export type ChangeSetOrigin =
  | { eventId: string; cause: "upload"; actor: "ai" }
  | { eventId: null; cause: Enums<"event_cause">; actor: "person" };

// Stores a drafted ChangeSet (its event is created when the origin has none)
export async function submitChangeSet(db: DbRpc, origin: ChangeSetOrigin, draft: DraftChangeSet): Promise<Submitted> {
  return db.call<Submitted>("submit_change_set", {
    p_event_id: origin.eventId,
    p_cause: origin.cause,
    p_actor: origin.actor,
    p_summary: draft.summary,
    p_trace: draft.trace,
    p_actions: draft.actions,
  });
}

// Checks and applies a stored ChangeSet in one transaction
export async function commitChangeSet(db: DbRpc, changeSetId: string): Promise<CommitResult> {
  return db.call<CommitResult>("commit_change_set", { p_change_set_id: changeSetId });
}

// Stores a person's edit as a one-action ChangeSet and commits it
export async function commitPersonAction(db: DbRpc, action: PersonAction): Promise<CommitResult & { eventId: string }> {
  const draft: DraftChangeSet = {
    summary: describePersonAction(action),
    actions: [action],
    trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null },
  };
  const { changeSetId, eventId } = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "person" }, draft);
  return { ...(await commitChangeSet(db, changeSetId)), eventId };
}

// Undoes an applied ChangeSet; returns the revert event id
export async function revertChangeSet(db: DbRpc, changeSetId: string): Promise<{ eventId: string }> {
  return db.call<{ eventId: string }>("revert_change_set", { p_change_set_id: changeSetId });
}

// Answers an exception; accepting applies the held action. Returns the event to rebuild pages for
export async function resolveException(
  db: DbRpc,
  input: { exceptionId: string; accept: boolean; note: string | null },
): Promise<{ eventId: string | null }> {
  return db.call<{ eventId: string | null }>("resolve_exception", {
    p_exception_id: input.exceptionId,
    p_accept: input.accept,
    p_note: input.note,
  });
}

// ONE LINE FOR THE CHANGES SCREEN, per edit type
function describePersonAction(action: PersonAction): string {
  switch (action.type) {
    case "add_claim":
      return `Added: ${action.input.content}`;
    case "revise_claim":
      return `Edited: ${action.input.content}`;
    case "retire_claim":
      return `Retired a unit: ${action.input.reason}`;
    case "link":
      return `Linked two units (${action.input.type.replaceAll("_", " ")})`;
    case "set_epistemic_status":
      return `Marked a unit ${action.input.epistemicStatus}`;
  }
}
