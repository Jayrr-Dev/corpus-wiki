import "server-only";

import type { DbRpc } from "@/lib/db/rpc";
import { type ArticleCharter, readCharter } from "@/lib/living-page/articleCharter";
import { listClaudeModelIds } from "./anthropic";
import { ANTHROPIC_MODEL_PREFIX, CEREBRAS_BASE_URL, CEREBRAS_MODEL_PREFIX, TOKEN_FACTORY_BASE_URL } from "./config";

// =====================================================================
// MODEL CHOICE: which Token Factory model the AI calls use. The list
// comes live from Token Factory (never a fixed list in code); the pick
// is one workspace setting in the database (workspace_settings).
// =====================================================================

type ModelsResponse = { data?: { id?: string }[] };

type WorkspaceSettings = { aiModel: string | null; autoUpdateStale?: boolean; allowExternalKnowledge?: boolean; articleCharter?: unknown };

// The model picked on /settings, or null when none is picked
export async function readChosenModel(db: DbRpc): Promise<string | null> {
  const settings = await db.call<WorkspaceSettings>("get_workspace_settings");
  return settings.aiModel;
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
  return sortIds(await listModelIds("Token Factory", TOKEN_FACTORY_BASE_URL, apiKey));
}

// Every model the picker offers: Token Factory's, plus Cerebras's as "cerebras/<id>" when CEREBRAS_API_KEY is set
// and Claude's as "anthropic/<id>" when ANTHROPIC_API_KEY is set
export async function listAvailableModels(nebiusKey: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const cerebrasKey = env.CEREBRAS_API_KEY;
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const [tokenFactory, cerebras, claude] = await Promise.all([
    listModelIds("Token Factory", TOKEN_FACTORY_BASE_URL, nebiusKey),
    cerebrasKey ? listModelIds("Cerebras", CEREBRAS_BASE_URL, cerebrasKey) : Promise.resolve([]),
    anthropicKey ? listClaudeModelIds(anthropicKey) : Promise.resolve([]),
  ]);
  return sortIds([...tokenFactory, ...cerebras.map((id) => CEREBRAS_MODEL_PREFIX + id), ...claude.map((id) => ANTHROPIC_MODEL_PREFIX + id)]);
}

async function listModelIds(provider: string, baseUrl: string, apiKey: string): Promise<string[]> {
  const response = await fetch(new URL("models", baseUrl), {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${provider} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as ModelsResponse;
  return (body.data ?? []).flatMap((model) => (model.id ? [model.id] : []));
}

const sortIds = (ids: string[]) => ids.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
