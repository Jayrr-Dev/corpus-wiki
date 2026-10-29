// =====================================================================
// SCOPE AND COVERAGE (docs/knowledge-modules-plan.md, shared building
// blocks): what Study, Video and Docs start from. Shared by the server
// loader (lib/knowledge/scope.ts) and the pickers (components/knowledge).
// =====================================================================

// Topic = domains.id, Article = pages.id, Entity = entities.id; Glossary may name a topic
// (domains.id: the terms whose claims are in it), or none for the whole glossary
export const SCOPE_KINDS = ["topic", "article", "entity", "glossary"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export type Scope = { kind: Exclude<ScopeKind, "glossary">; id: string } | { kind: "glossary"; id?: string | null };

export const SCOPE_KIND_LABELS: Record<ScopeKind, string> = { topic: "Topic", article: "Article", entity: "Entity", glossary: "Glossary" };

// The share of a scope's claims a module uses
export const COVERAGES = [25, 50, 100] as const;
export type Coverage = (typeof COVERAGES)[number];

// Or the claims the person checked (Custom): their unit ids, in the scope
export const MAX_CUSTOM_CLAIMS = 500;
export type CustomClaims = { custom: string[] };
export type CoverageChoice = Coverage | CustomClaims;
export const isCustomChoice = (choice: CoverageChoice): choice is CustomClaims => typeof choice !== "number";

// The coverage number a saved row keeps: a custom pick is stored at 100 and its ids are kept beside it
export const coverageShare = (choice: CoverageChoice): Coverage => (isCustomChoice(choice) ? 100 : choice);

// One choice in the scope picker: a topic, an article or an entity. `group` is what the picker
// files it under: an article's topic path ("Acme › Health & Safety"), an entity's type label.
export type ScopeOption = { id: string; label: string; group?: string };
export type ScopeOptions = Record<Exclude<ScopeKind, "glossary">, ScopeOption[]>;

// True when a scope names everything it needs (a glossary scope needs no id)
export function isCompleteScope(scope: Scope | null | undefined): scope is Scope {
  if (!scope) return false;
  return scope.kind === "glossary" || (SCOPE_KINDS.includes(scope.kind) && typeof scope.id === "string" && scope.id.length > 0);
}

// A scope's name, for default titles: the choice's label, "Glossary" or "Glossary: <topic>"
export function scopeTitle(scope: Scope, options: ScopeOptions, fallback: string): string {
  if (scope.kind !== "glossary") return options[scope.kind].find((option) => option.id === scope.id)?.label ?? fallback;
  const topic = scope.id ? options.topic.find((option) => option.id === scope.id)?.label.split(" › ").at(-1) : undefined;
  return topic ? `${SCOPE_KIND_LABELS.glossary}: ${topic}` : SCOPE_KIND_LABELS.glossary;
}

export const isCoverage = (value: unknown): value is Coverage => (COVERAGES as readonly unknown[]).includes(value);

// A share, or a Custom pick of 1 to MAX_CUSTOM_CLAIMS claim ids
export const isCoverageChoice = (value: unknown): value is CoverageChoice => {
  if (isCoverage(value)) return true;
  const custom = typeof value === "object" && value !== null ? (value as Partial<CustomClaims>).custom : undefined;
  return Array.isArray(custom) && custom.length >= 1 && custom.length <= MAX_CUSTOM_CLAIMS && custom.every((id) => typeof id === "string");
};
