import { useQuery } from "@tanstack/react-query";
import { readArticleIllustrations } from "@/lib/server-actions/composer";
import type { ShownLine } from "./sectionLines";

export function useComposerFigures(pageId: string, lines: ShownLine[], contextKey = "") {
  return useQuery({
    queryKey: ["table", "lines", "composer", pageId, contextKey, lines.map((l) => `${l.lineId}:${l.lineRevisionId}`)],
    queryFn: async () => {
      const result = await readArticleIllustrations(pageId);
      if (!result.ok) throw new Error(result.error);
      return result.figures;
    },
  });
}
