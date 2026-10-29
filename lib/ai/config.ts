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

// ROLE DEFAULTS, Nemotron first: Ultra for the rare judgment-heavy calls, Super for everyday
// writing and checking, Nano for bulk linking, Super-VL where images are read, and DeepSeek
// V4.1 Flash only for duplicate checks, the highest-volume yes/no calls. They apply only when
// nothing is picked: no workspace model on /settings and no AI_MODEL. A role's own pick on
// /settings still wins. Keys are the roles in MODEL_ROLES (lib/ai/roles.ts).
const NEMOTRON_ULTRA = "nvidia/Nemotron-3-Ultra-550b-a55b";
const NEMOTRON_SUPER = "nvidia/nemotron-3-super-120b-a12b";
const NEMOTRON_NANO = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";
const NEMOTRON_VISION = "nvidia/Nemotron-3.5-Super-VL";
const DEEPSEEK_FLASH = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
export const ROLE_DEFAULT_MODELS: Record<string, string> = {
  plan_articles: NEMOTRON_ULTRA, article_reviewer: NEMOTRON_ULTRA, domain_decider: NEMOTRON_ULTRA, domain_steward: NEMOTRON_ULTRA, curator: NEMOTRON_ULTRA,
  reconciler: NEMOTRON_SUPER, write_articles: NEMOTRON_SUPER, reviewer: NEMOTRON_SUPER, define_concepts: NEMOTRON_SUPER, identify_entities: NEMOTRON_SUPER,
  dictionary_editor: NEMOTRON_SUPER, researcher: NEMOTRON_SUPER, sourcer: NEMOTRON_SUPER,
  tutor: NEMOTRON_SUPER, narrator: NEMOTRON_SUPER, docs_writer: NEMOTRON_SUPER,
  link_knowledge: NEMOTRON_NANO,
  media_analyst: NEMOTRON_VISION, composer: NEMOTRON_VISION,
  deduplicator: DEEPSEEK_FLASH,
};

// PROMPT VERSION: bump when the prompt changes, so each ChangeSet records which prompt drafted it
export const PROMPT_VERSION = "reconcile-v14-structure-labels";
