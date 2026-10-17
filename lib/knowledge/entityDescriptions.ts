import "server-only";
import { assertActiveUpload, uploadExecution, workflowStep } from "@/lib/ingest/workflowContext";

import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import {
  buildDescribeMessages,
  describeAnswerJsonSchema,
  describeAnswerSchema,
  describeAnswerToRows,
  type EntityEvidence,
} from "@/lib/ai/tokenFactory/describeEntities";
import { supabaseRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { fetchDescribableEntityIds } from "./describableEntities";
import { mapConcurrent } from "@/lib/processing/concurrency";

// =====================================================================
// ENTITY DESCRIPTIONS (server side): after an upload, the entities it
// created get a description; /graph and /entities backfill the ones still without.
// A description is derived text (like an article), not knowledge, so it
// is written straight to entities.description, not through Change control.
// =====================================================================

// ENTITIES PER MODEL CALL
export const DESCRIBE_BATCH_SIZE = 10;
// EVIDENCE PER ENTITY: enough to say what it is, small enough for one call per batch
const CLAIMS_PER_ENTITY = 12;
const PASSAGES_PER_ENTITY = 4;
const PASSAGE_CHARS = 600;

type Deps = { client: AdminSupabase; settings: TokenFactorySettings };

// skipped: no live unit mentions it, or the model found nothing to say
export type DescribeBatchResult = { described: number; skipped: number };

// PLAN: live entities without a description that some live unit mentions, in batches
export async function planDescribeBatches(client: AdminSupabase): Promise<string[][]> {
  const ids = await fetchDescribableEntityIds(client);
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += DESCRIBE_BATCH_SIZE) batches.push(ids.slice(index, index + DESCRIBE_BATCH_SIZE));
  return batches;
}

// AFTER AN UPLOAD: describe the entities it created, and again those whose claims it changed
// (a description written from the first file would otherwise never learn from the next)
export async function describeEventEntities(deps: Deps, eventId: string): Promise<void> {
  const ids = [...await supabaseRpc(deps.client).call<string[]>("event_touched_entities", { p_event_id: eventId })];
  ids.sort();
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += DESCRIBE_BATCH_SIZE) batches.push(ids.slice(index, index + DESCRIBE_BATCH_SIZE));
  // Each batch owns different entities. Drain active calls before returning so
  // the upload keeps its lease and cards cannot read half-finished descriptions.
  await mapConcurrent(batches, 3, async (batch) => {
    await assertActiveUpload();
    await workflowStep(`describe:${batch.join(":")}`, () => describeEntityBatch(deps, batch));
  }, uploadExecution.getStore()?.signal);
}

// ONE BATCH: load the evidence, ask the model, write what it answered
export async function describeEntityBatch(deps: Deps, entityIds: string[]): Promise<DescribeBatchResult> {
  const evidence = (await loadEvidence(deps.client, entityIds)).filter((entity) => entity.claims.length > 0);
  if (!evidence.length) return { described: 0, skipped: entityIds.length };
  const answer = await chatJson(deps.settings, {
    name: "describe_entities",
    schema: describeAnswerSchema,
    jsonSchema: describeAnswerJsonSchema,
    messages: buildDescribeMessages(evidence),
  });
  const rows = describeAnswerToRows(answer.value, evidence);
  const now = new Date().toISOString();
  for (const row of rows) {
    uploadExecution.getStore()?.signal?.throwIfAborted();
    await assertActiveUpload();
    const { error } = await deps.client.from("entities").update({ description: row.description, description_updated_at: now, description_model: answer.model }).eq("id", row.entityId);
    if (error) throw error;
  }
  return { described: rows.length, skipped: entityIds.length - rows.length };
}

// EVIDENCE: each entity's live claims (current wording) and a few passages those claims cite
async function loadEvidence(client: AdminSupabase, entityIds: string[]): Promise<EntityEvidence[]> {
  const [entities, links] = await Promise.all([
    client.from("entities").select("id, type, name, aliases").in("id", entityIds),
    client.from("unit_entities").select("unit_id, entity_id").in("entity_id", entityIds),
  ]);
  if (entities.error) throw entities.error;
  if (links.error) throw links.error;
  const unitIds = [...new Set(links.data.map((link) => link.unit_id))];
  const units = unitIds.length ? await client.from("units").select("id, current_revision_id").in("id", unitIds).is("retired_at", null) : { data: [], error: null };
  if (units.error) throw units.error;
  const revisions = units.data.length ? await client.from("revisions").select("id, content, passage_ids").in("id", units.data.map((unit) => unit.current_revision_id)) : { data: [], error: null };
  if (revisions.error) throw revisions.error;
  const revisionById = new Map(revisions.data.map((revision) => [revision.id, revision]));
  const revisionByUnit = new Map(units.data.flatMap((unit) => {
    const revision = revisionById.get(unit.current_revision_id);
    return revision ? [[unit.id, revision] as const] : [];
  }));

  // Claims per entity first, so only the passages that will be shown are read
  const perEntity = new Map<string, { claims: string[]; passageIds: string[] }>();
  for (const link of links.data) {
    const revision = revisionByUnit.get(link.unit_id);
    if (!revision?.content.trim()) continue;
    const slot = perEntity.get(link.entity_id) ?? { claims: [], passageIds: [] };
    if (slot.claims.length < CLAIMS_PER_ENTITY) slot.claims.push(revision.content);
    for (const id of revision.passage_ids) if (slot.passageIds.length < PASSAGES_PER_ENTITY && !slot.passageIds.includes(id)) slot.passageIds.push(id);
    perEntity.set(link.entity_id, slot);
  }
  const passageIds = [...new Set([...perEntity.values()].flatMap((slot) => slot.passageIds))];
  const passages = passageIds.length ? await client.from("passages").select("id, text").in("id", passageIds) : { data: [], error: null };
  if (passages.error) throw passages.error;
  const textById = new Map(passages.data.map((passage) => [passage.id, passage.text.slice(0, PASSAGE_CHARS)]));

  return entities.data.map((entity) => {
    const slot = perEntity.get(entity.id) ?? { claims: [], passageIds: [] };
    return {
      entityId: entity.id,
      type: entity.type,
      name: entity.name,
      aliases: entity.aliases,
      claims: slot.claims,
      passages: slot.passageIds.flatMap((id) => textById.get(id) ?? []),
    };
  });
}
