"use server";

import { after } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { currentActor, withSpaceActor } from "@/lib/auth/currentPerson";
import { applyRootApprovalBatches } from "@/lib/processing/rootApprovals";
import { commitPersonAction, type CommitResult, type PersonAction, resolveException, revertChangeSet } from "@/lib/change-control";
import { commitLineEdit, rebuildAfterEvent, rebuildSection } from "@/lib/living-page";
import { getServerDeps } from "@/lib/server/deps";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { finishApprovedUpload } from "@/lib/ingest/pipeline";
import { type ActionResult, toActionResult } from "./result";

// Keep newly created/restored revisions searchable after the response is sent.
function refreshEmbeddings(claimEmbedder: (() => Promise<void>) | undefined) {
  if (claimEmbedder) after(() => claimEmbedder().catch((error) => console.error("Knowledge embeddings could not be refreshed:", error)));
}

// =====================================================================
// KNOWLEDGE ACTIONS: every change a person makes goes through Change
// control as a typed action, then the affected page sections rebuild.
// =====================================================================

// EDIT: revise, retire, link, set status or add a claim (ActionDialog, inline page edits)
export async function submitEdit(action: PersonAction): Promise<ActionResult<CommitResult>> {
  return toActionResult(async () => {
    await requireUser();
    const { db, writer, claimEmbedder } = await getServerDeps();
    const { eventId, ...result } = await commitPersonAction(db, action);
    refreshEmbeddings(claimEmbedder);
    await rebuildAfterEvent(db, writer, eventId);
    return result;
  });
}

// LINE EDIT: new words for one wiki line (and the one claim it states), then other lines citing it rewrite
export async function submitLineEdit(lineId: string, content: string): Promise<ActionResult<CommitResult>> {
  return toActionResult(async () => {
    await requireUser();
    const { db, writer, claimEmbedder } = await getServerDeps();
    const { eventId, ...result } = await commitLineEdit(db, lineId, content);
    refreshEmbeddings(claimEmbedder);
    await rebuildAfterEvent(db, writer, eventId);
    return result;
  });
}

// UNDO: reverts one applied ChangeSet (Changes screen)
export async function undoChangeSet(changeSetId: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const { db, writer, claimEmbedder } = await getServerDeps();
    const { eventId } = await revertChangeSet(db, changeSetId);
    refreshEmbeddings(claimEmbedder);
    await rebuildAfterEvent(db, writer, eventId);
    return {};
  });
}

// ANSWER AN EXCEPTION: accept applies the held action, reject drops it (Exceptions screen)
export async function answerException(exceptionId: string, accept: boolean, note: string | null): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const actor = await currentActor();
    const deps = await getServerDeps();
    const { db, writer } = deps;
    const { data: exception, error } = await getAdminSupabase().from("exceptions").select("reason, action_id").eq("id", exceptionId).single();
    if (error) throw new Error(error.message);
    const { eventId, queued } = await resolveException(db, { exceptionId, accept, note });
    if (exception.reason === "root_domain_approval") {
      after(() => withSpaceActor(actor, async () => {
        await applyRootApprovalBatches(db, (id) => finishApprovedUpload(deps, id));
        if (eventId && !queued) await finishApprovedUpload(deps, eventId);
      }).catch((error) => console.error("Applying approved root domains failed:", error)));
      return {};
    }
    // An accepted Curator merge adds one section to the page that stays; write its lines now
    if (accept && exception.reason === "page_structure_review") {
      const { data: action, error: actionError } = await getAdminSupabase().from("actions").select("undo_state").eq("id", exception.action_id).single();
      if (actionError) throw new Error(actionError.message);
      const sectionId = (action.undo_state as { sectionId?: string | null } | null)?.sectionId;
      // Then the page tree changed: organization pages that now repeat their children become overviews
      after(async () => {
        try {
          if (sectionId) await rebuildSection(db, writer, sectionId, null, false);
          await deps.pageMaintainer?.(null, { curate: false });
        } catch (error) { console.error("Upkeep after a Curator change failed", error); }
      });
      return {};
    }
    if (eventId) refreshEmbeddings(deps.claimEmbedder);
    // The answer is saved; page rewrites are AI calls, so they run after the response.
    // A failed rewrite puts its section back to stale rather than leaving it building.
    if (eventId) after(() => (exception.reason === "root_domain_approval"
      ? finishApprovedUpload(deps, eventId)
      : rebuildAfterEvent(db, writer, eventId)).catch((error) => console.error("rebuild after exception answer failed", error)));
    return {};
  });
}
