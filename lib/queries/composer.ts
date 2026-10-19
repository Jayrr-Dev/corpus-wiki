import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { readArticleIllustrations } from "@/lib/server-actions/composer";
import type { ShownLine } from "./sectionLines";

export function useComposerFigures(pageId: string, lines: ShownLine[], contextKey = "") {
  const revisionKey = lines.map((line) => `${line.lineId}:${line.lineRevisionId}`).join(",");
  const query = useQuery({
    // One durable cache entry per page. A prose edit refreshes placements without
    // dropping the images, including when a background refresh fails.
    queryKey: ["table", "lines", "composer", pageId],
    queryFn: async () => {
      const result = await readArticleIllustrations(pageId);
      if (!result.ok) throw new Error(result.error);
      return result.figures;
    },
  });
  const { refetch } = query;
  useEffect(() => { void refetch(); }, [pageId, contextKey, revisionKey, refetch]);
  // Do not keep a stale cached drawing visible while its replacement loads.
  const revisions = new Map(lines.filter((line) => !line.isStale).map((line) => [line.lineId, line.lineRevisionId]));
  return { ...query, data: query.data?.filter((figure) =>
    revisions.has(figure.after) && figure.evidence.every((id) => revisions.has(id)) &&
    !!figure.evidenceRevisions && Object.entries(figure.evidenceRevisions).every(([id, revision]) => revisions.get(id) === revision)) };

}
