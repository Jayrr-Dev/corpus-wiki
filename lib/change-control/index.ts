import type { DbRpc } from "@/lib/db/rpc";
import type { CommitResult, PersonAction } from "./types";

export type * from "./types";

// =====================================================================
// CHANGE CONTROL (agent B): CONTRACT STUB, implemented next.
// =====================================================================

// Stores a person's edit as a one-action ChangeSet and commits it
export async function commitPersonAction(db: DbRpc, action: PersonAction): Promise<CommitResult & { eventId: string }> {
  void db;
  void action;
  throw new Error("commitPersonAction is not built yet.");
}

// Undoes an applied ChangeSet; returns the revert event id
export async function revertChangeSet(db: DbRpc, changeSetId: string): Promise<{ eventId: string }> {
  void db;
  void changeSetId;
  throw new Error("revertChangeSet is not built yet.");
}

// Answers an exception; accepting applies the held action. Returns the event to rebuild pages for
export async function resolveException(
  db: DbRpc,
  input: { exceptionId: string; accept: boolean; note: string | null },
): Promise<{ eventId: string | null }> {
  void db;
  void input;
  throw new Error("resolveException is not built yet.");
}
