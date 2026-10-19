import type { Tables } from "@/lib/database/types";
import { pageAndDescendants } from "@/lib/living-page/pageHierarchy";
import type { UnitSummary } from "@/lib/queries/screens";

// =====================================================================
// UNIT FILTERS: what /units can narrow by. Every value is a URL search
// param, so the sidebar's `/units?domain=<id>` links land pre-filtered.
// =====================================================================

export type UnitState = "current" | "retired" | "all";

export type UnitFilters = { kind: string; status: string; evidence: string; domain: string; entity: string; state: UnitState; origin?: string; applicability?: string; article: string };

export const FILTER_KEYS = ["kind", "status", "evidence", "domain", "entity", "state", "origin", "applicability", "article"] as const;

// Reads the filters from search params ("" = any; state defaults to current)
export function readUnitFilters(params: { get: (key: string) => string | null }): UnitFilters {
  const state = params.get("state");
  return {
    kind: params.get("kind") ?? "",
    applicability: params.get("applicability") ?? "",
    origin: params.get("origin") === "external" ? "external" : "internal",
    status: params.get("status") ?? "",
    evidence: params.get("evidence") ?? "",
    domain: params.get("domain") ?? "",
    entity: params.get("entity") ?? "",
    article: params.get("article") ?? "",
    state: state === "retired" || state === "all" ? state : "current",
  };
}

// Ids of a domain and every domain below it (by path)
export function domainSubtreeIds(domains: readonly Tables<"domains">[], domainId: string): Set<string> {
  const root = domains.find((domain) => domain.id === domainId);
  if (!root) return new Set([domainId]);
  const below = domains.filter((domain) => domain.path === root.path || domain.path.startsWith(`${root.path}/`));
  return new Set(below.map((domain) => domain.id));
}

export type ArticleUnitLink = { pageId: string; unitId: string };

export type UnitJoins = {
  unitDomains: readonly Tables<"unit_domains">[];
  unitEntities: readonly Tables<"unit_entities">[];
  domains: readonly Tables<"domains">[];
  pages?: readonly { id: string; parent_page_id?: string | null }[];
  articleUnits?: readonly ArticleUnitLink[];
};

// Ids of units joined to any of `ids` through a join table
function unitsJoinedTo<J extends { unit_id: string }>(rows: readonly J[], matches: (row: J) => boolean): Set<string> {
  return new Set(rows.filter(matches).map((row) => row.unit_id));
}

// Applies every filter to the unit list
export function filterUnits(units: readonly UnitSummary[], filters: UnitFilters, joins: UnitJoins): UnitSummary[] {
  const domainIds = filters.domain ? domainSubtreeIds(joins.domains, filters.domain) : null;
  const inDomain = domainIds ? unitsJoinedTo(joins.unitDomains, (row) => domainIds.has(row.domain_id)) : null;
  const aboutEntity = filters.entity ? unitsJoinedTo(joins.unitEntities, (row) => row.entity_id === filters.entity) : null;
  const articleIds = filters.article ? new Set(pageAndDescendants(joins.pages ?? [], filters.article)) : null;
  const inArticle = articleIds
    ? new Set((joins.articleUnits ?? []).filter((row) => articleIds.has(row.pageId)).map((row) => row.unitId))
    : null;
  return units.filter(
    (unit) =>
      matchesState(unit, filters.state) &&
      (!filters.applicability || (unit.context?.applicability.status ?? "unspecified") === filters.applicability) &&
      (unit.sourceOrigin ?? "internal") === (filters.origin ?? "internal") &&
      (!filters.kind || unit.kind === filters.kind) &&
      (!filters.status || unit.epistemic_status === filters.status) &&
      (!filters.evidence || unit.evidence === filters.evidence) &&
      (!inDomain || inDomain.has(unit.id)) &&
      (!aboutEntity || aboutEntity.has(unit.id)) &&
      (!inArticle || inArticle.has(unit.id)),
  );
}

// Current = not retired
function matchesState(unit: UnitSummary, state: UnitState): boolean {
  if (state === "all") return true;
  return state === "retired" ? Boolean(unit.retired_at) : !unit.retired_at;
}
