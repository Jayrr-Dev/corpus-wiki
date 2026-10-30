import { countDegrees } from "@/lib/graph/build";
import type { GraphData, GraphLink, GraphNode } from "@/lib/graph/types";
import type { PublicGraph } from "./types";

// =====================================================================
// PUBLIC GRAPH: turns a published graph snapshot into what GraphCanvas
// draws. Pure, so it is tested without a database. Each dot opens the
// published article it belongs to, never a workspace route.
// =====================================================================

function articleHref(base: string, slug: string): string {
  return `${base}/wiki/${encodeURIComponent(slug)}`;
}

export function publicGraphData(snapshot: PublicGraph, base: string, publishedAt: string): GraphData {
  const pageById = new Map(snapshot.pages.map(page => [page.id, page]));
  const blank = { createdAt: publishedAt, degree: 0, entityNames: [], unitKind: null, status: null };
  const pages: GraphNode[] = snapshot.pages.map(page => ({
    ...blank, id: page.id, kind: "page", label: page.title, text: page.title,
    href: articleHref(base, page.slug), domainPaths: page.domains, pageTitles: [page.title],
  }));
  const claims: GraphNode[] = snapshot.claims.flatMap(claim => {
    const placements = claim.pages.flatMap(({ page, section, position }) => {
      const owner = pageById.get(page);
      return owner ? [{ page: owner.title, slug: owner.slug, section, position }] : [];
    });
    const home = placements[0];
    if (!home) return [];
    return [{
      ...blank, id: claim.id, kind: "unit" as const, label: claim.label, text: claim.label,
      href: articleHref(base, home.slug), domainPaths: claim.domains,
      pageTitles: [...new Set(placements.map(place => place.page))],
      pageSections: placements.map(({ page, section, position }) => ({ page, section, position })),
    }];
  });
  const nodes = [...pages, ...claims];
  const ids = new Set(nodes.map(node => node.id));
  const cites: GraphLink[] = snapshot.claims.flatMap(claim => [...new Set(claim.pages.map(place => place.page))].map(page => ({
    id: `cites:${page}:${claim.id}`, source: page, target: claim.id, kind: "cites" as const,
  })));
  const links = [...cites, ...snapshot.links].filter(link => ids.has(link.source) && ids.has(link.target));
  const degrees = countDegrees(links);
  return { nodes: nodes.map(node => ({ ...node, degree: degrees.get(node.id) ?? 0 })), links };
}
