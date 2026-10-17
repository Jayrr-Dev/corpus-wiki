import { useQuery } from "@tanstack/react-query";
import { readRelatedArticles } from "@/lib/server-actions/relatedArticles";

export function useRelatedArticles(pageId: string, contextKey: string) {
  return useQuery({
    queryKey: ["table", "lines", "related-articles", pageId, contextKey],
    queryFn: async () => {
      const result = await readRelatedArticles(pageId);
      if (!result.ok) throw new Error(result.error);
      return result.articles;
    },
    staleTime: 60_000,
    // Refresh connection/vector changes too, including tables without Realtime.
    refetchInterval: 60_000,
  });
}
