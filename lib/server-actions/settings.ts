"use server";

import { requireUser } from "@/lib/auth/requireUser";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { listTokenFactoryModels, saveChosenModel } from "@/lib/ai/models";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// SETTINGS ACTIONS (called by /settings): the signed-in user's password,
// and the workspace's AI model.
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

// MODEL: saves the picked model after checking Token Factory still offers it; null goes back to the default
export async function chooseModel(model: string | null): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    if (model) await requireOfferedModel(model);
    await saveChosenModel(supabaseRpc(getAdminSupabase()), model);
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
