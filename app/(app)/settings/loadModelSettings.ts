import "server-only";

import { type ReasoningEffort, resolveModel } from "@/lib/ai/chat";
import { readGlossaryAutoDecide, listAvailableModels,readAllowExternalKnowledge, readArticleCharter, readAutoUpdateStale, readModelChoice, readRoleAuto } from "@/lib/ai/models";
import type { ArticleCharter } from "@/lib/living-page/articleCharter";
import type { DataType } from "@/lib/ai/modelInputs";
import { resolveVisionModel } from "@/lib/ingest/describeMedia";
import { readLatestSpeedTests, type StoredSpeedTest } from "@/lib/ai/speedTest";
import { webSearchKey } from "@/lib/knowledge/webSearch";
import { currentActor } from "@/lib/auth/currentPerson";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";

// WHAT THE MODEL PICKER SHOWS: the pick, the model in use, and the live list (or why it is missing)
export type ModelSettings = {
  chosenModel: string | null;
  activeModel: string;
  // the model the Media analyst uses when it has no model of its own (the active model may not see)
  visionModel: string;
  // role id → the model that replaces the active model for that role's calls
  roleModels: Record<string, string>;
  // the default reasoning effort picked on /settings, or null for the built-in default
  effort: ReasoningEffort | null;
  // role id → the effort that replaces the default effort for that role's calls
  roleEfforts: Record<string, ReasoningEffort>;
  // roles in full auto: what they would hold in Exceptions is accepted at once
  roleAuto: string[];
  models: string[];
  // model id → the data it reads (text, images), from the provider's listing
  modelInputs: Record<string, DataType[]>;
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
  const db = supabaseRpc(getAdminSupabase());
  const [{ model: chosenModel, roleModels, effort = null, roleEfforts = {} }, roleAuto] = await Promise.all([readModelChoice(db), readRoleAuto(db)]);
  const activeModel = resolveModel(chosenModel);
  const visionModel = resolveVisionModel();
  const nebiusKey = process.env.NEBIUS_API_KEY;
  if (!nebiusKey && !process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.CEREBRAS_API_KEY) return { chosenModel, activeModel, visionModel, roleModels, effort, roleEfforts, roleAuto, models: [], modelInputs: {}, listError: "No AI provider key is configured." };
  try {
    const offered = await listAvailableModels(nebiusKey ?? "");
    return { chosenModel, activeModel, visionModel, roleModels, effort, roleEfforts, roleAuto, models: offered.map((model) => model.id), modelInputs: Object.fromEntries(offered.map((model) => [model.id, model.inputs])), listError: null };
  } catch (error) {
    return { chosenModel, activeModel, visionModel, roleModels, effort, roleEfforts, roleAuto, models: [], modelInputs: {}, listError: `Could not load the model list: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// Each model's latest speed test from AI Speed, keyed by model id (empty when none have run)
export async function loadSpeedTests(): Promise<Record<string, StoredSpeedTest>> {
  return readLatestSpeedTests(supabaseRpc(getAdminSupabase()));
}

export async function loadGlossaryAutoDecide(): Promise<boolean> {
  return readGlossaryAutoDecide(supabaseRpc(getAdminSupabase()));
}
