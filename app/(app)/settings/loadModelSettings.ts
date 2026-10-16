import "server-only";

import { type ReasoningEffort, resolveModel } from "@/lib/ai/chat";
import { listAvailableModels,readAllowExternalKnowledge, readArticleCharter, readAutoUpdateStale, readModelChoice } from "@/lib/ai/models";
import type { ArticleCharter } from "@/lib/living-page/articleCharter";
import { readLatestSpeedTests, type StoredSpeedTest } from "@/lib/ai/speedTest";
import { webSearchKey } from "@/lib/knowledge/webSearch";
import { currentActor } from "@/lib/auth/currentPerson";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";

// WHAT THE MODEL PICKER SHOWS: the pick, the model in use, and the live list (or why it is missing)
export type ModelSettings = {
  chosenModel: string | null;
  activeModel: string;
  // role id → the model that replaces the active model for that role's calls
  roleModels: Record<string, string>;
  // the default reasoning effort picked on /settings, or null for the built-in default
  effort: ReasoningEffort | null;
  // role id → the effort that replaces the default effort for that role's calls
  roleEfforts: Record<string, ReasoningEffort>;
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

export async function loadArticleCharter(): Promise<ArticleCharter> {
  return readArticleCharter(supabaseRpc(getAdminSupabase()));
}

// The external-knowledge switch, and whether a web search key is set so it can work
export async function loadExternalKnowledge(): Promise<{ enabled: boolean; ready: boolean }> {
  return { enabled: await readAllowExternalKnowledge(supabaseRpc(getAdminSupabase())), ready: webSearchKey() !== null };
}

// Reads the pick from the database and the list from Token Factory (plus Cerebras and Claude when their keys are set)
export async function loadModelSettings(): Promise<ModelSettings> {
  const { model: chosenModel, roleModels, effort = null, roleEfforts = {} } = await readModelChoice(supabaseRpc(getAdminSupabase()));
  const activeModel = resolveModel(chosenModel);
  const nebiusKey = process.env.NEBIUS_API_KEY;
  if (!nebiusKey) return { chosenModel, activeModel, roleModels, effort, roleEfforts, models: [], listError: "NEBIUS_API_KEY is not set, so uploads use the offline fake model." };
  try {
    return { chosenModel, activeModel, roleModels, effort, roleEfforts, models: await listAvailableModels(nebiusKey), listError: null };
  } catch (error) {
    return { chosenModel, activeModel, roleModels, effort, roleEfforts, models: [], listError: `Could not load the model list: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// Each model's latest speed test from AI Speed, keyed by model id (empty when none have run)
export async function loadSpeedTests(): Promise<Record<string, StoredSpeedTest>> {
  return readLatestSpeedTests(supabaseRpc(getAdminSupabase()));
}
