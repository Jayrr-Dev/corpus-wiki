import "server-only";
import { OPENROUTER_BASE_URL, OPENROUTER_MODEL_PREFIX } from "./openrouterConfig";

import type { DbRpc } from "@/lib/db/rpc";
import { type ArticleCharter, readCharter } from "@/lib/living-page/articleCharter";
import { listClaudeModels } from "./anthropic";
import type { ModelChoice, ReasoningEffort } from "./chat";
import type { AutoRole, ModelRole } from "./roles";
import { inputsFromModality, type OfferedModel } from "./modelInputs";
import { ANTHROPIC_MODEL_PREFIX, CEREBRAS_BASE_URL, CEREBRAS_MODEL_PREFIX, TOKEN_FACTORY_BASE_URL } from "./config";

// =====================================================================
// MODEL CHOICE: which Token Factory model the AI calls use. The list
// comes live from Token Factory (never a fixed list in code); the pick
// is one workspace setting in the database (workspace_settings).
// =====================================================================

type ModelsResponse = { data?: { id?: string; architecture?: { modality?: string } }[] };

type WorkspaceSettings = { aiModel: string | null; aiRoleModels?: Record<string, string>; aiEffort?: ReasoningEffort | null; aiRoleEfforts?: Record<string, ReasoningEffort>; aiRoleAuto?: string[]; autoUpdateStale?: boolean; glossaryAutoDecide?: boolean; allowExternalKnowledge?: boolean; monetizationEnabled?: boolean; modules?: Record<string, unknown>; articleCharter?: unknown };

// The model picked on /settings, or null when none is picked
export async function readChosenModel(db: DbRpc): Promise<string | null> {
  const settings = await db.call<WorkspaceSettings>("get_workspace_settings");
  return settings.aiModel;
}

// The workspace model, every role's own model and effort, the default reasoning effort and the database
// the roles' memory lives in, as tokenFactoryFromEnv takes them
export async function readModelChoice(db: DbRpc): Promise<ModelChoice> {
  const settings = await db.call<WorkspaceSettings>("get_workspace_settings");
  return { model: settings.aiModel, roleModels: settings.aiRoleModels ?? {}, effort: settings.aiEffort ?? null, roleEfforts: settings.aiRoleEfforts ?? {}, db };
}

// Saves the default reasoning effort (null goes back to the built-in default, medium)
export async function saveAiEffort(db: DbRpc, effort: ReasoningEffort | null): Promise<void> {
  await db.call("set_ai_effort", { p_effort: effort });
}

// Saves one role's effort (null clears it, so the role uses the default effort again)
export async function saveRoleEffort(db: DbRpc, role: ModelRole, effort: ReasoningEffort | null): Promise<void> {
  await db.call("set_ai_role_effort", { p_role: role, p_effort: effort });
}

// Saves one role's model (null clears it, so the role uses the workspace model again)
export async function saveRoleModel(db: DbRpc, role: ModelRole, model: string | null): Promise<void> {
  await db.call("set_ai_role_model", { p_role: role, p_model: model });
}

// The roles in full auto (Agent Roles): what they would hold in Exceptions is accepted at once
export async function readRoleAuto(db: DbRpc): Promise<string[]> {
  const settings = await db.call<WorkspaceSettings>("get_workspace_settings");
  return settings.aiRoleAuto ?? [];
}

// Turns full auto on or off for one role
export async function saveRoleAuto(db: DbRpc, role: AutoRole, on: boolean): Promise<void> {
  await db.call("set_ai_role_auto", { p_role: role, p_on: on });
}

// True unless /settings has turned off rewriting lines whose claims changed
export async function readAutoUpdateStale(db: DbRpc): Promise<boolean> {
  const settings = await db.call<WorkspaceSettings>("get_workspace_settings");
  return settings.autoUpdateStale !== false;
}

// Saves the stale-line switch for the whole workspace
export async function saveAutoUpdateStale(db: DbRpc, enabled: boolean): Promise<void> {
  await db.call("set_auto_update_stale", { p_enabled: enabled });
}

// True only when /settings lets Force Create bring in knowledge from the web
export async function readAllowExternalKnowledge(db: DbRpc): Promise<boolean> {
  const settings = await db.call<WorkspaceSettings>("get_workspace_settings");
  return settings.allowExternalKnowledge === true;
}

// Saves the external-knowledge switch for the whole workspace
export async function saveAllowExternalKnowledge(db: DbRpc, enabled: boolean): Promise<void> {
  await db.call("set_allow_external_knowledge", { p_enabled: enabled });
}

// True only when /settings turns on usage-based plans (docs/monetization-plan.md); off means log only
export async function readMonetizationEnabled(db: DbRpc): Promise<boolean> {
  const settings = await db.call<WorkspaceSettings>("get_workspace_settings");
  return settings.monetizationEnabled === true;
}

// Saves the monetization switch for the current space
export async function saveMonetizationEnabled(db: DbRpc, enabled: boolean): Promise<void> {
  await db.call("set_monetization_enabled", { p_enabled: enabled });
}

// The article charter set on /settings, with every field present (empty when unset)
export async function readArticleCharter(db: DbRpc): Promise<ArticleCharter> {
  const settings = await db.call<WorkspaceSettings>("get_workspace_settings");
  return readCharter(settings.articleCharter);
}

// Saves the article charter for the whole workspace (empty fields are cleared)
export async function saveArticleCharter(db: DbRpc, charter: ArticleCharter): Promise<void> {
  await db.call("set_article_charter", { p_charter: charter });
}

// Saves the pick (null clears it, so AI_MODEL or the default applies again)
export async function saveChosenModel(db: DbRpc, model: string | null): Promise<void> {
  await db.call("set_ai_model", { p_model: model });
}

// Every model id Token Factory offers this key, sorted by name
export async function listTokenFactoryModels(apiKey: string): Promise<string[]> {
  return sortModels(await listModels("Token Factory", TOKEN_FACTORY_BASE_URL, apiKey, true)).map((model) => model.id);
}

// Every model the picker offers: Token Factory's, plus Cerebras's as "cerebras/<id>" when CEREBRAS_API_KEY is set
// and Claude's as "anthropic/<id>" when ANTHROPIC_API_KEY is set
export async function listAvailableModels(nebiusKey: string, env: NodeJS.ProcessEnv = process.env): Promise<OfferedModel[]> {
  const cerebrasKey = env.CEREBRAS_API_KEY;
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const [tokenFactory, cerebras, claude, openrouter] = await Promise.all([
    nebiusKey ? listModels("Token Factory", TOKEN_FACTORY_BASE_URL, nebiusKey, true) : Promise.resolve([]),
    cerebrasKey ? listModels("Cerebras", CEREBRAS_BASE_URL, cerebrasKey) : Promise.resolve([]),
    anthropicKey ? listClaudeModels(anthropicKey) : Promise.resolve([]),
    env.OPENROUTER_API_KEY ? listModels("OpenRouter", OPENROUTER_BASE_URL, env.OPENROUTER_API_KEY) : Promise.resolve([]),
  ]);
  return sortModels([
    ...tokenFactory,
    ...cerebras.map((model) => ({ ...model, id: CEREBRAS_MODEL_PREFIX + model.id })),
    ...claude.map((model) => ({ ...model, id: ANTHROPIC_MODEL_PREFIX + model.id })),
    ...openrouter.map((model) => ({ ...model, id: OPENROUTER_MODEL_PREFIX + model.id })),
  ]);
}

// Chat models only: a model whose listing says it outputs something other than text (an embedding model)
// is left out, since chat completions refuse it. verbose asks Token Factory for that modality, which also
// says what the model reads (text, images); a listing without one (Cerebras) is taken as text only.
async function listModels(provider: string, baseUrl: string, apiKey: string, verbose = false): Promise<OfferedModel[]> {
  const response = await fetch(new URL(verbose ? "models?verbose=true" : "models", baseUrl), {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${provider} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as ModelsResponse;
  return (body.data ?? []).flatMap((model) => {
    const modality = model.architecture?.modality;
    return model.id && (!modality || modality.endsWith("->text")) ? [{ id: model.id, inputs: inputsFromModality(modality) }] : [];
  });
}

const sortModels = (models: OfferedModel[]) => models.sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: "base" }));

export async function readGlossaryAutoDecide(db: DbRpc): Promise<boolean> {
  return (await db.call<WorkspaceSettings>("get_workspace_settings")).glossaryAutoDecide === true;
}
