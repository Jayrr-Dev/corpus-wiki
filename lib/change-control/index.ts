import type { DraftAction, DraftChangeSet } from "@/lib/ai/types";
import type { Enums } from "@/lib/database/types";
import type { DbRpc } from "@/lib/db/rpc";
import type { CommitResult, PersonAction } from "./types";
import { workflowWrite } from "@/lib/ingest/workflowContext";
import type { AutoRole } from "@/lib/ai/roles";

export type * from "./types";

// =====================================================================
// CHANGE CONTROL (agent B): thin TypeScript calls into the Postgres
// functions in supabase/migrations/20261014010000_change_control.sql,
// where the checks, the commit and undo live (one transaction each).
// =====================================================================

type Submitted = { changeSetId: string; eventId: string };

// WHO DRAFTED A CHANGESET AND WHY. eventId attaches the set to an existing event
// (an upload, or the living page rewriting lines after one); null starts a new event.
export type ChangeSetOrigin = { eventId: string | null; cause: Enums<"event_cause">; actor: Enums<"actor_kind">; operationKey?: string };

// Stores a drafted ChangeSet (its event is created when the origin has none)
export async function submitChangeSet(db: DbRpc, origin: ChangeSetOrigin, draft: DraftChangeSet): Promise<Submitted> {
  return workflowWrite<Submitted>(db, origin.operationKey ?? `submit:${draft.summary}`, "submit_change_set", {
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
  return workflowWrite<CommitResult>(db, `commit:${changeSetId}`, "commit_change_set", { p_change_set_id: changeSetId });
}

// Text patches are one indivisible edit, with the evidence snapshot checked
// under database locks. A rejected/held action rolls back the entire commit.
export async function commitTextPatchSet(db: DbRpc, changeSetId: string, evidence: { unitId: string; revisionId: string }[]): Promise<CommitResult> {
  return workflowWrite<CommitResult>(db, `commit-text-patches:${changeSetId}`, "commit_text_patch_set", { p_change_set_id: changeSetId, p_evidence: evidence });
}

// Stores a person's edit as a one-action ChangeSet and commits it
export async function commitPersonAction(db: DbRpc, action: PersonAction): Promise<CommitResult & { eventId: string }> {
  return commitPersonEdit(db, describePersonAction(action), [action]);
}

// Stores a person's edit of several actions (e.g. a line and the claim it states) as one ChangeSet and commits it
export async function commitPersonEdit(db: DbRpc, summary: string, actions: DraftAction[]): Promise<CommitResult & { eventId: string }> {
  const draft: DraftChangeSet = {
    summary,
    actions,
    trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null },
  };
  const { changeSetId, eventId } = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "person" }, draft);
  return { ...(await commitChangeSet(db, changeSetId)), eventId };
}

// Undoes an applied ChangeSet; returns the revert event id. An upload's folded stage
// (#49, supabase/migrations/20261124490000_stage_change_sets.sql) undoes as one, newest action first.
export async function revertChangeSet(db: DbRpc, changeSetId: string): Promise<{ eventId: string }> {
  return db.call<{ eventId: string }>("revert_upload_knowledge", { p_change_set_id: changeSetId });
}

// Answers an exception; accepting applies the held action. Returns the event to rebuild pages for
export async function resolveException(
  db: DbRpc,
  input: { exceptionId: string; accept: boolean; note: string | null },
): Promise<{ eventId: string | null; queued?: boolean }> {
  return db.call<{ eventId: string | null; queued?: boolean }>("resolve_exception", {
    p_exception_id: input.exceptionId,
    p_accept: input.accept,
    p_note: input.note,
  });
}

// FULL AUTO: accepts what a role in full auto just held in Exceptions (Agent Roles), so it never waits
// for a person. Nothing happens when the role is not in full auto or nothing was held. A null
// ChangeSet accepts every open one on the role's attributed ChangeSets (the Reviewer's page review).
export type AutoAccepted = { exceptionId: string; reason: string; actionId: string; eventId: string | null };
export async function autoAcceptHeld(db: DbRpc, role: AutoRole, changeSetId: string | null, held: number): Promise<AutoAccepted[]> {
  if (!(held > 0)) return [];
  return db.call<AutoAccepted[]>("auto_accept_exceptions", { p_role: role, p_change_set_id: changeSetId });
}

// Commits a role's ChangeSet, then accepts what it held when the role is in full auto
export async function commitAsRole(db: DbRpc, role: AutoRole, changeSetId: string): Promise<CommitResult & { autoAccepted: AutoAccepted[] }> {
  const result = await commitChangeSet(db, changeSetId);
  const autoAccepted = await autoAcceptHeld(db, role, changeSetId, result.exceptions);
  return autoAccepted.length ? { ...result, exceptions: result.exceptions - autoAccepted.length, autoAccepted } : { ...result, autoAccepted };
}

// ONE LINE FOR THE CHANGES SCREEN, per edit type
function describePersonAction(action: PersonAction): string {
  switch (action.type) {
    case "create_entity":
      return `Added entity: ${action.input.name}`;
    case "update_entity":
      return `Renamed an entity to ${action.input.name}`;
    case "retire_entity":
      return `Retired an entity: ${action.input.reason}`;
    case "create_domain":
      return `Added domain: ${action.input.path}`;
    case "update_domain":
      return `Renamed a domain to ${action.input.name}`;
    case "retire_domain":
      return `Retired a domain: ${action.input.reason}`;
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
