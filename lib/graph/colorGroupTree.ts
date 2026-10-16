import { splitGroupQuery, type GraphGroup } from "./groups";

export type ColorTreeRow = { group: GraphGroup; depth: number; hasChildren: boolean; expanded: boolean };

// Display-only hierarchy: never reorder the rules used for color matching.
export function colorGroupTree(groups: readonly GraphGroup[], expanded: ReadonlySet<string>, search: string): ColorTreeRow[] {
  const entries = groups.map((group) => {
    const { field, value } = splitGroupQuery(group.query);
    return { group, path: field === "domain" ? value.trim().replace(/\/+$/, "").toLowerCase() : "" };
  });
  const children = new Map<string | null, typeof entries>();
  for (const entry of entries) {
    const parent = entry.path ? entries.filter((other) => other.path && entry.path.startsWith(other.path + "/"))
      .sort((a, b) => b.path.length - a.path.length)[0] : undefined;
    const key = parent?.group.id ?? null;
    children.set(key, [...(children.get(key) ?? []), entry]);
  }
  const query = search.trim().toLowerCase();
  const matches = (entry: typeof entries[number]): boolean => entry.group.query.toLowerCase().includes(query)
    || (children.get(entry.group.id) ?? []).some(matches);
  const rows: ColorTreeRow[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const entry of [...(children.get(parent) ?? [])].sort((a, b) => a.path.localeCompare(b.path))) {
      if (query && !matches(entry)) continue;
      const hasChildren = Boolean(children.get(entry.group.id)?.length);
      const isExpanded = hasChildren && (Boolean(query) || expanded.has(entry.group.id));
      rows.push({ group: entry.group, depth, hasChildren, expanded: isExpanded });
      if (isExpanded) visit(entry.group.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}
