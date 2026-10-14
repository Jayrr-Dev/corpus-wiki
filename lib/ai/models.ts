import "server-only";

import type { DbRpc } from "@/lib/db/rpc";
import { TOKEN_FACTORY_BASE_URL } from "./config";

// =====================================================================
// MODEL CHOICE: which Token Factory model the AI calls use. The list
// comes live from Token Factory (never a fixed list in code); the pick
// is one workspace setting in the database (workspace_settings).
// =====================================================================

type ModelsResponse = { data?: { id?: string }[] };

// The model picked on /settings, or null when none is picked
export async function readChosenModel(db: DbRpc): Promise<string | null> {
  const settings = await db.call<{ aiModel: string | null }>("get_workspace_settings");
  return settings.aiModel;
}

// Saves the pick (null clears it, so AI_MODEL or the default applies again)
export async function saveChosenModel(db: DbRpc, model: string | null): Promise<void> {
  await db.call("set_ai_model", { p_model: model });
}

// Every model id Token Factory offers this key, sorted by name
export async function listTokenFactoryModels(apiKey: string): Promise<string[]> {
  const response = await fetch(new URL("models", TOKEN_FACTORY_BASE_URL), {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Token Factory ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as ModelsResponse;
  const ids = (body.data ?? []).flatMap((model) => (model.id ? [model.id] : []));
  return ids.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
