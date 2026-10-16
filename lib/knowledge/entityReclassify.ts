import "server-only";

import { addUsage, chatJson, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import type { DraftAction } from "@/lib/ai/types";
import {
  buildReclassifyMessages,
  RECLASSIFY_BATCH_SIZE,
  RECLASSIFY_PROMPT_VERSION,
  type ReclassifyEntity,
  reclassifyAnswerJsonSchema,
  reclassifyAnswerSchema,
  readRetypes,
} from "@/lib/ai/tokenFactory/entityReclassify";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";

// =====================================================================
// ENTITY RECLASSIFY AS THE APP RUNS IT (scripts/reclassify-entities.ts):
// every live "concept" entity, with its claims, goes to the model in
// batches; the types it names become one AI ChangeSet of retype_entity
// actions. Change control applies them without a person; each is
// undoable from Changes.
// =====================================================================

export type Retype = { entityId: string; name: string; from: string; to: string; reason: string };
export type ReclassifyResult = { checked: number; retypes: Retype[]; applied: number; rejected: number };

type Deps = { db: DbRpc; client: AdminSupabase; settings: TokenFactorySettings };

// Live "concept" entities with up to six of their live claims each, and every live (type, key)
async function loadConcepts(client: AdminSupabase): Promise<{ entities: ReclassifyEntity[]; taken: Set<string> }> {
  const live = await client.from("entities").select("id, type, key, name, aliases, description").is("merged_into_id", null).is("retired_at", null);
  if (live.error) throw new Error(live.error.message);
  const concepts = (live.data ?? []).filter((entity) => entity.type === "concept");
  const taken = new Set((live.data ?? []).map((entity) => `${entity.type}:${entity.key}`));
  if (!concepts.length) return { entities: [], taken };

  const links = await client.from("unit_entities").select("unit_id, entity_id").in("entity_id", concepts.map((entity) => entity.id));
  if (links.error) throw new Error(links.error.message);
  const unitIds = [...new Set((links.data ?? []).map((link) => link.unit_id))];
  const units = unitIds.length ? await client.from("units").select("id, current_revision_id").in("id", unitIds).is("retired_at", null) : { data: [], error: null };
  if (units.error) throw new Error(units.error.message);
  const revisionIds = (units.data ?? []).map((unit) => unit.current_revision_id);
  const revisions = revisionIds.length ? await client.from("revisions").select("id, content").in("id", revisionIds) : { data: [], error: null };
  if (revisions.error) throw new Error(revisions.error.message);

  const contentByRevision = new Map((revisions.data ?? []).map((revision) => [revision.id, revision.content]));
  const contentByUnit = new Map((units.data ?? []).map((unit) => [unit.id, contentByRevision.get(unit.current_revision_id) ?? ""]));
  const claimsByEntity = new Map<string, string[]>();
  for (const link of links.data ?? []) {
    const content = contentByUnit.get(link.unit_id);
    if (!content) continue;
    const claims = claimsByEntity.get(link.entity_id) ?? [];
    if (claims.length < 6) claimsByEntity.set(link.entity_id, [...claims, content]);
  }
  const entities = concepts
    .map((entity) => ({ id: entity.id, type: entity.type, key: entity.key, name: entity.name, aliases: entity.aliases, description: entity.description, claims: claimsByEntity.get(entity.id) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { entities, taken };
}

// dryRun: ask the model and report what would change, without submitting anything
export async function reclassifyConcepts({ db, client, settings }: Deps, options: { dryRun?: boolean } = {}): Promise<ReclassifyResult> {
  const { entities, taken } = await loadConcepts(client);
  let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
  let model: string | null = null;
  const retypes: Retype[] = [];
  for (let start = 0; start < entities.length; start += RECLASSIFY_BATCH_SIZE) {
    const batch = entities.slice(start, start + RECLASSIFY_BATCH_SIZE);
    const answer = await chatJson(settings, {
      name: "entity_reclassify",
      schema: reclassifyAnswerSchema,
      jsonSchema: reclassifyAnswerJsonSchema,
      messages: buildReclassifyMessages(batch),
      reasoningEffort: "low",
    });
    usage = addUsage(usage, answer);
    model = answer.model;
    for (const { entity, type, reason } of readRetypes(answer.value, batch, taken)) {
      retypes.push({ entityId: entity.id, name: entity.name, from: entity.type, to: type, reason });
      taken.add(`${type}:${entity.key}`);
    }
  }
  if (options.dryRun || !retypes.length) return { checked: entities.length, retypes, applied: 0, rejected: 0 };

  const actions: DraftAction[] = retypes.map((retype) => ({
    type: "retype_entity", targetId: retype.entityId, expectedRevisionId: null, passageIds: [], speechAct: null,
    input: { type: retype.to, fromType: retype.from, reason: `${retype.name}: ${retype.reason}` },
  }));
  const { changeSetId } = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai", operationKey: "reclassify:submit" }, {
    summary: `Reclassified ${retypes.length} entit${retypes.length === 1 ? "y" : "ies"} filed as concept`,
    actions,
    trace: { modelVersion: model, promptVersion: RECLASSIFY_PROMPT_VERSION, ...usage },
  });
  const result = await commitChangeSet(db, changeSetId);
  return { checked: entities.length, retypes, applied: result.applied, rejected: result.rejected };
}
