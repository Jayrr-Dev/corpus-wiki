import { useQuery } from "@tanstack/react-query";
import { readArticle } from "./articleReads";

export function useRelatedArticles(pageId: string, contextKey: string, enabled = true) {
  return useQuery({
    queryKey: ["table", "lines", "related-articles", pageId, contextKey],
    enabled,
    placeholderData: (previous, query) => query?.queryKey[3] === pageId ? previous : undefined,
    queryFn: async () => {
      const result = await readArticle("related", pageId);
      if (!result.ok) throw new Error(result.error);
      return result.articles;
    },
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
}
