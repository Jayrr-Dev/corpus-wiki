import "server-only";

import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import {
  buildDedupeMessages,
  DEDUPE_PROMPT_VERSION,
  dedupeAnswerJsonSchema,
  dedupeAnswerSchema,
  dedupeAnswerToActions,
  type DedupeUnit,
  findDuplicateClusters,
} from "@/lib/ai/tokenFactory/dedupePass";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";

// =====================================================================
// CLEANING CYCLE: finds duplicate claims and proposes merging them, one
// AI ChangeSet per candidate cluster. Runs from the "Clean duplicates"
// button (every cluster) and after each upload (only clusters holding a
// unit the upload touched). AI merges wait for a person on Exceptions.
// =====================================================================

type Deps = { db: DbRpc; client: AdminSupabase; settings: TokenFactorySettings };

export type DedupeBatchResult = { changeSetId: string | null; proposed: number; applied: number; exceptions: number; removed: number };

// Every live unit with its current wording and the passages behind it
async function loadUnits(client: AdminSupabase): Promise<DedupeUnit[]> {
  // Read past PostgREST's row cap so cleanup covers the whole store.
  const units: { data: { id: string; kind: DedupeUnit["kind"]; epistemic_status: DedupeUnit["epistemicStatus"]; current_revision_id: string; created_at: string }[] } = { data: [] };
  for (let start = 0; ; start += 1000) {
    const page = await client.from("units").select("id, kind, epistemic_status, current_revision_id, created_at")
      .is("retired_at", null).order("created_at").order("id").range(start, start + 999);
    if (page.error) throw page.error;
    units.data.push(...page.data);
    if (page.data.length < 1000) break;
  }
  const revisionIds = units.data.map((unit) => unit.current_revision_id);
  const revisions = new Map<string, { content: string; passage_ids: string[] }>();
  // Revisions are read in chunks so the id list stays within URL limits
  for (let start = 0; start < revisionIds.length; start += 200) {
    const chunk = await client.from("revisions").select("id, content, passage_ids").in("id", revisionIds.slice(start, start + 200));
    if (chunk.error) throw chunk.error;
    for (const revision of chunk.data) revisions.set(revision.id, revision);
  }
  return units.data.flatMap((unit) => {
    const revision = revisions.get(unit.current_revision_id);
    if (!revision?.content.trim()) return [];
    return [{
      unitId: unit.id,
      revisionId: unit.current_revision_id,
      content: revision.content,
      kind: unit.kind,
      epistemicStatus: unit.epistemic_status,
      passageIds: revision.passage_ids ?? [],
      createdAt: unit.created_at,
    }];
  });
}

// PLAN: candidate clusters of unit ids, in the order the screen runs them
export async function planDedupeClusters(client: AdminSupabase, focusIds?: ReadonlySet<string>): Promise<string[][]> {
  return findDuplicateClusters(await loadUnits(client), focusIds).map((cluster) => cluster.map((unit) => unit.unitId));
}

// Explicit cleanup applies as a person-requested edit. Background ingestion still proposes AI merges for review.
export async function dedupeCluster(deps: Deps, unitIds: string[], mode: "review" | "apply" = "review"): Promise<DedupeBatchResult> {
  const wanted = new Set(unitIds);
  const units = (await loadUnits(deps.client)).filter((unit) => wanted.has(unit.unitId));
  const empty = { changeSetId: null, proposed: 0, applied: 0, exceptions: 0, removed: 0 };
  if (units.length < 2) return empty;
  const answer = await chatJson(deps.settings, {
    name: "dedupe",
    schema: dedupeAnswerSchema,
    jsonSchema: dedupeAnswerJsonSchema,
    messages: buildDedupeMessages(units),
  });
  const actions = dedupeAnswerToActions(answer.value, units);
  const merges = actions.filter((action) => action.type === "merge_duplicates").length;
  if (merges === 0) return empty;
  const { changeSetId } = await submitChangeSet(deps.db, { eventId: null, cause: "edit", actor: mode === "apply" ? "person" : "ai" }, {
    summary: `Cleaning cycle: ${merges} duplicate group${merges === 1 ? "" : "s"} to merge`,
    actions,
    trace: { modelVersion: answer.model, promptVersion: DEDUPE_PROMPT_VERSION, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut },
  });
  const result = await commitChangeSet(deps.db, changeSetId);
  if (mode === "apply" && result.status !== "applied") {
    throw new Error("Cleanup could not apply every change. Refresh and try again.");
  }
  const removed = result.status === "applied"
    ? actions.reduce((count, action) => count + (action.type === "merge_duplicates" ? action.input.duplicateUnitIds.length : 0), 0)
    : 0;
  return { changeSetId, proposed: merges, applied: result.applied, exceptions: result.exceptions, removed };
}

// Units an upload's applied actions touched (its new and changed claims)
async function eventUnitIds(client: AdminSupabase, eventId: string): Promise<Set<string>> {
  const sets = await client.from("change_sets").select("id").eq("event_id", eventId);
  if (sets.error) throw sets.error;
  if (!sets.data.length) return new Set();
  const actions = await client
    .from("actions")
    .select("target_id")
    .in("change_set_id", sets.data.map((set) => set.id))
    .in("type", ["add_claim", "revise_claim"])
    .eq("outcome", "applied");
  if (actions.error) throw actions.error;
  return new Set(actions.data.flatMap((action) => (action.target_id ? [action.target_id] : [])));
}

// AFTER AN UPLOAD: only the clusters that hold a unit this upload added or changed
export async function dedupeAfterEvent(deps: Deps, eventId: string): Promise<void> {
  const touched = await eventUnitIds(deps.client, eventId);
  if (!touched.size) return;
  for (const cluster of await planDedupeClusters(deps.client, touched)) await dedupeCluster(deps, cluster);
}


