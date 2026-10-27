// AI PROVIDER SETTINGS (NVIDIA Nemotron on Nebius Token Factory, OpenAI-compatible).
// The key is NEBIUS_API_KEY and the model is AI_MODEL, both server env only.
export const TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";

// CEREBRAS (optional second provider, OpenAI-compatible). Its models show in the Settings
// picker as "cerebras/<id>"; picking one sends chat calls there with CEREBRAS_API_KEY.
// Embeddings and image reading stay on Token Factory (Cerebras offers neither).
export const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1/";
export const CEREBRAS_MODEL_PREFIX = "cerebras/";

// CLAUDE (optional third provider, Anthropic API via its SDK). Its models show in the Settings
// picker as "anthropic/<id>"; picking one sends chat calls there with ANTHROPIC_API_KEY.
// Embeddings stay on Token Factory (Anthropic offers none).
export const ANTHROPIC_MODEL_PREFIX = "anthropic/";

// DEFAULT MODEL: the Settings pick takes precedence over AI_MODEL and this fallback.
export const DEFAULT_AI_MODEL = "nvidia/nemotron-3-super-120b-a12b";

// PROMPT VERSION: bump when the prompt changes, so each ChangeSet records which prompt drafted it
export const PROMPT_VERSION = "reconcile-v14-structure-labels";
