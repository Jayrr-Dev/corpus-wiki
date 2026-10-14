import type { GraphNode } from "./types";

// =====================================================================
// GROUPS (Obsidian's Groups section): an ordered list of query + color.
// A node takes the color of the FIRST group it matches. Queries:
//   domain:Projects/Alpha  that domain or any branch below it (path: works too)
//   entity:Acme            about an entity whose name contains "Acme"
//   kind:decision          unit kind, or node kind (unit, entity, page)
//   status:disputed        epistemic status
//   anything else          the label contains the text
// Matching ignores case. An empty query matches nothing.
// =====================================================================

// COLORS: token names from app/globals.css (the dull accents, then grays). Never a raw hex.
export const GRAPH_COLORS = [
  { token: "applied", label: "Green" },
  { token: "needs-you", label: "Orange" },
  { token: "failed", label: "Red" },
  { token: "stale", label: "Gold" },
  { token: "link", label: "Blue" },
  { token: "text", label: "Light" },
  { token: "muted", label: "Gray" },
  { token: "faint", label: "Dim" },
] as const;

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
  if (matcher) return matcher(text.slice(colon + 1).trim().replace(/\/+$/, ""));
  return (node) => lower(node.label).includes(text);
}

// Builds one color lookup for a group list (queries parsed once, not per node per frame)
export function groupColorLookup(groups: readonly GraphGroup[]): (node: GraphNode) => GraphColor | null {
  const tests = groups.map((group) => ({ test: parseGroupQuery(group.query), color: group.color }));
  return (node) => tests.find(({ test }) => test(node))?.color ?? null;
}
