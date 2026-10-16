import "server-only";

import type { DraftAction } from "@/lib/ai/types";
import { commitPersonEdit } from "@/lib/change-control";
import type { Tables } from "@/lib/database/types";
import { rebuildAfterEvent } from "@/lib/living-page";
import { getServerDeps } from "@/lib/server/deps";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { removeSourceFile } from "./storage";
import { type CitedUnit, type SharedUnit, unitsOnlyFrom, unitsPartlyFrom } from "./unitsOnlyFrom";

// =====================================================================
// SOURCE LIFECYCLE: a file is evidence, so removing it always says what
// happens to the knowledge that cites it. What a unit's evidence looks
// like afterwards is declared by the unit_evidence view, never stored.
//   archive  the file stays, knowledge citing it reads as STALE
//   restore  an archived file is active again
//   replace  a newer file is uploaded; the old one is archived and points
//            at it (see replaceSourceWithFile in ./index)
//   delete   the file and its passages go, knowledge citing it is LOST
//   purge    knowledge only this file supports is retired, knowledge it
//            shares with other files drops its citations (one ChangeSet,
//            undo from Changes), then the file goes
// =====================================================================

type Source = Pick<Tables<"sources">, "id" | "title" | "storage_path" | "archived_at">;

export type SourceImpact = { linkedUnits: number; onlyFromUnits: number; sharedUnits: number };
export type ArchiveSourceResult = { staleUnits: number };
export type DeleteSourceResult = { lostUnits: number };
export type PurgeSourceResult = { retiredUnits: number; updatedUnits: number };

// IMPACT: how many current units cite the file, only it, or it and other files
export async function readSourceImpact(sourceId: string): Promise<SourceImpact> {
  await requireSource(sourceId);
  const { only, shared } = await splitUnits(sourceId);
  return { linkedUnits: only.length + shared.length, onlyFromUnits: only.length, sharedUnits: shared.length };
}

// ARCHIVE: the file stays readable; every unit citing it is stale until re-sourced
export async function archiveSource(sourceId: string, reviewId?: string, reason?: string): Promise<ArchiveSourceResult> {
  const source = await requireSource(sourceId);
  if (!reviewId && !reason?.trim()) throw new Error("An archive justification is required.");
  if (source.archived_at) throw new Error("This source is already archived.");
  const { db } = await getServerDeps();
  await db.call("set_source_archive", { p_source_id: sourceId, p_archive: true, p_review_id: reviewId ?? null, p_reason: reason?.trim() ?? null });
  return { staleUnits: (await readSourceImpact(sourceId)).linkedUnits };
}

// RESTORE: an archived (or replaced) file counts as active evidence again
export async function restoreSource(sourceId: string, reviewId?: string): Promise<object> {
  const source = await requireSource(sourceId);
  if (!source.archived_at) throw new Error("This source is not archived.");
  await setArchive(sourceId, false, reviewId);
  return {};
}

// REPLACED: the old file is archived and points at the version that replaced it
export async function markSourceReplaced(oldSourceId: string, newSourceId: string): Promise<void> {
  if (oldSourceId === newSourceId) throw new Error("That is the same file that is already stored.");
  const source = await requireSource(oldSourceId);
  await updateSource(oldSourceId, { archived_at: source.archived_at ?? new Date().toISOString(), replaced_by_id: newSourceId, archive_reason: `Replaced by source ${newSourceId}.` });
}

// DELETE: the record, its passages and the stored file go; knowledge citing it stays, marked lost
export async function deleteSource(sourceId: string): Promise<DeleteSourceResult> {
  const source = await requireSource(sourceId);
  const lostUnits = (await readSourceImpact(sourceId)).linkedUnits;
  await removeSourceAndFile(source);
  return { lostUnits };
}

// PURGE: retires what only this file supports, strips it from shared knowledge, then deletes it
export async function purgeSource(sourceId: string): Promise<PurgeSourceResult> {
  const source = await requireSource(sourceId);
  const { only, shared, filePassages } = await splitUnits(sourceId);
  if (only.length + shared.length > 0) await commitPurge(source.title, only, unitsPartlyFrom(filePassages, shared));
  await removeSourceAndFile(source);
  return { retiredUnits: only.length, updatedUnits: shared.length };
}

// PURGE STEP 1: retire_claim per unit left without evidence, revise_claim per shared unit
// (same content, fewer citations); pages rebuild after
async function commitPurge(title: string, only: CitedUnit[], shared: SharedUnit<ContentUnit>[]): Promise<void> {
  const reason = `Its only source, "${title}", was purged.`;
  // expectedRevisionId: a unit edited meanwhile makes the whole set fail, so nothing is deleted
  const actions: DraftAction[] = [
    ...only.map((unit): DraftAction => ({
      type: "retire_claim",
      targetId: unit.id,
      expectedRevisionId: unit.revisionId,
      input: { reason, validTo: null },
      passageIds: [],
      speechAct: null,
    })),
    ...shared.map((unit): DraftAction => ({
      type: "revise_claim",
      targetId: unit.id,
      expectedRevisionId: unit.revisionId,
      input: { content: unit.content },
      passageIds: unit.remainingPassageIds,
      speechAct: null,
    })),
  ];
  const { db, writer } = await getServerDeps();
  const summary = `Purged file ${title}: retired ${only.length}, updated ${shared.length} unit(s)`;
  const result = await commitPersonEdit(db, summary, actions);
  if (result.status !== "applied") throw new Error("Could not update the knowledge that cites this file, so nothing was purged.");
  await rebuildAfterEvent(db, writer, result.eventId);
}

// =====================================================================
// READS AND WRITES
// =====================================================================

// The source row, or a clear error when it is gone
async function requireSource(sourceId: string): Promise<Source> {
  const { data, error } = await getAdminSupabase().from("sources").select("id, title, storage_path, archived_at").eq("id", sourceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That source no longer exists.");
  return data;
}

async function updateSource(sourceId: string, patch: { archive_reason?: string | null; archived_at?: string | null; replaced_by_id?: string | null }): Promise<void> {
  const { error } = await getAdminSupabase().from("sources").update(patch).eq("id", sourceId);
  if (error) throw new Error(`Could not update the source: ${error.message}`);
}

async function setArchive(sourceId: string, archive: boolean, reviewId?: string): Promise<void> {
  const { db } = await getServerDeps();
  await db.call("set_source_archive", { p_source_id: sourceId, p_archive: archive, p_review_id: reviewId ?? null });
}

// The row goes (passages cascade, upload events keep their history with no source), then the stored file
async function removeSourceAndFile(source: Source): Promise<void> {
  const { error } = await getAdminSupabase().from("sources").delete().eq("id", source.id);
  if (error) throw new Error(`Could not delete the source: ${error.message}`);
  await removeSourceFile(source.storage_path);
}

type ContentUnit = CitedUnit & { content: string };

// Current units citing the file, split into those only it supports and those it shares
async function splitUnits(sourceId: string): Promise<{ only: ContentUnit[]; shared: ContentUnit[]; filePassages: Set<string> }> {
  const filePassages = await readPassageIds(sourceId);
  const units = await readCitingUnits(sourceId);
  const onlyIds = new Set(unitsOnlyFrom(filePassages, units).map((unit) => unit.id));
  return { only: units.filter((unit) => onlyIds.has(unit.id)), shared: units.filter((unit) => !onlyIds.has(unit.id)), filePassages };
}

// The ids of the file's passages
async function readPassageIds(sourceId: string): Promise<Set<string>> {
  const { data, error } = await getAdminSupabase().from("passages").select("id").eq("source_id", sourceId);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((passage) => passage.id));
}

// Current (not retired) units whose current revision cites the file, with that revision's evidence
async function readCitingUnits(sourceId: string): Promise<ContentUnit[]> {
  const admin = getAdminSupabase();
  const { data: links, error: linkError } = await admin.from("source_units").select("unit_id").eq("source_id", sourceId);
  if (linkError) throw new Error(linkError.message);
  const unitIds = (links ?? []).flatMap((link) => (link.unit_id ? [link.unit_id] : []));
  if (unitIds.length === 0) return [];
  const { data: units, error } = await admin.from("units").select("id, current_revision_id").in("id", unitIds).is("retired_at", null);
  if (error) throw new Error(error.message);
  const revisionIds = (units ?? []).map((unit) => unit.current_revision_id);
  if (revisionIds.length === 0) return [];
  const { data: revisions, error: revisionError } = await admin.from("revisions").select("id, passage_ids, content").in("id", revisionIds);
  if (revisionError) throw new Error(revisionError.message);
  const revisionById = new Map((revisions ?? []).map((revision) => [revision.id, revision]));
  return (units ?? []).map((unit) => {
    const revision = revisionById.get(unit.current_revision_id);
    return { id: unit.id, revisionId: unit.current_revision_id, passageIds: revision?.passage_ids ?? [], content: revision?.content ?? "" };
  });
}
