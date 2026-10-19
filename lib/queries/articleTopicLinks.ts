import { useQuery } from "@tanstack/react-query";
import { readArticleTopicLinks } from "@/lib/server-actions/articleTopicLinks";

export function useArticleTopicLinks(pageId: string, contextKey: string, enabled = true) {
  return useQuery({
    queryKey: ["table", "lines", "article-topic-links", pageId, contextKey],
    enabled,
    // A metadata refresh must not turn the article's links back into plain text.
    // Never carry destinations over when navigating to a different article.
    placeholderData: (previous, query) => query?.queryKey[3] === pageId ? previous : undefined,
    queryFn: async () => {
      const result = await readArticleTopicLinks(pageId);
      if (!result.ok) throw new Error(result.error);
      return result.links;
    },
    // Reuse this version until knowledge changes invalidate it. Navigation and
    // elapsed time alone should not run the database calculation again.
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
}
