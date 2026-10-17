"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { replaceSourceWithFile } from "@/lib/ingest";
import {
  archiveSource,
  type ArchiveSourceResult,
  deleteSource,
  type DeleteSourceResult,
  purgeSource,
  type PurgeSourceResult,
  readSourceImpact,
  restoreSource,
  type SourceImpact,
} from "@/lib/ingest/sourceLifecycle";
import type { StartUploadResult } from "@/lib/ingest/types";
import { type ActionResult, toActionResult } from "./result";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerDeps } from "@/lib/server/deps";
import { rebuildAfterEvent } from "@/lib/living-page";
import { z } from "zod";

// Apply the already committed evidence through the article proposer and reviewer.
// Keep the source's origin and approval intact; never extract its text again here.
export async function applySourceKnowledge(sourceId: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    z.uuid().parse(sourceId);
    const client = getAdminSupabase();
    const { data: source, error } = await client.from("sources").select("id,archived_at").eq("id", sourceId).single();
    if (error) throw new Error(error.message);
    if (source.archived_at) throw new Error("Restore this source before applying its knowledge.");
    const { data: events, error: eventError } = await client.from("shift_events").select("id").eq("source_id", sourceId).eq("cause", "upload").order("created_at");
    if (eventError) throw new Error(eventError.message);
    if (!events.length) throw new Error("Generate knowledge from this source first.");
    const deps = await getServerDeps();
    if (!deps.articleOrchestrator) throw new Error("Configure an AI provider in Settings before applying knowledge.");
    let found = false;
    for (const event of events) {
      const ids = await deps.db.call<string[]>("living_page_event_units", { p_event_id: event.id });
      if (!ids.length) continue;
      found = true;
      const articles = await deps.articleOrchestrator(event.id);
      await rebuildAfterEvent(deps.db, deps.writer, event.id);
      // New sections alone leave an existing company introduction frozen on its
      // old evidence. Re-plan affected organization overviews from current claims.
      if (articles.pageIds.length && deps.refreshAppliedOverviews) {
        const overviews = await deps.refreshAppliedOverviews(event.id, articles.pageIds);
        const failed = overviews.find((overview) => overview.status === "failed");
        if (failed) throw new Error(`Article sections were saved, but the overview update failed: ${failed.detail ?? failed.title}`);
      }
    }
    if (!found) throw new Error("This source has no saved knowledge to apply. Generate knowledge first.");
    return {};
  });
}

// =====================================================================
// SOURCE ACTIONS (the source "…" menu). Re-run lives with the upload
// actions (startRerun + processUpload). Replace is step 1 of an upload;
// processUpload runs its event next, like a re-run.
// =====================================================================

// IMPACT: what archive, delete or purge would touch (confirm dialogs)
export async function sourceImpact(sourceId: string): Promise<ActionResult<SourceImpact>> {
  return toActionResult(async () => {
    await requireUser();
    return readSourceImpact(sourceId);
  });
}

// REPLACE: form fields `sourceId`, `file` and `sourceDate`; the old file is archived
export async function replaceSource(formData: FormData): Promise<ActionResult<Extract<StartUploadResult, { kind: "started" }>>> {
  return toActionResult(async () => {
    await requireUser();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("No file was sent.");
    return replaceSourceWithFile({ sourceId: String(formData.get("sourceId") ?? ""), file, sourceDate: String(formData.get("sourceDate") ?? "") });
  });
}

// ARCHIVE: the file stays; knowledge citing it reads as stale
export async function archiveSourceAction(sourceId: string, reason: string): Promise<ActionResult<ArchiveSourceResult>> {
  return toActionResult(async () => {
    await requireUser();
    return archiveSource(sourceId, undefined, reason);
  });
}

// RESTORE: an archived file is active evidence again
export async function restoreSourceAction(sourceId: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    return restoreSource(sourceId);
  });
}

// DELETE: the file and its passages go; knowledge citing it stays, marked lost
export async function removeSource(sourceId: string): Promise<ActionResult<DeleteSourceResult>> {
  return toActionResult(async () => {
    await requireUser();
    return deleteSource(sourceId);
  });
}

// PURGE: knowledge only this file supports is retired, shared knowledge drops it, then it is deleted
export async function purgeSourceAction(sourceId: string): Promise<ActionResult<PurgeSourceResult>> {
  return toActionResult(async () => {
    await requireUser();
    return purgeSource(sourceId);
  });
}
