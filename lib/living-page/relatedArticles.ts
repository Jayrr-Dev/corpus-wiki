import { pageAncestors } from "./pageHierarchy";

export type RelatedPage = { id: string; title: string; slug: string; entity_id: string | null; domain_id: string | null; context_entity_id?: string | null; parent_page_id?: string | null };
export type RelatedSection = { page_id: string; query: unknown };
export type RelatedSignals = {
  connections: { from: string; to: string; weight: number }[];
  similarities: { id: string; similarity: number }[];
};
type Scope = { unitIds?: string[]; domainPaths?: string[]; articleAliases?: string[] };

// Personalized PageRank: restart at the article being read, including when a
// walk reaches a dangling node. Unconnected popular pages receive no rank.
export function personalizedPageRank(ids: string[], edges: RelatedSignals["connections"], root: string) {
  const graph = new Map(ids.map((id) => [id, new Map<string, number>()]));
  for (const { from, to, weight } of edges) {
    if (from === to || !graph.has(from) || !graph.has(to) || !Number.isFinite(weight) || weight <= 0) continue;
    // Knowledge relationships are useful for discovery in either direction.
    for (const [a, b] of [[from, to], [to, from]] as const) graph.get(a)!.set(b, (graph.get(a)!.get(b) ?? 0) + weight);
  }
  let rank = new Map(ids.map((id) => [id, Number(id === root)]));
  if (!graph.has(root)) return rank;
  for (let iteration = 0; iteration < 100; iteration++) {
    const next = new Map(ids.map((id) => [id, id === root ? 0.15 : 0]));
    for (const [id, neighbors] of graph) {
      const mass = 0.85 * rank.get(id)!;
      const total = [...neighbors.values()].reduce((sum, weight) => sum + weight, 0);
      if (!total) next.set(root, next.get(root)! + mass);
      else for (const [neighbor, weight] of neighbors) next.set(neighbor, next.get(neighbor)! + mass * weight / total);
    }
    const change = ids.reduce((sum, id) => sum + Math.abs(next.get(id)! - rank.get(id)!), 0);
    rank = next;
    if (change < 1e-9) break;
  }
  return rank;
}

export function rankRelatedArticles(pages: RelatedPage[], sections: RelatedSection[], currentId: string, text = "", signals?: RelatedSignals) {
  const current = pages.find((page) => page.id === currentId);
  if (!current) return [];
  const eligible = pages.filter((page) => !page.context_entity_id || page.context_entity_id === current.context_entity_id);
  const scopes = new Map(eligible.map((page) => {
    const rows = sections.filter((s) => s.page_id === page.id).map((s) => (s.query ?? {}) as Scope);
    return [page.id, { units: new Set(rows.flatMap((s) => s.unitIds ?? [])), domains: rows.flatMap((s) => s.domainPaths ?? []), aliases: [page.title, ...rows.flatMap((s) => s.articleAliases ?? [])] }];
  }));
  const edges = [...(signals?.connections ?? [])];
  for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
    const a = eligible[i]!, b = eligible[j]!, sa = scopes.get(a.id)!, sb = scopes.get(b.id)!;
    const shared = [...sa.units].filter((id) => sb.units.has(id)).length;
    const overlap = shared / Math.max(1, Math.sqrt(sa.units.size * sb.units.size));
    const domain = sa.domains.some((x) => sb.domains.some((y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)));
    const family = a.parent_page_id === b.id || b.parent_page_id === a.id || (!!a.parent_page_id && a.parent_page_id === b.parent_page_id);
    const weight = 3 * overlap + (domain ? 0.5 : 0) + (family ? 0.5 : 0);
    if (weight) edges.push({ from: a.id, to: b.id, weight });
  }
  for (const page of eligible) {
    if (page.id !== currentId && scopes.get(page.id)!.aliases.some((alias) => alias.length > 3 && text.toLowerCase().includes(alias.toLowerCase()))) {
      edges.push({ from: currentId, to: page.id, weight: 1 });
    }
  }
  const rank = personalizedPageRank(eligible.map((page) => page.id), edges, currentId);
  const ancestors = new Set(pageAncestors(pages, current).map((page) => page.id));
  const candidates = eligible.filter((page) => page.id !== currentId && !ancestors.has(page.id) && page.parent_page_id !== currentId);
  const maxRank = Math.max(0, ...candidates.map((page) => rank.get(page.id) ?? 0));
  const similarities = new Map(signals?.similarities.map((row) => [row.id, row.similarity]) ?? []);
  return candidates.map((page) => {
    const graphScore = maxRank ? (rank.get(page.id) ?? 0) / maxRank : 0;
    const cosine = similarities.get(page.id) ?? 0;
    // Weak semantic matches do not create recommendations on their own.
    const semanticScore = Number.isFinite(cosine) ? Math.max(0, Math.min(1, (cosine - 0.55) / 0.45)) : 0;
    return { ...page, score: 0.65 * graphScore + 0.35 * semanticScore };
  }).filter((page) => page.score >= 0.05).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, 12);
}
