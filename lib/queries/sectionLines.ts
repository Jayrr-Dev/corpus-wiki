import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "@/lib/database/types";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { withoutEditorialDashes } from "@/lib/living-page/punctuation";
import { queryKeys } from "./keys";

// =====================================================================
// SECTION LINES: the wiki page reads the section_lines view (one row per
// shown line with its current text). Keyed under the "lines" table, so
// Realtime changes to lines invalidate it like any table read.
// =====================================================================

// ONE SHOWN LINE (the view's columns are nullable in the generated types; a shown line has them all)
export type ShownLine = {
  lineId: string;
  sectionId: string;
  position: number;
  lineRevisionId: string;
  content: string;
  unitRevisionIds: string[];
  author: Enums<"actor_kind">;
  authorId: string | null;
  model: string | null;
  isStale: boolean;
  lastChangedAt: string;
};

type ViewRow = Database["public"]["Views"]["section_lines"]["Row"];

// Reads every shown line of one page, in section and line order
export async function fetchSectionLines(client: SupabaseClient<Database>, pageId: string): Promise<ShownLine[]> {
  const { data, error } = await client.from("section_lines").select("*").eq("page_id", pageId).order("position");
  if (error) throw error;
  return (data ?? []).map(toShownLine);
}

// Narrows one view row (every column is set for a shown line)
function toShownLine(row: ViewRow): ShownLine {
  return {
    lineId: row.line_id ?? "",
    sectionId: row.section_id ?? "",
    position: row.position ?? 0,
    lineRevisionId: row.line_revision_id ?? "",
    content: withoutEditorialDashes(row.content ?? ""),
    unitRevisionIds: row.unit_revision_ids ?? [],
    author: row.author ?? "ai",
    authorId: row.author_id,
    model: row.model_version,
    isStale: row.is_stale ?? false,
    lastChangedAt: row.last_changed_at ?? "",
  };
}

// The page's shown lines, refetched whenever a line changes
export function useSectionLines(pageId: string): UseQueryResult<ShownLine[]> {
  return useQuery({
    queryKey: [...queryKeys.table("lines"), "section_lines", pageId],
    queryFn: () => fetchSectionLines(getBrowserSupabase(), pageId),
  });
}
