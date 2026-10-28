"use client";

import { queryKeys } from "@/lib/queries";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { buildGraph } from "./build";
import { fetchGraphRows } from "./rows";
import type { GraphData } from "./types";

// GRAPH DATA: the full graph, read once and cached. The key sits under the units
// table, so anything that invalidates units (a commit, Realtime) refreshes the graph.
export function useGraphData(): UseQueryResult<GraphData> {
  return useQuery({
    queryKey: [...queryKeys.table("units"), "graph", "suggestions"],
    queryFn: async () => buildGraph(await fetchGraphRows(getBrowserSupabase())),
  });
}
