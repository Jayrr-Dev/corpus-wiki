import type { ComposerArticle, Composition } from "./compose";

// Prompt-only projection: keep the full article/library for validation and tools.
export function composerPromptContext(article: ComposerArticle, figures: Composition["figures"] = [], mode: "compose" | "review" | "vision" = "compose") {
  const needed = new Set(figures.flatMap((f) => [f.after, ...f.evidence]));
  const paragraphs = article.paragraphs.filter((p) => !article.selectedSections || article.selectedSections.includes(p.section ?? "Article") || needed.has(p.id));
  const words = new Set(`${article.title} ${paragraphs.map((p) => `${p.section} ${p.text}`).join(" ")}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  const pinned = new Set(figures.flatMap((f) => f.assetId ? [f.assetId] : []));
  const library = article.availableAssets ?? [];
  const ranked = library.map((asset, index) => {
    const terms = `${asset.title} ${asset.tags.join(" ")} ${asset.description ?? ""}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
    return { asset, index, score: new Set(terms.filter((word) => words.has(word))).size };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const shortlist = new Set(ranked.filter((r) => r.score > 0).slice(0, 12).map((r) => r.asset.id));
  const availableAssets = mode === "vision" ? [] : library.filter((a) => pinned.has(a.id) || mode === "compose" && shortlist.has(a.id));
  return { ...article, paragraphs, availableAssets,
    articleSections: [...new Set(article.paragraphs.map((p) => p.section ?? "Article"))],
    assetContext: mode === "compose" ? "Relevant library shortlist; web search remains available. Selected section text is complete." : undefined,
  };
}
