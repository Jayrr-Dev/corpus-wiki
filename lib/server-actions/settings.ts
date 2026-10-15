"use server";

import { currentActor } from "@/lib/auth/currentPerson";
import { requireUser } from "@/lib/auth/requireUser";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { listTokenFactoryModels, saveAllowExternalKnowledge, saveAutoUpdateStale, saveChosenModel } from "@/lib/ai/models";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// SETTINGS ACTIONS (called by /settings): the signed-in user's name and
// password, and the workspace's AI model.
// =====================================================================

// PASSWORD: sets a new password for the signed-in user (Supabase Auth checks its own rules)
export async function changePassword(password: string, confirmation: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    if (!password) throw new Error("Type a new password.");
    if (password !== confirmation) throw new Error("The two passwords don't match.");
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    return {};
  });
}

// NAME: what changes show as "Proposed by"; empty goes back to the email
export async function setMyName(name: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const { personId } = await currentActor();
    if (!personId) throw new Error("Not signed in.");
    if (name.trim().length > 80) throw new Error("Keep the name under 80 characters.");
    await supabaseRpc(getAdminSupabase()).call("set_profile_name", { p_person_id: personId, p_name: name });
    return {};
  });
}

// MODEL: saves the picked model after checking Token Factory still offers it; null goes back to the default
export async function chooseModel(model: string | null): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    if (model) await requireOfferedModel(model);
    await saveChosenModel(supabaseRpc(getAdminSupabase()), model);
    return {};
  });
}

// STALE LINES: on rewrites them when an article opens; off waits for Update
export async function setAutoUpdateStale(enabled: boolean): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    await saveAutoUpdateStale(supabaseRpc(getAdminSupabase()), enabled);
    return {};
  });
}

// EXTERNAL KNOWLEDGE: lets Force Create search the web and store what it finds as external sources
export async function setAllowExternalKnowledge(enabled: boolean): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    await saveAllowExternalKnowledge(supabaseRpc(getAdminSupabase()), enabled);
    return {};
  });
}

// Refuses a model id the live list does not have (a typo would fail every upload)
async function requireOfferedModel(model: string): Promise<void> {
  const settings = tokenFactoryFromEnv();
  if (!settings) throw new Error("NEBIUS_API_KEY is not set, so there is no model list to pick from.");
  const models = await listTokenFactoryModels(settings.apiKey);
  if (!models.includes(model)) throw new Error(`Token Factory does not offer "${model}".`);
}
