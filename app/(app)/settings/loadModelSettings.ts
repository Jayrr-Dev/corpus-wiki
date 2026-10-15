import "server-only";

import { resolveModel, tokenFactoryFromEnv } from "@/lib/ai/chat";
import { listTokenFactoryModels, readAllowExternalKnowledge, readAutoUpdateStale, readChosenModel } from "@/lib/ai/models";
import { webSearchKey } from "@/lib/knowledge/webSearch";
import { currentActor } from "@/lib/auth/currentPerson";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";

// WHAT THE MODEL PICKER SHOWS: the pick, the model in use, and the live list (or why it is missing)
export type ModelSettings = {
  chosenModel: string | null;
  activeModel: string;
  models: string[];
  listError: string | null;
};

// The signed-in person's profile (name shown on their changes), or nulls when there is none yet
export async function loadMyProfile(): Promise<{ name: string | null; email: string | null }> {
  const { personId } = await currentActor();
  if (!personId) return { name: null, email: null };
  const { data } = await getAdminSupabase().from("profiles").select("display_name, email").eq("id", personId).maybeSingle();
  return { name: data?.display_name ?? null, email: data?.email ?? null };
}

export async function loadAutoUpdateStale(): Promise<boolean> {
  return readAutoUpdateStale(supabaseRpc(getAdminSupabase()));
}

// The external-knowledge switch, and whether a web search key is set so it can work
export async function loadExternalKnowledge(): Promise<{ enabled: boolean; ready: boolean }> {
  return { enabled: await readAllowExternalKnowledge(supabaseRpc(getAdminSupabase())), ready: webSearchKey() !== null };
}

// Reads the pick from the database and the list from Token Factory
export async function loadModelSettings(): Promise<ModelSettings> {
  const chosenModel = await readChosenModel(supabaseRpc(getAdminSupabase()));
  const activeModel = resolveModel(chosenModel);
  const settings = tokenFactoryFromEnv();
  if (!settings) return { chosenModel, activeModel, models: [], listError: "NEBIUS_API_KEY is not set, so uploads use the offline fake model." };
  try {
    return { chosenModel, activeModel, models: await listTokenFactoryModels(settings.apiKey), listError: null };
  } catch (error) {
    return { chosenModel, activeModel, models: [], listError: `Could not load the model list: ${error instanceof Error ? error.message : String(error)}` };
  }
}
