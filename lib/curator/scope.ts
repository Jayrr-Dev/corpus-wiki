import type { CuratorPage } from "./score";

export type CuratorScope = { pageIds: readonly string[]; unitIds: readonly string[] };

// Keep the full tree as context, but automatic upload upkeep only schedules
// work for affected pages and their ancestors. A manual pass has no scope.
export function affectedPageIds(pages: readonly CuratorPage[], scope: CuratorScope): Set<string> {
  const units = new Set(scope.unitIds);
  const selected = new Set(scope.pageIds);
  for (const page of pages) if (page.claimIds.some((id) => units.has(id))) selected.add(page.id);
  const byId = new Map(pages.map((page) => [page.id, page]));
  for (const id of [...selected]) {
    let parent = byId.get(id)?.parentId;
    const seen = new Set<string>([id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      selected.add(parent);
      parent = byId.get(parent)?.parentId;
    }
  }
  return selected;
}
