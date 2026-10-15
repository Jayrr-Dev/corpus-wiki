// AI PROVIDER SETTINGS (NVIDIA Nemotron on Nebius Token Factory, OpenAI-compatible).
// The key is NEBIUS_API_KEY and the model is AI_MODEL, both server env only.
export const TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";

// DEFAULT MODEL: the Settings pick takes precedence over AI_MODEL and this fallback.
export const DEFAULT_AI_MODEL = "nvidia/nemotron-3-super-120b-a12b";

// PROMPT VERSION: bump when the prompt changes, so each ChangeSet records which prompt drafted it
export const PROMPT_VERSION = "reconcile-v6";
