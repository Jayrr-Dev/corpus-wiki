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
  type ProfileRow,
  readProfiles,
} from "@/lib/ai/tokenFactory/entityProfiles";
import { supabaseRpc } from "@/lib/db/rpc";
import { assertActiveUpload, uploadExecution, workflowStep } from "@/lib/ingest/workflowContext";
import { normalizeProfileKind, resolveProfileKinds } from "./profileKinds";
import { lookUpNewStakeholders } from "./entityWeb";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { processingSpan } from "@/lib/processing/metrics";
import { mapConcurrent } from "@/lib/processing/concurrency";

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
type ProfileDraft = { rows: ProfileRow[]; hashes: Record<string, string>; entityIds: string[]; model: string | null };

async function assertProfileActive(): Promise<void> {
  uploadExecution.getStore()?.signal?.throwIfAborted();
  await assertActiveUpload();
}

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
  // Freeze batch membership, organization and vocabulary so partial saves do not
  // regroup the remaining entities or change prompts when the upload resumes.
  const plan = await workflowStep("profiles:plan", async () => {
    await assertProfileActive();
    const ids = [...new Set(await supabaseRpc(deps.client).call<string[]>("event_touched_entities", { p_event_id: eventId }))].sort();
    const anchor = await readAnchor(deps.client);
    const evidence = await needingCards(deps.client, ids, anchor);
    const stale = evidence.map((entity) => entity.entityId).sort();
    const batches: string[][] = [];
    for (let index = 0; index < stale.length; index += PROFILE_BATCH_SIZE) batches.push(stale.slice(index, index + PROFILE_BATCH_SIZE));
    return { ids, anchor, batches, kinds: await kindsInUse(deps.client), evidence };
  });
  const drafts = await mapConcurrent(plan.batches, 3, async (batch) => {
    await assertProfileActive();
    // Reuse the plan's evidence instead of loading and hashing it again in each
    // draft. Older saved plans have no evidence and retain their original path.
    const evidence = plan.evidence?.filter((entity) => batch.includes(entity.entityId));
    return workflowStep(`profiles-draft:${batch.join(":")}`, () => draftProfileBatch(deps, batch, plan.anchor, plan.kinds, false, evidence));
  }, uploadExecution.getStore()?.signal);
  // Drain every worker before the coordinator releases ownership. Kind decisions,
  // card saves and web lookups only run after all generation has finished.
  await assertProfileActive();
  const kinds = await workflowStep("profiles:kinds", () => resolveProfileKinds(drafts.flatMap((draft) => draft.rows), plan.kinds, deps.settings));
  for (const draft of drafts) {
    await assertProfileActive();
    await workflowStep(`profiles:${draft.entityIds.join(":")}`, () => saveProfileDraft(deps, draft, kinds));
  }
  await assertProfileActive();
  // New stakeholders are looked up on the web (when allowed); a failed lookup never fails the upload
  try { await processingSpan("stage.stakeholder-web", () => lookUpNewStakeholders(deps, plan.ids)); } catch (error) { console.warn("Stakeholder web lookup failed:", error instanceof Error ? error.message : error); }
  await assertProfileActive();
}

// ONE BATCH: load the evidence, ask the model, write what it answered. `force` rewrites a card
// whose evidence did not change (a person asked for it again).
export async function writeProfileBatch(deps: Deps, entityIds: string[], force = false): Promise<ProfileBatchResult> {
  await assertProfileActive();
  const anchor = await readAnchor(deps.client);
  const kinds = await kindsInUse(deps.client);
  const draft = await draftProfileBatch(deps, entityIds, anchor, kinds, force);
  const resolved = await resolveProfileKinds(draft.rows, kinds, deps.settings);
  return saveProfileDraft(deps, draft, resolved);
}

async function draftProfileBatch(deps: Deps, entityIds: string[], anchor: Anchor, kinds: string[], force = false, plannedEvidence?: ProfileEvidence[]): Promise<ProfileDraft> {
  await assertProfileActive();
  const evidence = plannedEvidence ?? (force
    ? (await readEvidence(deps.client, entityIds)).filter((entity) => entity.claims.length > 0)
    : await needingCards(deps.client, entityIds, anchor));
  if (!evidence.length) return { rows: [], hashes: {}, entityIds, model: null };
  const answer = await chatJson(deps.settings, {
    name: "entity_profiles",
    schema: profileAnswerSchema,
    jsonSchema: profileAnswerJsonSchema,
    messages: buildProfileMessages(evidence, anchor.ourOrganization, kinds),
    reasoningEffort: "low",
  });
  const rows = readProfiles(answer.value, evidence);
  return { rows, hashes: Object.fromEntries(evidence.map((entity) => [entity.entityId, profileInputHash(entity, anchor.ourEntityId)])), entityIds, model: answer.model };
}

async function saveProfileDraft(deps: Deps, draft: ProfileDraft, kinds: Record<string, string>): Promise<ProfileBatchResult> {
  await assertProfileActive();
  if (!draft.rows.length) return { written: 0, skipped: draft.entityIds.length };
  const now = new Date().toISOString();
  // Upsert names only the derived columns, so person_contacts and hidden keep their values
  const { error } = await deps.client.from("entity_profiles").upsert(draft.rows.map((row) => ({
    entity_id: row.entityId,
    is_stakeholder: row.isStakeholder,
    kind: row.kind ? kinds[normalizeProfileKind(row.kind)] ?? row.kind : null,
    relation: row.relation,
    key_facts: row.keyFacts,
    functions: row.functions,
    contacts: row.contacts,
    person: row.person,
    input_hash: draft.hashes[row.entityId] ?? null,
    generated_at: now,
    model: draft.model,
    updated_at: now,
  })), { onConflict: "entity_id" });
  if (error) throw error;
  return { written: draft.rows.length, skipped: draft.entityIds.length - draft.rows.length };
}

// The kinds cards already use, so a batch names the same kind the same way
async function kindsInUse(client: AdminSupabase): Promise<string[]> {
  const { data, error } = await client.from("entity_profiles").select("kind").eq("is_stakeholder", true).not("kind", "is", null);
  if (error) throw error;
  return [...new Set(data.flatMap((row) => (row.kind ? [row.kind] : [])))].sort();
}
