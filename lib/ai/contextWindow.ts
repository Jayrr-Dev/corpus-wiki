import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { isAnthropicModel } from "./anthropic";
import { ANTHROPIC_MODEL_PREFIX } from "./config";
import { settingsForCall, type TokenFactorySettings } from "./chat";

const FALLBACK_CONTEXT = 65_536;
const limits = new Map<string, { expires: number; value: number }>();

// Read the selected role's current provider metadata, never infer a model's
// capacity from its name. A conservative fallback keeps other providers usable.
export async function reviewContextWindow(settings: TokenFactorySettings, signal?: AbortSignal): Promise<number> {
  if (settings.contextWindowTokens) return settings.contextWindowTokens;
  const route = settingsForCall(settings, "page_editorial_review");
  if (!route.model || !isAnthropicModel(route.model)) return FALLBACK_CONTEXT;
  signal?.throwIfAborted();
  const key = createHash("sha256").update(JSON.stringify([route.model, route.apiKey])).digest("hex");
  const cached = limits.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const model = route.model.slice(ANTHROPIC_MODEL_PREFIX.length);
  let result: number;
  try {
    const info = await new Anthropic({ apiKey: route.apiKey, timeout: 10_000, maxRetries: 0 }).models.retrieve(model, {}, { signal });
    const limit = info.max_input_tokens;
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 4096) return FALLBACK_CONTEXT;
    result = limit;
  } catch {
    signal?.throwIfAborted();
    return FALLBACK_CONTEXT;
  }
  signal?.throwIfAborted();
  // Never cache another upload's aborted request or a transient failed lookup.
  limits.set(key, { expires: Date.now() + 300_000, value: result });
  return result;
}
