import { knowledgeLabel, phraseLabel } from "@/lib/knowledge/label";
import { pageSectionKey } from "./clusters";
import { isContent } from "./nodeTypes";
import type { GraphRows } from "./rows";
import type { GraphData, GraphLink, GraphNode } from "./types";

// =====================================================================
// BUILD GRAPH: turns the stored rows into nodes and links. Pure, so it
// is tested without a database. Links whose ends are not both present
// (a retired unit, a merged entity) are dropped, and every node's
// degree counts the links that remain.
// =====================================================================

// LABEL LENGTH: unit claims are sentences; the dot's label shows the start
const UNIT_LABEL_MAX = 60;

// Shortens a claim to one label, ending in "…" when cut
export function shortLabel(text: string, max = UNIT_LABEL_MAX): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max
    ? oneLine
    : `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

// Groups `[key, value]` pairs into key -> values
function groupBy(
  pairs: readonly (readonly [string, string])[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of pairs)
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  return grouped;
}

// Keeps only values that resolved (drops undefined from map lookups)
function present<T>(values: readonly (T | undefined)[]): T[] {
  return values.filter((value): value is T => value !== undefined);
}

// Created times keyed the same way page circles are named.
function createdArticles(
  rows: GraphRows,
): NonNullable<GraphNode["articleCreatedAt"]> {
  const titleByPage = new Map(rows.pages.map((page) => [page.id, page.title]));
  const pages = new Map(
    rows.pages.map((page) => [page.title, page.created_at]),
  );
  const sections = new Map<string, string>();
  for (const section of rows.sections) {
    if (!section.created_at) continue;
    const page = titleByPage.get(section.page_id);
    if (!page) continue;
    const title = section.title.trim() || "Untitled";
    const key = pageSectionKey(page, title);
    const previous = sections.get(key);
    if (!previous || section.created_at > previous)
      sections.set(key, section.created_at);
  }
  return { pages, sections };
}

// Later ISO timestamp wins. Either side may be missing.
function latestActivity(
  changed?: string,
  touched?: string,
): string | undefined {
  if (!changed) return touched;
  if (!touched) return changed;
  return changed > touched ? changed : touched;
}

// UNIT NODES: claim text, domains, entity names and citing pages for group queries
function unitNodes(rows: GraphRows): GraphNode[] {
  const contentByRevision = new Map(
    rows.revisions.map((revision) => [revision.id, revision.content]),
  );
  const titleByRevision = new Map(
    rows.revisions.map((revision) => [
      revision.id,
      revision.title?.trim() || null,
    ]),
  );
  const pathByDomain = new Map(
    rows.domains.map((domain) => [domain.id, domain.path]),
  );
  const nameByEntity = new Map(
    rows.entities.map((entity) => [entity.id, entity.name]),
  );
  const titleByPage = new Map(rows.pages.map((page) => [page.id, page.title]));
  const livePages = new Set(rows.pages.map((page) => page.id));
  const sectionById = new Map(
    rows.sections
      .filter((section) => livePages.has(section.page_id))
      .map((section) => [section.id, section]),
  );
  const pagesByUnit = new Map<string, string[]>();
  const sectionsByUnit = new Map<
    string,
    { page: string; section: string; position: number }[]
  >();
  for (const input of rows.sectionInputs) {
    const section = sectionById.get(input.section_id);
    const title = section ? titleByPage.get(section.page_id) : undefined;
    if (!section || !title) continue;
    const titles = pagesByUnit.get(input.unit_id) ?? [];
    if (!titles.includes(title)) titles.push(title);
    pagesByUnit.set(input.unit_id, titles);
    const placements = sectionsByUnit.get(input.unit_id) ?? [];
    const sectionTitle = section.title.trim() || "Untitled";
    if (
      !placements.some(
        (placement) =>
          placement.page === title && placement.section === sectionTitle,
      )
    )
      placements.push({
        page: title,
        section: sectionTitle,
        position: section.position,
      });
    sectionsByUnit.set(input.unit_id, placements);
  }
  const touchedAt = new Map<string, string>();
  for (const touch of rows.touches ?? []) {
    const previous = touchedAt.get(touch.unit_id);
    if (!previous || touch.at > previous)
      touchedAt.set(touch.unit_id, touch.at);
  }
  const recommendedByUnit = new Map<
    string,
    { title: string; kind: "create" | "merge" }
  >();
  for (const suggestion of [...(rows.suggestions ?? [])].sort(
    (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  )) {
    if (suggestion.status !== "pending") continue;
    const title = suggestion.title.trim();
    if (!title) continue;
    const kind = suggestion.kind === "merge" ? "merge" : "create";
    for (const unitId of suggestion.unit_ids) {
      if (!recommendedByUnit.has(unitId))
        recommendedByUnit.set(unitId, { title, kind });
    }
  }
  const domainsByUnit = groupBy(
    rows.unitDomains.map((row) => [row.unit_id, row.domain_id] as const),
  );
  const entitiesByUnit = groupBy(
    rows.unitEntities.map((row) => [row.unit_id, row.entity_id] as const),
  );
  const stakeholderIds = stakeholderEntityIds(rows);
  return rows.units.map((unit) => {
    const content = contentByRevision.get(unit.current_revision_id) ?? unit.id;
    return {
      id: unit.id,
      kind: "unit",
      label:
        titleByRevision.get(unit.current_revision_id) ??
        knowledgeLabel(content),
      text: content,
      href: `/units/${unit.id}`,
      createdAt: unit.created_at,
      activityAt: latestActivity(unit.last_changed_at, touchedAt.get(unit.id)),
      degree: 0,
      domainPaths: present(
        (domainsByUnit.get(unit.id) ?? []).map((id) => pathByDomain.get(id)),
      ),
      entityNames: present(
        (entitiesByUnit.get(unit.id) ?? []).map((id) => nameByEntity.get(id)),
      ),
      stakeholderNames: present(
        (entitiesByUnit.get(unit.id) ?? []).map((id) =>
          stakeholderIds.has(id) ? nameByEntity.get(id) : undefined,
        ),
      ),
      pageTitles: pagesByUnit.get(unit.id) ?? [],
      pageSections: sectionsByUnit.get(unit.id) ?? [],
      recommendedTitle: recommendedByUnit.get(unit.id)?.title,
      recommendedKind: recommendedByUnit.get(unit.id)?.kind,
      unitKind: unit.kind,
      status: unit.epistemic_status,
    };
  });
}

// Entities a visible stakeholder profile marks as stakeholders
function stakeholderEntityIds(rows: GraphRows): Set<string> {
  return new Set(
    rows.entities.filter((entity) => entity.stakeholder).map((entity) => entity.id),
  );
}

// ENTITY NODES: an entity matches `entity:` queries on its own name. Stakeholders are their own kind.
function entityNodes(rows: GraphRows): GraphNode[] {
  return rows.entities.map((entity) => ({
    id: entity.id,
    kind: entity.stakeholder ? "stakeholder" : "entity",
    label: entity.name,
    text: entity.name,
    href: `/entities/${entity.id}`,
    createdAt: entity.created_at,
    degree: 0,
    domainPaths: [],
    entityNames: [entity.name],
    stakeholderNames: entity.stakeholder ? [entity.name] : [],
    pageTitles: [],
    unitKind: null,
    status: null,
  }));
}

// DOMAIN NODES: a topic hub. Units and pages link into it with "in".
function domainNodes(rows: GraphRows): GraphNode[] {
  return rows.domains.map((domain) => {
    const label = domain.path.split("/").filter(Boolean).at(-1) ?? domain.path;
    return {
      id: domain.id,
      kind: "domain" as const,
      label,
      text: domain.path,
      href: "/domains",
      // Domains have no created_at in the graph rows; use a stable early stamp so replay keeps them
      createdAt: "1970-01-01T00:00:00.000Z",
      degree: 0,
      domainPaths: [domain.path],
      entityNames: [],
      pageTitles: [],
      unitKind: null,
      status: null,
    };
  });
}

// PAGE NODES: a page sits in its own domain, if it has one
function pageNodes(rows: GraphRows): GraphNode[] {
  const pathByDomain = new Map(
    rows.domains.map((domain) => [domain.id, domain.path]),
  );
  const nameByEntity = new Map(
    rows.entities.map((entity) => [entity.id, entity.name]),
  );
  const stakeholderIds = stakeholderEntityIds(rows);
  return rows.pages.map((page) => ({
    id: page.id,
    kind: "page",
    label: page.title,
    text: page.title,
    href: `/p/${page.slug}`,
    createdAt: page.created_at,
    degree: 0,
    domainPaths: present([
      page.domain_id ? pathByDomain.get(page.domain_id) : undefined,
    ]),
    entityNames: present([
      page.entity_id ? nameByEntity.get(page.entity_id) : undefined,
    ]),
    stakeholderNames: present([
      page.entity_id && stakeholderIds.has(page.entity_id)
        ? nameByEntity.get(page.entity_id)
        : undefined,
    ]),
    pageTitles: [page.title],
    unitKind: null,
    status: null,
  }));
}

// LINKS: typed relationships, "about" (unit or page -> entity), "in" (unit or page -> domain),
// "cites" (page -> unit, once per pair)
function allLinks(rows: GraphRows): GraphLink[] {
  // Retiring a page leaves its sections behind, so only live pages can cite
  const livePages = new Set(rows.pages.map((page) => page.id));
  const pageBySection = new Map(
    rows.sections
      .filter((section) => livePages.has(section.page_id))
      .map((section) => [section.id, section.page_id]),
  );
  const citePairs = new Set(
    present(
      rows.sectionInputs.map((input) => {
        const pageId = pageBySection.get(input.section_id);
        return pageId ? `${pageId}|${input.unit_id}` : undefined;
      }),
    ),
  );
  return [
    ...rows.relationships.map((link) => ({
      id: link.id,
      source: link.from_unit_id,
      target: link.to_unit_id,
      kind: link.type,
    })),
    ...rows.unitEntities.map((row) => ({
      id: `about:${row.unit_id}:${row.entity_id}`,
      source: row.unit_id,
      target: row.entity_id,
      kind: "about" as const,
    })),
    ...present(
      rows.pages.map((page) =>
        page.entity_id
          ? {
              id: `about:${page.id}:${page.entity_id}`,
              source: page.id,
              target: page.entity_id,
              kind: "about" as const,
            }
          : undefined,
      ),
    ),
    ...rows.unitDomains.map((row) => ({
      id: `in:${row.unit_id}:${row.domain_id}`,
      source: row.unit_id,
      target: row.domain_id,
      kind: "in" as const,
    })),
    ...present(
      rows.pages.map((page) =>
        page.domain_id
          ? {
              id: `in:${page.id}:${page.domain_id}`,
              source: page.id,
              target: page.domain_id,
              kind: "in" as const,
            }
          : undefined,
      ),
    ),
    ...[...citePairs].map((pair) => {
      const [pageId = "", unitId = ""] = pair.split("|");
      return {
        id: `cites:${pageId}:${unitId}`,
        source: pageId,
        target: unitId,
        kind: "cites" as const,
      };
    }),
  ];
}

// Counts how many links touch each node id
export function countDegrees(links: readonly GraphLink[]): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const link of links) {
    degrees.set(link.source, (degrees.get(link.source) ?? 0) + 1);
    degrees.set(link.target, (degrees.get(link.target) ?? 0) + 1);
  }
  return degrees;
}

// BUILD: rows -> the full graph (every layer; filters decide what shows)
export function buildGraph(rows: GraphRows): GraphData {
  // Origin comes from evidence, never from the domain's organization context.
  // Match the knowledge list: a unit backed by an upload remains Internal even
  // when external sources also support it. Unsourced/manual units are Internal.
  const externalSources = new Set(
    rows.sources
      .filter((source) => source.origin === "external")
      .map((source) => source.id),
  );
  const externalUnits = new Set<string>();
  const internalUnits = new Set<string>();
  for (const link of rows.sourceUnits) {
    if (!link.unit_id || !link.source_id) continue;
    (externalSources.has(link.source_id) ? externalUnits : internalUnits).add(
      link.unit_id,
    );
  }
  type Scope = "internal" | "external";
  const unitScopes = new Map(
    rows.units.map((unit) => [
      unit.id,
      externalUnits.has(unit.id) && !internalUnits.has(unit.id)
        ? ("external" as const)
        : ("internal" as const),
    ]),
  );
  const pageBySection = new Map(
    rows.sections.map((section) => [section.id, section.page_id]),
  );
  const pageScopes = new Map<string, Set<Scope>>();
  for (const input of rows.sectionInputs) {
    const pageId = pageBySection.get(input.section_id);
    const scope = unitScopes.get(input.unit_id);
    if (!pageId || !scope) continue;
    const scopes = pageScopes.get(pageId) ?? new Set<Scope>();
    scopes.add(scope);
    pageScopes.set(pageId, scopes);
  }
  const articleCreatedAt = createdArticles(rows);
  // Each builder with the source scopes of its nodes. Entities and domains have none of their own.
  const built: [GraphNode[], (node: GraphNode) => Scope[]][] = [
    [unitNodes(rows), (node) => [unitScopes.get(node.id)!]],
    [entityNodes(rows), () => []],
    [domainNodes(rows), () => []],
    [
      pageNodes(rows),
      (node) => [...(pageScopes.get(node.id) ?? new Set<Scope>(["internal"]))],
    ],
  ];
  const nodes = built.flatMap(([kindNodes, scopesOf]) =>
    kindNodes.map((node) => {
      const sourceScopes = scopesOf(node);
      return {
        ...node,
        articleCreatedAt,
        sourceScopes,
        domainScopePaths: {
          internal: sourceScopes.includes("internal") ? node.domainPaths : [],
          external: sourceScopes.includes("external") ? node.domainPaths : [],
        },
      };
    }),
  );
  // A stored title already tells its claim apart; only derived labels are made specific
  const titledRevisions = new Set(
    rows.revisions
      .filter((revision) => revision.title?.trim())
      .map((revision) => revision.id),
  );
  const titled = new Set(
    rows.units
      .filter((unit) => titledRevisions.has(unit.current_revision_id))
      .map((unit) => unit.id),
  );
  // Topic labels are deliberately broad. When different claims share one,
  // show a short phrase from their own wording so they do not look like duplicates.
  const labelCounts = new Map<string, number>();
  for (const node of nodes) {
    const key = node.label.toLowerCase();
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }
  for (const node of nodes) {
    if (
      isContent(node) &&
      !titled.has(node.id) &&
      (labelCounts.get(node.label.toLowerCase()) ?? 0) > 1
    ) {
      node.label = phraseLabel(node.text);
    }
  }
  const ids = new Set(nodes.map((node) => node.id));
  const links = allLinks(rows).filter(
    (link) => ids.has(link.source) && ids.has(link.target),
  );
  const degrees = countDegrees(links);
  return {
    nodes: nodes.map((node) => ({
      ...node,
      degree: degrees.get(node.id) ?? 0,
    })),
    links,
  };
}
