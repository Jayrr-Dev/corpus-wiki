import "server-only";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import type { Json } from "@/lib/database/types";

import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import type { Embedder } from "@/lib/ai/embeddings";
import {
  buildDedupeMessages,
  DEDUPE_PROMPT_VERSION,
  dedupeAnswerJsonSchema,
  dedupeAnswerSchema,
  dedupeAnswerToActions,
  type DedupeUnit,
  findDuplicateClusters,
  type UnitVectors,
} from "@/lib/ai/tokenFactory/dedupePass";
import { commitAsRole, commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { embedMissingUnits, savedVectors } from "@/lib/knowledge/embeddingStore";
import type { AdminSupabase } from "@/lib/supabase/admin";

// =====================================================================
// CLEANING CYCLE: finds duplicate claims and proposes merging them, one
// AI ChangeSet per candidate cluster. Runs from the "Clean duplicates"
// button (every cluster) and after each upload (only clusters holding a
// unit the upload touched). AI merges wait for a person on Exceptions,
// unless the model is sure and the claims are near-identical (autoMerge).
// =====================================================================

// embedder: compares by meaning when set (and embeds claims that have no vector yet)
type Deps = { db: DbRpc; client: AdminSupabase; settings: TokenFactorySettings; embedder?: Embedder | null };

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
  const revisions = new Map<string, { content: string; passage_ids: string[]; knowledge_context: Json }>();
  // Revisions are read in chunks so the id list stays within URL limits
  for (let start = 0; start < revisionIds.length; start += 200) {
    const chunk = await client.from("revisions").select("id, content, passage_ids, knowledge_context").in("id", revisionIds.slice(start, start + 200));
    if (chunk.error) throw chunk.error;
    for (const revision of chunk.data) revisions.set(revision.id, revision);
  }
  const partOf = await loadMemberships(client);
  return units.data.flatMap((unit) => {
    const revision = revisions.get(unit.current_revision_id);
    if (!revision?.content.trim()) return [];
    return [{
      unitId: unit.id,
      revisionId: unit.current_revision_id,
      content: revision.content,
      context: parseKnowledgeContext(revision.knowledge_context) ?? undefined,
      kind: unit.kind,
      epistemicStatus: unit.epistemic_status,
      passageIds: revision.passage_ids ?? [],
      createdAt: unit.created_at,
      partOf: partOf.get(unit.id) ?? [],
    }];
  });
}

// Each member's composites (live part_of links), marked when the composite is a sequence
async function loadMemberships(client: AdminSupabase): Promise<Map<string, { compositeId: string; sequence: boolean }[]>> {
  const links: { from_unit_id: string; to_unit_id: string }[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await client.from("relationships").select("from_unit_id, to_unit_id")
      .eq("type", "part_of").is("retired_at", null).order("id").range(start, start + 999);
    if (page.error) throw page.error;
    links.push(...page.data);
    if (page.data.length < 1000) break;
  }
  const composites = [...new Set(links.map((link) => link.to_unit_id))];
  const sequences = new Set<string>();
  for (let start = 0; start < composites.length; start += 200) {
    const units = await client.from("units").select("id, current_revision_id").in("id", composites.slice(start, start + 200));
    if (units.error) throw units.error;
    const shapes = await client.from("revisions").select("id, structure").in("id", units.data.map((unit) => unit.current_revision_id));
    if (shapes.error) throw shapes.error;
    const sequenceRevisions = new Set(shapes.data.filter((row) => (row.structure as { type?: string } | null)?.type === "sequence").map((row) => row.id));
    for (const unit of units.data) if (sequenceRevisions.has(unit.current_revision_id)) sequences.add(unit.id);
  }
  const byMember = new Map<string, { compositeId: string; sequence: boolean }[]>();
  for (const link of links) {
    byMember.set(link.from_unit_id, [...(byMember.get(link.from_unit_id) ?? []), { compositeId: link.to_unit_id, sequence: sequences.has(link.to_unit_id) }]);
  }
  return byMember;
}

// Saved vectors of these units' current wording, embedding any that are missing first.
// Without an embedder (or when embedding fails) units are compared by words.
async function loadVectors(deps: Pick<Deps, "db" | "embedder">, units: readonly DedupeUnit[]): Promise<UnitVectors | undefined> {
  if (!deps.embedder) return undefined;
  try {
    await embedMissingUnits(deps.db, deps.embedder);
    return await savedVectors(deps.db, deps.embedder.model, units.map((unit) => unit.revisionId));
  } catch (error) {
    console.error("Claims could not be compared by meaning; comparing words only:", error);
    return undefined;
  }
}

// PLAN: candidate clusters of unit ids, in the order the screen runs them
export async function planDedupeClusters(client: AdminSupabase, focusIds?: ReadonlySet<string>, deps?: Pick<Deps, "db" | "embedder">): Promise<string[][]> {
  const units = await loadUnits(client);
  const vectors = deps ? await loadVectors(deps, units) : undefined;
  return findDuplicateClusters(units, focusIds, vectors).map((cluster) => cluster.map((unit) => unit.unitId));
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
  const actions = dedupeAnswerToActions(answer.value, units, await loadVectors(deps, units));
  const merges = actions.filter((action) => action.type === "merge_duplicates").length;
  if (merges === 0) return empty;
  const { changeSetId } = await submitChangeSet(deps.db, { eventId: null, cause: "edit", actor: mode === "apply" ? "person" : "ai", operationKey: `dedupe:${[...unitIds].sort().join(":")}` }, {
    summary: `Cleaning cycle: ${merges} duplicate group${merges === 1 ? "" : "s"} to merge`,
    actions,
    trace: { modelVersion: answer.model, promptVersion: DEDUPE_PROMPT_VERSION, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut },
  });
  const result = mode === "apply" ? await commitChangeSet(deps.db, changeSetId) : await commitAsRole(deps.db, "deduplicator", changeSetId);
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
  for (const cluster of await planDedupeClusters(deps.client, touched, deps)) await dedupeCluster(deps, cluster);
}


