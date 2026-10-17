import { articleLinks } from "./articleNavigation";
import { linkArticleText } from "./articleEvidence";
import type { RelatedPage, RelatedSignals } from "./relatedArticles";

// Use the paragraph renderer's actual alias resolution and word boundaries.
// One edge per source article, regardless of how often it repeats a link.
export function articleBacklinks(
  pages: RelatedPage[],
  entities: Parameters<typeof articleLinks>[1],
  sections: Parameters<typeof articleLinks>[2],
  articleTexts: { id: string; text: string }[],
  currentId: string,
): RelatedSignals["connections"] {
  const root = pages.find((page) => page.id === currentId);
  if (!root) return [];
  const target = `/p/${root.slug}`;
  return articleTexts.filter((article) => article.id !== currentId).flatMap((article) => {
    const links = articleLinks(pages, entities, sections, article.id);
    return linkArticleText(article.text, links).some((chunk) => chunk.href === target)
      ? [{ from: article.id, to: currentId, weight: 2 }] : [];
  });
}
