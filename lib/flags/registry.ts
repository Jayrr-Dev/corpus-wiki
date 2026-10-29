// =====================================================================
// FEATURE FLAG REGISTRY: every flag the app knows. A key used anywhere
// else must be one of these (FeatureFlagKey), so a typo fails typecheck.
// A key with no row in public.feature_flags reads as its default. Features
// start off; sidebar modules (`module: true`) show or hide a sidebar link and
// most start on. Settings > Features lists each kind in this order.
// =====================================================================

export type FeatureFlagDefinition = {
  // Shown beside the switch in Settings
  label: string;
  // One line, shown in the info hint beside the label
  description: string;
  // New features ship off; turning one on is a decision made in Settings
  defaultEnabled: boolean;
  // A sidebar module: listed under Settings > Features > Sidebar, in sidebar order
  module?: true;
};

export const FEATURE_FLAGS = {
  billing: {
    label: "Billing",
    description: "Plans, checkout and invoices for paid spaces.",
    defaultEnabled: false,
  },
  legal_pages: {
    label: "Legal pages",
    description: "Public terms of service and privacy policy pages.",
    defaultEnabled: false,
  },
  audio_ingest: {
    label: "Audio uploads",
    description: "Upload recordings and turn their transcripts into knowledge.",
    defaultEnabled: false,
  },
  chat_import: {
    label: "Chat import",
    description: "Import conversations exported from other AI chat apps.",
    defaultEnabled: false,
  },
  gmail_import: {
    label: "Gmail import",
    description: "Bring in emails from a connected Gmail account.",
    defaultEnabled: false,
  },
  // SIDEBAR MODULES, in sidebar order; turning one off hides its link, its data stays
  pages: {
    label: "Pages",
    description: "The wiki's articles.",
    defaultEnabled: true,
    module: true,
  },
  graph: {
    label: "Graph",
    description: "A map of how pages and entities connect.",
    defaultEnabled: true,
    module: true,
  },
  glossary: {
    label: "Glossary",
    description: "Terms and their definitions.",
    defaultEnabled: true,
    module: true,
  },
  stakeholders: {
    label: "Stakeholders",
    description: "People and groups the knowledge mentions.",
    defaultEnabled: true,
    module: true,
  },
  ask: {
    label: "Ask",
    description: "Chat with your knowledge.",
    defaultEnabled: true,
    module: true,
  },
  // Knowledge modules (docs/knowledge-modules-plan.md): off by default, and off also 404s their pages
  study: {
    label: "Study",
    description: "Practice questions and flashcards from your knowledge.",
    defaultEnabled: false,
    module: true,
  },
  video: {
    label: "Video",
    description: "Narrated videos from a topic or article.",
    defaultEnabled: false,
    module: true,
  },
  docs: {
    label: "Docs",
    description: "Step-by-step technical docs from your knowledge.",
    defaultEnabled: false,
    module: true,
  },
  upload: {
    label: "Upload",
    description: "Add files, links and text.",
    defaultEnabled: true,
    module: true,
  },
  sources: {
    label: "Sources",
    description: "Everything uploaded and how far it got.",
    defaultEnabled: true,
    module: true,
  },
  assets: {
    label: "Assets",
    description: "Images and files pulled from sources.",
    defaultEnabled: true,
    module: true,
  },
  knowledge: {
    label: "Knowledge",
    description: "Suggested knowledge waiting for review.",
    defaultEnabled: true,
    module: true,
  },
  changes: {
    label: "Changes",
    description: "Edits the AI made to pages.",
    defaultEnabled: true,
    module: true,
  },
  decisions: {
    label: "Decisions",
    description: "Questions the AI needs you to settle.",
    defaultEnabled: true,
    module: true,
  },
  exceptions: {
    label: "Exceptions",
    description: "Problems the AI could not resolve alone.",
    defaultEnabled: true,
    module: true,
  },
  domains: {
    label: "Domains",
    description: "The topic areas pages are filed under.",
    defaultEnabled: true,
    module: true,
  },
  entities: {
    label: "Entities",
    description: "People, places and things across pages.",
    defaultEnabled: true,
    module: true,
  },
  workflow: {
    label: "Workflow",
    description: "The steps and skills the AI runs.",
    defaultEnabled: true,
    module: true,
  },
  agent_roles: {
    label: "Agent Roles",
    description: "Which model does each AI job.",
    defaultEnabled: true,
    module: true,
  },
  error_log: {
    label: "Error log",
    description: "Errors from the app and its jobs.",
    defaultEnabled: true,
    module: true,
  },
  nav_mode_switch: {
    label: "Admin / User switch",
    description: "The sidebar toggle; off shows every module that is on.",
    defaultEnabled: true,
    module: true,
  },
} as const satisfies Record<string, FeatureFlagDefinition>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[];

// The sidebar modules' keys (`module: true`)
export type ModuleFlagKey = { [K in FeatureFlagKey]: (typeof FEATURE_FLAGS)[K] extends { module: true } ? K : never }[FeatureFlagKey];

export const isModuleFlagKey = (key: FeatureFlagKey): key is ModuleFlagKey => "module" in FEATURE_FLAGS[key];

// Sidebar modules in sidebar order, and the features without them
export const MODULE_FLAG_KEYS: ModuleFlagKey[] = FEATURE_FLAG_KEYS.filter(isModuleFlagKey);
export const FEATURE_ONLY_KEYS = FEATURE_FLAG_KEYS.filter((key) => !isModuleFlagKey(key));

// The sidebar modules that are on, in sidebar order
export function enabledModuleFlags(flags: FeatureFlags): ModuleFlagKey[] {
  return MODULE_FLAG_KEYS.filter((key) => flags[key]);
}

// Narrows a string from outside (a form, the database) to a registered key
export function isFeatureFlagKey(key: unknown): key is FeatureFlagKey {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, key);
}

// Every registered flag at its default
export function defaultFeatureFlags(): FeatureFlags {
  return Object.fromEntries(FEATURE_FLAG_KEYS.map((key) => [key, FEATURE_FLAGS[key].defaultEnabled])) as FeatureFlags;
}

// Saved values over the defaults: unknown keys are dropped, and only `true` turns a flag on
export function resolveFeatureFlags(saved: unknown): FeatureFlags {
  const flags = defaultFeatureFlags();
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return flags;
  for (const key of FEATURE_FLAG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(saved, key)) flags[key] = (saved as Record<string, unknown>)[key] === true;
  }
  return flags;
}
