"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { commitPersonAction, type CommitResult, type PersonAction, resolveException, revertChangeSet } from "@/lib/change-control";
import { rebuildAfterEvent } from "@/lib/living-page";
import { getServerDeps } from "@/lib/server/deps";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// KNOWLEDGE ACTIONS: every change a person makes goes through Change
// control as a typed action, then the affected page sections rebuild.
// =====================================================================

// EDIT: revise, retire, link, set status or add a claim (ActionDialog, inline page edits)
export async function submitEdit(action: PersonAction): Promise<ActionResult<CommitResult>> {
  return toActionResult(async () => {
    await requireUser();
    const { db, writer } = getServerDeps();
    const { eventId, ...result } = await commitPersonAction(db, action);
    await rebuildAfterEvent(db, writer, eventId);
    return result;
  });
}

// UNDO: reverts one applied ChangeSet (Changes screen)
export async function undoChangeSet(changeSetId: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const { db, writer } = getServerDeps();
    const { eventId } = await revertChangeSet(db, changeSetId);
    await rebuildAfterEvent(db, writer, eventId);
    return {};
  });
}

// ANSWER AN EXCEPTION: accept applies the held action, reject drops it (Exceptions screen)
export async function answerException(exceptionId: string, accept: boolean, note: string | null): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const { db, writer } = getServerDeps();
    const { eventId } = await resolveException(db, { exceptionId, accept, note });
    if (eventId) await rebuildAfterEvent(db, writer, eventId);
    return {};
  });
}
