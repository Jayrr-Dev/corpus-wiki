import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { readArticle } from "./articleReads";
import type { ShownLine } from "./sectionLines";

export function useComposerFigures(pageId: string, lines: ShownLine[], contextKey = "") {
  const revisionKey = lines.map((line) => `${line.lineId}:${line.lineRevisionId}`).join(",");
  const query = useQuery({
    // One durable cache entry per page. A prose edit refreshes placements without
    // dropping the images, including when a background refresh fails.
    queryKey: ["table", "lines", "composer", pageId],
    queryFn: async () => {
      const result = await readArticle("figures", pageId);
      if (!result.ok) throw new Error(result.error);
      return result.figures;
    },
    refetchOnMount: "always",
  });
  const { refetch } = query;
  // The mount already fetches; refetch only when the article's text or sections change.
  const seen = useRef(`${pageId}\n${contextKey}\n${revisionKey}`);
  useEffect(() => {
    const key = `${pageId}\n${contextKey}\n${revisionKey}`;
    if (seen.current === key) return;
    seen.current = key;
    void refetch();
  }, [pageId, contextKey, revisionKey, refetch]);
  // Do not keep a stale cached drawing visible while its replacement loads.
  const revisions = new Map(lines.filter((line) => !line.isStale).map((line) => [line.lineId, line.lineRevisionId]));
  return { ...query, data: query.data?.filter((figure) =>
    revisions.has(figure.after) && figure.evidence.every((id) => revisions.has(id)) &&
    !!figure.evidenceRevisions && Object.entries(figure.evidenceRevisions).every(([id, revision]) => revisions.get(id) === revision)) };

}
