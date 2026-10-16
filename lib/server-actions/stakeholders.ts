"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readChosenModel } from "@/lib/ai/models";
import { supabaseRpc } from "@/lib/db/rpc";
import { type CleanupResult, cleanUpEntities } from "@/lib/knowledge/entityCleanup";
import { planProfileBatches, type ProfileBatchResult, writeProfileBatch } from "@/lib/knowledge/entityProfiles";
import { lookUpWebBatch, planWebBatches, type WebBatchResult } from "@/lib/knowledge/entityWeb";
import { cleanPersonContacts, type PersonContact } from "@/lib/stakeholders/cards";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// STAKEHOLDERS (called by /stakeholders): tidy the entities, plan the
// cards that are missing or out of date, then the screen writes them one
// batch at a time so it can show progress. A person can rewrite one card,
// add contacts, hide a card, and pick the organization cards relate to.
// =====================================================================

async function aiDeps() {
  const client = getAdminSupabase();
  const db = supabaseRpc(client);
  const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db), (call) => db.call("log_ai_call", { p_call: call }));
  if (!settings) throw new Error("Writing stakeholder cards needs NEBIUS_API_KEY in the server env.");
  return { client, db, settings };
}

// TIDY: merge sure duplicates and retire unused entities, over every entity
export async function tidyEntities(): Promise<ActionResult<CleanupResult>> {
  return toActionResult(async () => {
    await requireUser();
    const { db, settings } = await aiDeps();
    return cleanUpEntities(db, settings, null);
  });
}

// PLAN: the batches of entity ids whose card is missing or out of date
export async function planStakeholderPass(): Promise<ActionResult<{ batches: string[][] }>> {
  return toActionResult(async () => {
    await requireUser();
    return { batches: await planProfileBatches(getAdminSupabase()) };
  });
}

// ONE BATCH: the model writes these entities' cards (or decides they are not stakeholders)
export async function writeStakeholderBatch(entityIds: string[]): Promise<ActionResult<ProfileBatchResult>> {
  return toActionResult(async () => {
    await requireUser();
    const { client, settings } = await aiDeps();
    return writeProfileBatch({ client, settings }, entityIds.slice(0, 12));
  });
}

// ONE CARD AGAIN, even when its claims did not change
export async function rewriteStakeholderCard(entityId: string): Promise<ActionResult<ProfileBatchResult>> {
  return toActionResult(async () => {
    await requireUser();
    const { client, settings } = await aiDeps();
    return writeProfileBatch({ client, settings }, [entityId], true);
  });
}

// A PERSON'S CONTACTS: replace the list; the card writer never touches it
export async function savePersonContacts(entityId: string, contacts: PersonContact[]): Promise<ActionResult<{ saved: number }>> {
  return toActionResult(async () => {
    await requireUser();
    const clean = cleanPersonContacts(contacts);
    const { error } = await getAdminSupabase().from("entity_profiles")
      .upsert({ entity_id: entityId, person_contacts: clean, updated_at: new Date().toISOString() }, { onConflict: "entity_id" });
    if (error) throw new Error(error.message);
    return { saved: clean.length };
  });
}

// HIDE OR SHOW a card on the Stakeholders page (nothing is deleted)
export async function setStakeholderHidden(entityId: string, hidden: boolean): Promise<ActionResult<{ hidden: boolean }>> {
  return toActionResult(async () => {
    await requireUser();
    const { error } = await getAdminSupabase().from("entity_profiles").update({ hidden, updated_at: new Date().toISOString() }).eq("entity_id", entityId);
    if (error) throw new Error(error.message);
    return { hidden };
  });
}

// OUR ORGANIZATION: the entity cards say how they relate to (null: relate to the work)
export async function setOurOrganization(entityId: string | null): Promise<ActionResult<{ ourEntityId: string | null }>> {
  return toActionResult(async () => {
    await requireUser();
    const settings = await supabaseRpc(getAdminSupabase()).call<{ ourEntityId: string | null }>("set_our_entity", { p_entity_id: entityId });
    return { ourEntityId: settings.ourEntityId };
  });
}

// WEB LOOKUP PLAN: every stakeholder (Update cards refreshes them all); none while external knowledge is off
export async function planStakeholderWebPass(): Promise<ActionResult<{ batches: string[][] }>> {
  return toActionResult(async () => {
    await requireUser();
    return { batches: await planWebBatches(getAdminSupabase(), true) };
  });
}

// ONE WEB BATCH: search again, keep only sure matches, fetch logos again
export async function lookUpStakeholderBatch(entityIds: string[]): Promise<ActionResult<WebBatchResult>> {
  return toActionResult(async () => {
    await requireUser();
    const { client, settings } = await aiDeps();
    return lookUpWebBatch({ client, settings }, entityIds.slice(0, 10), true);
  });
}

// ONE STAKEHOLDER AGAIN, even when it was looked up already
export async function lookUpStakeholderAgain(entityId: string): Promise<ActionResult<WebBatchResult>> {
  return toActionResult(async () => {
    await requireUser();
    const { client, settings } = await aiDeps();
    return lookUpWebBatch({ client, settings }, [entityId], true);
  });
}
