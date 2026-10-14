import "server-only";

import type { DraftAction } from "@/lib/ai/types";
import { commitPersonEdit } from "@/lib/change-control";
import { rebuildAfterEvent } from "@/lib/living-page";
import { getServerDeps } from "@/lib/server/deps";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { removeSourceFile } from "./storage";
import { unitsOnlyFrom, type CitedUnit } from "./unitsOnlyFrom";

// =====================================================================
// DELETE A SOURCE: the file is evidence, so deleting it must not leave
// knowledge standing on nothing. In order:
//   1. units whose ONLY evidence is this file are retired, as one
//      ChangeSet through Change control (undo it from Changes)
//   2. the source row goes; its passages go with it (on delete cascade)
//      and its upload events keep their history with no source
//   3. the stored file is removed from the private bucket
// =====================================================================

export type DeleteSourceResult = { retiredUnits: number };

// DELETE: retires what only this file supports, then removes the record and the file
export async function deleteSource(sourceId: string): Promise<DeleteSourceResult> {
  const admin = getAdminSupabase();
  const { data: source, error } = await admin.from("sources").select("title, storage_path").eq("id", sourceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!source) throw new Error("That source no longer exists.");
  const retiredUnits = await retireUnitsOnlyFrom(sourceId, source.title);
  const { error: deleteError } = await admin.from("sources").delete().eq("id", sourceId);
  if (deleteError) throw new Error(`Could not delete the source: ${deleteError.message}`);
  await removeSourceFile(source.storage_path);
  return { retiredUnits };
}

// STEP 1: one retire_claim per unit left without evidence; pages rebuild after
async function retireUnitsOnlyFrom(sourceId: string, title: string): Promise<number> {
  const units = unitsOnlyFrom(await readPassageIds(sourceId), await readCurrentUnits());
  if (units.length === 0) return 0;
  const reason = `Its only source, "${title}", was deleted.`;
  // expectedRevisionId: a unit edited meanwhile makes the whole set fail, so nothing is deleted
  const actions: DraftAction[] = units.map((unit) => ({
    type: "retire_claim",
    targetId: unit.id,
    expectedRevisionId: unit.revisionId,
    input: { reason, validTo: null },
    passageIds: [],
    speechAct: null,
  }));
  const { db, writer } = await getServerDeps();
  const result = await commitPersonEdit(db, `Retired ${units.length} unit(s) from deleted file ${title}`, actions);
  if (result.status !== "applied") throw new Error("Could not retire the knowledge that came only from this file, so nothing was deleted.");
  await rebuildAfterEvent(db, writer, result.eventId);
  return units.length;
}

// The ids of the file's passages
async function readPassageIds(sourceId: string): Promise<Set<string>> {
  const { data, error } = await getAdminSupabase().from("passages").select("id").eq("source_id", sourceId);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((passage) => passage.id));
}

// Current units with the evidence of their current revision
async function readCurrentUnits(): Promise<CitedUnit[]> {
  const admin = getAdminSupabase();
  const { data: units, error } = await admin.from("units").select("id, current_revision_id").is("retired_at", null);
  if (error) throw new Error(error.message);
  const revisionIds = (units ?? []).map((unit) => unit.current_revision_id);
  if (revisionIds.length === 0) return [];
  const { data: revisions, error: revisionError } = await admin.from("revisions").select("id, passage_ids").in("id", revisionIds);
  if (revisionError) throw new Error(revisionError.message);
  const evidenceByRevision = new Map((revisions ?? []).map((revision) => [revision.id, revision.passage_ids]));
  return (units ?? []).map((unit) => ({ id: unit.id, revisionId: unit.current_revision_id, passageIds: evidenceByRevision.get(unit.current_revision_id) ?? [] }));
}
