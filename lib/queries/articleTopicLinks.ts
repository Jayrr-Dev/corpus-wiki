import { useQuery } from "@tanstack/react-query";
import { readArticleTopicLinks } from "@/lib/server-actions/articleTopicLinks";

export function useArticleTopicLinks(pageId: string, contextKey: string) {
  return useQuery({
    queryKey: ["table", "lines", "article-topic-links", pageId, contextKey],
    queryFn: async () => {
      const result = await readArticleTopicLinks(pageId);
      if (!result.ok) throw new Error(result.error);
      return result.links;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
