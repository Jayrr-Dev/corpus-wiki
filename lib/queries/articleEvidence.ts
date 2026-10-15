import { useQuery } from "@tanstack/react-query";
import type { ShownLine } from "./sectionLines";
import { queryKeys } from "./keys";
import { useRowsByIds } from "./screens";
import { buildArticleEvidence } from "@/lib/living-page/articleEvidence";
import { mediaKindOf } from "@/lib/ingest/formats";
import { getBrowserSupabase } from "@/lib/supabase/client";

// Three batched reads for a whole article, instead of a request per citation,
// plus one for the captions of the images and videos it cites.
export function useArticleEvidence(lines: ShownLine[]) {
  const revisions = useRowsByIds("revisions", lines.flatMap((line) => line.unitRevisionIds));
  const passages = useRowsByIds("passages", (revisions.data ?? []).flatMap((revision) => revision.passage_ids));
  const sources = useRowsByIds("sources", (passages.data ?? []).map((passage) => passage.source_id));
  const mediaIds = (sources.data ?? []).filter((source) => mediaKindOf(source.mime_type)).map((source) => source.id).sort();
  const captions = useMediaCaptions(mediaIds);
  return {
    ...buildArticleEvidence(lines, revisions.data ?? [], passages.data ?? [], sources.data ?? [], captions.data),
    loading: revisions.isPending || passages.isPending || sources.isPending,
    error: revisions.error?.message ?? passages.error?.message ?? sources.error?.message,
  };
}

// CAPTIONS: an image or video source's first passage is the summary its description opens with
function useMediaCaptions(sourceIds: string[]) {
  return useQuery({
    queryKey: [...queryKeys.table("passages"), "captions", sourceIds],
    enabled: sourceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().from("passages").select("source_id, text").in("source_id", sourceIds).eq("position", 0);
      if (error) throw error;
      return new Map(data.map((row) => [row.source_id, row.text]));
    },
  });
}
