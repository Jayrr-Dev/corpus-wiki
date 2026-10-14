import "server-only";

import { resolveModel, tokenFactoryFromEnv } from "@/lib/ai/chat";
import { listTokenFactoryModels, readChosenModel } from "@/lib/ai/models";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";

// WHAT THE MODEL PICKER SHOWS: the pick, the model in use, and the live list (or why it is missing)
export type ModelSettings = {
  chosenModel: string | null;
  activeModel: string;
  models: string[];
  listError: string | null;
};

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
