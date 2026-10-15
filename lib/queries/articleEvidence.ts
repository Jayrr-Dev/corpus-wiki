import type { ShownLine } from "./sectionLines";
import { useRowsByIds } from "./screens";
import { buildArticleEvidence } from "@/lib/living-page/articleEvidence";

// Three batched reads for a whole article, instead of a request per citation.
export function useArticleEvidence(lines: ShownLine[]) {
  const revisions = useRowsByIds("revisions", lines.flatMap((line) => line.unitRevisionIds));
  const passages = useRowsByIds("passages", (revisions.data ?? []).flatMap((revision) => revision.passage_ids));
  const sources = useRowsByIds("sources", (passages.data ?? []).map((passage) => passage.source_id));
  return {
    ...buildArticleEvidence(lines, revisions.data ?? [], passages.data ?? [], sources.data ?? []),
    loading: revisions.isPending || passages.isPending || sources.isPending,
    error: revisions.error?.message ?? passages.error?.message ?? sources.error?.message,
  };
}
