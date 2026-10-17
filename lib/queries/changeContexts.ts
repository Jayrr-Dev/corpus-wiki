import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Enums } from "@/lib/database/types";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { queryKeys } from "./keys";

// =====================================================================
// CHANGE CONTEXTS: per change set, its action types and the sections,
// articles and domains they landed in, worked out by the database
// (public.change_set_contexts, which runs under the reader's RLS).
// Keyed under "actions", so Realtime changes to actions refresh it.
// =====================================================================

// ONE CHANGE SET'S CONTEXT (one row of change_set_contexts)
export type ChangeContext = {
  change_set_id: string;
  action_types: Enums<"action_type">[];
  action_count: number;
  line_action_count: number;
  first_line_content: string | null;
  section_titles: string[];
  article_titles: string[];
  domain_names: string[];
  domain_paths: string[];
  claim_domain_paths: string[];
};

async function fetchChangeContexts(ids: string[]): Promise<Map<string, ChangeContext>> {
  if (ids.length === 0) return new Map();
  // Browser reads must not import the server adapter's request-local metrics.
  const { data, error } = await getBrowserSupabase().rpc("change_set_contexts", { p_change_set_ids: ids });
  if (error) throw error;
  const rows = data as unknown as ChangeContext[];
  return new Map((rows ?? []).map((row) => [row.change_set_id, row]));
}

// CONTEXTS OF THE LISTED CHANGE SETS (Changes list), by change set id
export function useChangeContexts(changeSetIds: readonly string[] | undefined): UseQueryResult<Map<string, ChangeContext>> {
  const ids = [...new Set(changeSetIds ?? [])].sort();
  return useQuery({
    queryKey: [...queryKeys.table("actions"), "change-contexts", ids],
    queryFn: () => fetchChangeContexts(ids),
    enabled: changeSetIds !== undefined,
  });
}
