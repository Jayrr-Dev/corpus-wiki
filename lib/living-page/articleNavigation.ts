import type { Tables } from "@/lib/database/types";
import type { ArticleLink } from "./articleEvidence";
import { rankRelatedArticles } from "./relatedArticles";

type Page = Pick<Tables<"pages">, "id" | "title" | "slug" | "entity_id" | "domain_id"> & { context_entity_id?: string | null; parent_page_id?: string | null };
type Entity = Pick<Tables<"entities">, "id" | "name" | "aliases">;
type Section = Pick<Tables<"sections">, "page_id" | "query">;
type Scope = { unitIds?: string[]; domainPaths?: string[]; articleAliases?: string[] };
const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Reading links always resolve to an existing article, never an entity management screen.
export function articleLinks(pages: Page[], entities: Entity[], sections: Section[], currentId: string) {
  const current = pages.find((page) => page.id === currentId);
  const eligible = pages.filter((page) => !page.context_entity_id || page.context_entity_id === current?.context_entity_id).sort((a,b) => Number(!!b.context_entity_id)-Number(!!a.context_entity_id));
  const scopes = (id: string) => sections.filter((section) => section.page_id === id).map((section) => (section.query ?? {}) as Scope);
  const aliases = (page: Page) => [page.title, ...scopes(page.id).flatMap((scope) => scope.articleAliases ?? [])];
  const links: ArticleLink[] = eligible.filter((page) => page.id !== currentId).sort((a,b) => Number(!!b.context_entity_id)-Number(!!a.context_entity_id)).flatMap((page) => aliases(page).map((label) => ({ label, href: `/p/${page.slug}` })));
  for (const entity of entities) {
    const names = [entity.name, ...entity.aliases];
    const page = eligible.find((candidate) => normalize(candidate.title) === normalize(entity.name))
      ?? pages.find((candidate) => candidate.context_entity_id === entity.id && normalize(candidate.title) === normalize(entity.name))
      ?? eligible.find((candidate) => aliases(candidate).some((alias) => names.some((name) => normalize(name) === normalize(alias))))
      ?? eligible.find((candidate) => candidate.entity_id === entity.id);
    if (page && page.id !== currentId) links.push(...names.map((label) => ({ label, href: `/p/${page.slug}` })));
  }
  return links;
}

export function articleNavigation(pages: Page[], entities: Entity[], sections: Section[], currentId: string, text: string) {
  return { links: articleLinks(pages, entities, sections, currentId), related: rankRelatedArticles(pages, sections, currentId, text) };
}

export function domainArticle(pages: Page[], sections: Section[], domain: { id: string; path: string }): Page | undefined {
  return pages.find((page) => page.domain_id === domain.id)
    ?? pages.find((page) => sections.some((section) => section.page_id === page.id && ((section.query ?? {}) as Scope).domainPaths?.includes(domain.path)));
}
