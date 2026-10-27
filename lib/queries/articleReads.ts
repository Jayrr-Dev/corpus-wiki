import type { readArticleTopicLinks } from "@/lib/server-actions/articleTopicLinks";
import type { readArticleIllustrations } from "@/lib/server-actions/composer";
import type { readRelatedArticles } from "@/lib/server-actions/relatedArticles";

type Reads = { links: typeof readArticleTopicLinks; related: typeof readRelatedArticles; figures: typeof readArticleIllustrations };

// ONE ARTICLE READ through app/(app)/p/[slug]/reads/[kind]/route.ts, a GET so the
// article's reads run in parallel (Server Actions would queue one after another)
export async function readArticle<K extends keyof Reads>(kind: K, pageId: string): Promise<Awaited<ReturnType<Reads[K]>>> {
  const response = await fetch(`/p/${encodeURIComponent(pageId)}/reads/${kind}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load this article's ${kind} (${response.status})`);
  return response.json();
}
