// =====================================================================
// SCOPE AND COVERAGE (docs/knowledge-modules-plan.md, shared building
// blocks): what Study, Video and Docs start from. Shared by the server
// loader (lib/knowledge/scope.ts) and the pickers (components/knowledge).
// =====================================================================

// Topic = domains.id, Article = pages.id, Entity = entities.id; Glossary has no id
export const SCOPE_KINDS = ["topic", "article", "entity", "glossary"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export type Scope = { kind: Exclude<ScopeKind, "glossary">; id: string } | { kind: "glossary"; id?: null };

export const SCOPE_KIND_LABELS: Record<ScopeKind, string> = { topic: "Topic", article: "Article", entity: "Entity", glossary: "Glossary" };

// The share of a scope's claims a module uses
export const COVERAGES = [25, 50, 100] as const;
export type Coverage = (typeof COVERAGES)[number];

// One choice in the scope picker: a topic, an article or an entity
export type ScopeOption = { id: string; label: string };
export type ScopeOptions = Record<Exclude<ScopeKind, "glossary">, ScopeOption[]>;

// True when a scope names everything it needs (a glossary scope needs no id)
export function isCompleteScope(scope: Scope | null | undefined): scope is Scope {
  if (!scope) return false;
  return scope.kind === "glossary" || (SCOPE_KINDS.includes(scope.kind) && typeof scope.id === "string" && scope.id.length > 0);
}

export const isCoverage = (value: unknown): value is Coverage => (COVERAGES as readonly unknown[]).includes(value);
