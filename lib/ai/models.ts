import "server-only";

import type { DbRpc } from "@/lib/db/rpc";
import { type ArticleCharter, readCharter } from "@/lib/living-page/articleCharter";
import { listClaudeModelIds } from "./anthropic";
import type { ModelChoice, ReasoningEffort } from "./chat";
import type { ModelRole } from "./roles";
import { ANTHROPIC_MODEL_PREFIX, CEREBRAS_BASE_URL, CEREBRAS_MODEL_PREFIX, TOKEN_FACTORY_BASE_URL } from "./config";

// =====================================================================
// MODEL CHOICE: which Token Factory model the AI calls use. The list
// comes live from Token Factory (never a fixed list in code); the pick
// is one workspace setting in the database (workspace_settings).
// =====================================================================

type ModelsResponse = { data?: { id?: string; architecture?: { modality?: string } }[] };

type WorkspaceSettings = { aiModel: string | null; aiRoleModels?: Record<string, string>; aiEffort?: ReasoningEffort | null; aiRoleEfforts?: Record<string, ReasoningEffort>; autoUpdateStale?: boolean; allowExternalKnowledge?: boolean; articleCharter?: unknown };

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
  return sortIds(await listModelIds("Token Factory", TOKEN_FACTORY_BASE_URL, apiKey, true));
}

// Every model the picker offers: Token Factory's, plus Cerebras's as "cerebras/<id>" when CEREBRAS_API_KEY is set
// and Claude's as "anthropic/<id>" when ANTHROPIC_API_KEY is set
export async function listAvailableModels(nebiusKey: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const cerebrasKey = env.CEREBRAS_API_KEY;
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const [tokenFactory, cerebras, claude] = await Promise.all([
    listModelIds("Token Factory", TOKEN_FACTORY_BASE_URL, nebiusKey, true),
    cerebrasKey ? listModelIds("Cerebras", CEREBRAS_BASE_URL, cerebrasKey) : Promise.resolve([]),
    anthropicKey ? listClaudeModelIds(anthropicKey) : Promise.resolve([]),
  ]);
  return sortIds([...tokenFactory, ...cerebras.map((id) => CEREBRAS_MODEL_PREFIX + id), ...claude.map((id) => ANTHROPIC_MODEL_PREFIX + id)]);
}

// Chat models only: a model whose listing says it outputs something other than text (an embedding model)
// is left out, since chat completions refuse it. verbose asks Token Factory for that modality.
async function listModelIds(provider: string, baseUrl: string, apiKey: string, verbose = false): Promise<string[]> {
  const response = await fetch(new URL(verbose ? "models?verbose=true" : "models", baseUrl), {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${provider} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as ModelsResponse;
  return (body.data ?? []).flatMap((model) => {
    const modality = model.architecture?.modality;
    return model.id && (!modality || modality.endsWith("->text")) ? [model.id] : [];
  });
}

const sortIds = (ids: string[]) => ids.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
