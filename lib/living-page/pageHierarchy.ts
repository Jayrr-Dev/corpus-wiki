import type { Tables } from "@/lib/database/types";

export type HierarchyPage = Pick<Tables<"pages">, "id" | "title" | "slug"> & { parent_page_id?: string | null; context_entity_id?: string | null };
export type PageNode<T extends HierarchyPage = HierarchyPage> = T & { children: PageNode<T>[] };

// Parent links are navigation, not claims of ownership. Missing parents remain visible.
export function buildPageTree<T extends HierarchyPage>(pages: T[]): PageNode<T>[] {
  const nodes = new Map(pages.map((page) => [page.id, { ...page, children: [] as PageNode<T>[] }]));
  const roots: PageNode<T>[] = [];
  for (const node of nodes.values()) {
    const visited = new Set([node.id]);
    let ancestor = node.parent_page_id ? nodes.get(node.parent_page_id) : undefined;
    let cycle = false;
    while (ancestor) {
      if (visited.has(ancestor.id)) { cycle = true; break; }
      visited.add(ancestor.id);
      ancestor = ancestor.parent_page_id ? nodes.get(ancestor.parent_page_id) : undefined;
    }
    const parent = !cycle && node.parent_page_id ? nodes.get(node.parent_page_id) : undefined;
    (parent?.children ?? roots).push(node);
  }
  const sort = (list: PageNode<T>[]): PageNode<T>[] => list.sort((a,b) => a.title.localeCompare(b.title)).map((node) => ({ ...node, children: sort(node.children) }));
  return sort(roots);
}

export function pageAncestors(pages: HierarchyPage[], page: HierarchyPage): HierarchyPage[] {
  const byId = new Map(pages.map((item) => [item.id,item]));
  const result: HierarchyPage[] = [];
  const seen = new Set([page.id]);
  let parent = page.parent_page_id ? byId.get(page.parent_page_id) : undefined;
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id); result.unshift(parent);
    parent = parent.parent_page_id ? byId.get(parent.parent_page_id) : undefined;
  }
  return result;
}
