// =====================================================================
// FEATURE FLAG REGISTRY: every flag the app knows. A key used anywhere
// else must be one of these (FeatureFlagKey), so a typo fails typecheck.
// Every flag starts off: `defaultEnabled` is typed `false`, and a key with
// no row in public.feature_flags reads as its default.
// Settings > Features lists them in this order.
// =====================================================================

export type FeatureFlagDefinition = {
  // Shown beside the switch in Settings
  label: string;
  // One line, shown in the info hint beside the label
  description: string;
  // New features ship off; turning one on is a decision made in Settings
  defaultEnabled: false;
};

export const FEATURE_FLAGS = {
  billing: {
    label: "Billing",
    description: "Plans, checkout and invoices for paid spaces.",
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
  // Knowledge modules (docs/knowledge-modules-plan.md); turning one off hides it, its data stays
  study: {
    label: "Study",
    description: "Practice questions and flashcards from your knowledge.",
    defaultEnabled: false,
  },
  video: {
    label: "Video",
    description: "Narrated videos from a topic or article.",
    defaultEnabled: false,
  },
  docs: {
    label: "Docs",
    description: "Step-by-step technical docs from your knowledge.",
    defaultEnabled: false,
  },
} as const satisfies Record<string, FeatureFlagDefinition>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[];

// Narrows a string from outside (a form, the database) to a registered key
export function isFeatureFlagKey(key: unknown): key is FeatureFlagKey {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, key);
}

// Every registered flag at its default (all off)
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
