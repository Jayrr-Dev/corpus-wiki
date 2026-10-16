import type { GraphNode } from "./types";

// =====================================================================
// GROUPS (Obsidian's Groups section): an ordered list of query + color.
// A node takes the color of the FIRST group it matches. Queries:
//   domain:Projects/Alpha  that domain or any branch below it (path: works too)
//   entity:Acme            about an entity whose name contains "Acme"
//   kind:decision          unit kind, or node kind (unit, entity, page)
//   status:disputed        epistemic status
//   anything else          the label contains the text
// Matching ignores case. An empty query (or an empty value after the
// prefix) matches nothing. The panel edits a query as field + value.
// =====================================================================

// COLORS: token names from app/globals.css (the dull accents, then grays). Never a raw hex.
const BASE_GRAPH_COLORS = [
  { token: "applied", label: "Green" },
  { token: "needs-you", label: "Orange" },
  { token: "failed", label: "Red" },
  { token: "stale", label: "Gold" },
  { token: "link", label: "Blue" },
  { token: "graph-teal", label: "Teal" },
  { token: "graph-cyan", label: "Cyan" },
  { token: "graph-violet", label: "Violet" },
  { token: "graph-purple", label: "Purple" },
  { token: "graph-pink", label: "Pink" },
  { token: "graph-rose", label: "Rose" },
  { token: "graph-lime", label: "Lime" },
  { token: "graph-copper", label: "Copper" },
  { token: "graph-scarlet", label: "Scarlet" },
  { token: "graph-coral", label: "Coral" },
  { token: "graph-peach", label: "Peach" },
  { token: "graph-amber", label: "Amber" },
  { token: "graph-yellow", label: "Yellow" },
  { token: "graph-chartreuse", label: "Chartreuse" },
  { token: "graph-emerald", label: "Emerald" },
  { token: "graph-mint", label: "Mint" },
  { token: "graph-aqua", label: "Aqua" },
  { token: "graph-sky", label: "Sky" },
  { token: "graph-indigo", label: "Indigo" },
  { token: "graph-lavender", label: "Lavender" },
  { token: "graph-magenta", label: "Magenta" },
  { token: "graph-blush", label: "Blush" },
  { token: "graph-sand", label: "Sand" },
  { token: "graph-slate", label: "Slate" },
  { token: "text", label: "Light" },
  { token: "muted", label: "Gray" },
  { token: "faint", label: "Dim" },
] as const;

const GRAPH_SHADES = [
  { token: "applied-light", label: "Light green" },
  { token: "applied-dark", label: "Dark green" },
  { token: "needs-you-light", label: "Light orange" },
  { token: "needs-you-dark", label: "Dark orange" },
  { token: "failed-light", label: "Light red" },
  { token: "failed-dark", label: "Dark red" },
  { token: "stale-light", label: "Light gold" },
  { token: "stale-dark", label: "Dark gold" },
  { token: "link-light", label: "Light blue" },
  { token: "link-dark", label: "Dark blue" },
  { token: "graph-teal-light", label: "Light teal" },
  { token: "graph-teal-dark", label: "Dark teal" },
  { token: "graph-cyan-light", label: "Light cyan" },
  { token: "graph-cyan-dark", label: "Dark cyan" },
  { token: "graph-violet-light", label: "Light violet" },
  { token: "graph-violet-dark", label: "Dark violet" },
  { token: "graph-purple-light", label: "Light purple" },
  { token: "graph-purple-dark", label: "Dark purple" },
  { token: "graph-pink-light", label: "Light pink" },
  { token: "graph-pink-dark", label: "Dark pink" },
  { token: "graph-rose-light", label: "Light rose" },
  { token: "graph-rose-dark", label: "Dark rose" },
  { token: "graph-lime-light", label: "Light lime" },
  { token: "graph-lime-dark", label: "Dark lime" },
  { token: "graph-copper-light", label: "Light copper" },
  { token: "graph-copper-dark", label: "Dark copper" },
] as const;

export const GRAPH_COLORS = [...BASE_GRAPH_COLORS, ...GRAPH_SHADES] as const;

// Each primary family keeps its existing token as the medium shade.
export const GRAPH_COLOR_FAMILIES = BASE_GRAPH_COLORS.slice(0, 13).map((color) => ({
  label: color.label,
  colors: [
    GRAPH_SHADES.find((shade) => shade.token === `${color.token}-light`)!,
    color,
    GRAPH_SHADES.find((shade) => shade.token === `${color.token}-dark`)!,
  ],
}));

export const GRAPH_ACCENTS = BASE_GRAPH_COLORS.filter(({ token }) => token !== "text" && token !== "muted" && token !== "faint");

export type GraphColor = (typeof GRAPH_COLORS)[number]["token"];

export interface GraphGroup {
  id: string;
  query: string;
  color: GraphColor;
}

type NodeTest = (node: GraphNode) => boolean;

// Lowercases for case-insensitive matching
const lower = (text: string) => text.toLowerCase();

// MATCHERS: one rule per query prefix
const PREFIX_MATCHERS: Record<string, (value: string) => NodeTest> = {
  domain: (value) => (node) => node.domainPaths.some((path) => lower(path) === value || lower(path).startsWith(`${value}/`)),
  path: (value) => PREFIX_MATCHERS.domain!(value),
  entity: (value) => (node) => node.entityNames.some((name) => lower(name).includes(value)),
  kind: (value) => (node) => node.kind === value || node.unitKind === value,
  status: (value) => (node) => node.status === value,
};

// Turns one group query into a node test
export function parseGroupQuery(query: string): NodeTest {
  const text = lower(query.trim());
  if (!text) return () => false;
  const colon = text.indexOf(":");
  const prefix = colon > 0 ? text.slice(0, colon) : "";
  const matcher = PREFIX_MATCHERS[prefix];
  if (matcher) {
    const value = text.slice(colon + 1).trim().replace(/\/+$/, "");
    return value ? matcher(value) : () => false;
  }
  return (node) => lower(node.label).includes(text);
}

// FIELDS: what the panel's picker offers; "text" is the bare query (label contains)
export const GROUP_FIELDS = [
  { key: "domain", label: "Domain" },
  { key: "entity", label: "Entity" },
  { key: "kind", label: "Kind" },
  { key: "status", label: "Status" },
  { key: "text", label: "Title contains" },
] as const;

export type GroupField = (typeof GROUP_FIELDS)[number]["key"];

// Splits a query into the picker's field and the typed value (case kept for display)
export function splitGroupQuery(query: string): { field: GroupField; value: string } {
  const colon = query.indexOf(":");
  const prefix = lower(query.slice(0, Math.max(colon, 0)).trim());
  if (colon > 0 && prefix in PREFIX_MATCHERS) {
    const field = prefix === "path" ? "domain" : (prefix as GroupField);
    return { field, value: query.slice(colon + 1).trimStart() };
  }
  return { field: "text", value: query };
}

// Joins the picker's field and value back into a stored query
export function joinGroupQuery(field: GroupField, value: string): string {
  return field === "text" ? value : `${field}:${value}`;
}

// SUGGESTIONS: the values present in the graph, per field, for the picker
export function groupSuggestions(nodes: readonly GraphNode[]): Record<Exclude<GroupField, "text">, string[]> {
  const sets = { domain: new Set<string>(), entity: new Set<string>(), kind: new Set<string>(), status: new Set<string>() };
  for (const node of nodes) {
    // every ancestor too, so a parent domain can be picked (it matches its whole branch)
    for (const path of node.domainPaths) {
      const segments = path.split("/");
      for (let depth = 1; depth <= segments.length; depth++) sets.domain.add(segments.slice(0, depth).join("/"));
    }
    for (const name of node.entityNames) sets.entity.add(name);
    sets.kind.add(node.unitKind ?? node.kind);
    if (node.status) sets.status.add(node.status);
  }
  const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
  return { domain: sorted(sets.domain), entity: sorted(sets.entity), kind: sorted(sets.kind), status: sorted(sets.status) };
}

// COUNTS: how many nodes each group actually colors (first match wins, so a later group can get fewer)
export function groupCounts(groups: readonly GraphGroup[], nodes: readonly GraphNode[]): Map<string, number> {
  const tests = groups.map((group) => ({ id: group.id, test: parseGroupQuery(group.query) }));
  const counts = new Map(groups.map((group) => [group.id, 0]));
  for (const node of nodes) {
    const hit = tests.find(({ test }) => test(node));
    if (hit) counts.set(hit.id, (counts.get(hit.id) ?? 0) + 1);
  }
  return counts;
}

// Builds one color lookup for a group list (queries parsed once, not per node per frame)
export function groupColorLookup(groups: readonly GraphGroup[]): (node: GraphNode) => GraphColor | null {
  const tests = groups.map((group) => ({ test: parseGroupQuery(group.query), color: group.color }));
  return (node) => tests.find(({ test }) => test(node))?.color ?? null;
}
