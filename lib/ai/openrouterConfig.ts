// Namespaced ids distinguish OpenRouter routes from direct-provider models.
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/";
export const OPENROUTER_MODEL_PREFIX = "openrouter/";
export const isOpenRouterModel = (model: string) => model.startsWith(OPENROUTER_MODEL_PREFIX);
export const openRouterModelId = (model: string) => model.slice(OPENROUTER_MODEL_PREFIX.length);
