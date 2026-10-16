import "server-only";

import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import {
  buildProfileMessages,
  type OurOrganization,
  PROFILE_BATCH_SIZE,
  profileAnswerJsonSchema,
  profileAnswerSchema,
  profileInputHash,
  type ProfileEvidence,
  readProfiles,
} from "@/lib/ai/tokenFactory/entityProfiles";
import { supabaseRpc } from "@/lib/db/rpc";
import { assertActiveUpload, workflowStep } from "@/lib/ingest/workflowContext";
import { lookUpNewStakeholders } from "./entityWeb";
import type { AdminSupabase } from "@/lib/supabase/admin";

// =====================================================================
// STAKEHOLDER CARDS (server side): after an upload, the entities whose
// claims it changed get their card rewritten ("profiles" in the upload
// workflow); the Stakeholders page writes the rest. A card is derived text
// like entities.description, written straight to entity_profiles, never
// touching what a person added (their contacts, the hidden flag).
// =====================================================================

type Deps = { client: AdminSupabase; settings: TokenFactorySettings };
export type ProfileBatchResult = { written: number; skipped: number };

type Anchor = { ourEntityId: string | null; ourOrganization: OurOrganization };

async function readAnchor(client: AdminSupabase): Promise<Anchor> {
  const settings = await supabaseRpc(client).call<{ ourEntityId?: string | null }>("get_workspace_settings");
  const ourEntityId = settings.ourEntityId ?? null;
  if (!ourEntityId) return { ourEntityId: null, ourOrganization: null };
  const { data, error } = await client.from("entities").select("name, description").eq("id", ourEntityId).maybeSingle();
  if (error) throw error;
  return { ourEntityId, ourOrganization: data ? { name: data.name, description: data.description } : null };
}

async function readEvidence(client: AdminSupabase, entityIds: string[]): Promise<ProfileEvidence[]> {
  if (!entityIds.length) return [];
  return supabaseRpc(client).call<ProfileEvidence[]>("entity_profile_evidence", { p_ids: entityIds });
}

// WHICH OF THESE NEED A CARD: live, some live claim about them, and evidence changed since their card
async function needingCards(client: AdminSupabase, entityIds: string[], anchor: Anchor): Promise<ProfileEvidence[]> {
  const evidence = (await readEvidence(client, entityIds)).filter((entity) => entity.claims.length > 0);
  if (!evidence.length) return [];
  const { data, error } = await client.from("entity_profiles").select("entity_id, input_hash").in("entity_id", evidence.map((entity) => entity.entityId));
  if (error) throw error;
  const hashById = new Map(data.map((row) => [row.entity_id, row.input_hash]));
  return evidence.filter((entity) => hashById.get(entity.entityId) !== profileInputHash(entity, anchor.ourEntityId));
}

// PLAN (the Stakeholders page): batches of every live entity whose card is missing or out of date
export async function planProfileBatches(client: AdminSupabase): Promise<string[][]> {
  const { data, error } = await client.from("entities").select("id").is("merged_into_id", null).is("retired_at", null).order("name");
  if (error) throw error;
  const anchor = await readAnchor(client);
  const ids: string[] = [];
  for (let index = 0; index < data.length; index += 100) {
    ids.push(...(await needingCards(client, data.slice(index, index + 100).map((row) => row.id), anchor)).map((entity) => entity.entityId));
  }
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += PROFILE_BATCH_SIZE) batches.push(ids.slice(index, index + PROFILE_BATCH_SIZE));
  return batches;
}

// AFTER AN UPLOAD: the cards of the entities whose claims it added, revised, retired or merged
export async function profileEventEntities(deps: Deps, eventId: string): Promise<void> {
  const ids = await supabaseRpc(deps.client).call<string[]>("event_touched_entities", { p_event_id: eventId });
  const anchor = await readAnchor(deps.client);
  const stale = (await needingCards(deps.client, [...ids].sort(), anchor)).map((entity) => entity.entityId);
  for (let index = 0; index < stale.length; index += PROFILE_BATCH_SIZE) {
    const batch = stale.slice(index, index + PROFILE_BATCH_SIZE);
    await workflowStep(`profiles:${batch.join(":")}`, () => writeProfileBatch(deps, batch));
  }
  // New stakeholders are looked up on the web (when allowed); a failed lookup never fails the upload
  try { await lookUpNewStakeholders(deps, [...ids]); } catch (error) { console.warn("Stakeholder web lookup failed:", error instanceof Error ? error.message : error); }
}

// ONE BATCH: load the evidence, ask the model, write what it answered. `force` rewrites a card
// whose evidence did not change (a person asked for it again).
export async function writeProfileBatch(deps: Deps, entityIds: string[], force = false): Promise<ProfileBatchResult> {
  const anchor = await readAnchor(deps.client);
  const evidence = force
    ? (await readEvidence(deps.client, entityIds)).filter((entity) => entity.claims.length > 0)
    : await needingCards(deps.client, entityIds, anchor);
  if (!evidence.length) return { written: 0, skipped: entityIds.length };
  const kinds = await kindsInUse(deps.client);
  const answer = await chatJson(deps.settings, {
    name: "entity_profiles",
    schema: profileAnswerSchema,
    jsonSchema: profileAnswerJsonSchema,
    messages: buildProfileMessages(evidence, anchor.ourOrganization, kinds),
    reasoningEffort: "low",
  });
  const rows = readProfiles(answer.value, evidence);
  const hashById = new Map(evidence.map((entity) => [entity.entityId, profileInputHash(entity, anchor.ourEntityId)]));
  const now = new Date().toISOString();
  await assertActiveUpload();
  // Upsert names only the derived columns, so person_contacts and hidden keep their values
  const { error } = await deps.client.from("entity_profiles").upsert(rows.map((row) => ({
    entity_id: row.entityId,
    is_stakeholder: row.isStakeholder,
    kind: row.kind,
    relation: row.relation,
    key_facts: row.keyFacts,
    functions: row.functions,
    contacts: row.contacts,
    person: row.person,
    input_hash: hashById.get(row.entityId) ?? null,
    generated_at: now,
    model: answer.model,
    updated_at: now,
  })), { onConflict: "entity_id" });
  if (error) throw error;
  return { written: rows.length, skipped: entityIds.length - rows.length };
}

// The kinds cards already use, so a batch names the same kind the same way
async function kindsInUse(client: AdminSupabase): Promise<string[]> {
  const { data, error } = await client.from("entity_profiles").select("kind").eq("is_stakeholder", true).not("kind", "is", null);
  if (error) throw error;
  return [...new Set(data.flatMap((row) => (row.kind ? [row.kind] : [])))].sort();
}
