"use client";

import { buildGraph, type GraphData } from "@/lib/graph";
import { fetchRecentUnitTouches, type GraphRows } from "@/lib/graph/rows";
import { queryKeys } from "@/lib/queries";
import {
  getBrowserSupabase,
  type BrowserSupabase,
} from "@/lib/supabase/client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { readAllPages } from "./readAllPages";

// =====================================================================
// GRAPH DATA for the graph screens: the same rows as fetchGraphRows in
// lib/graph/rows.ts, but each live unit's current revision rides along
// on its foreign key instead of reading every revision ever written
// (the graph only looks revisions up by current_revision_id). Same
// query key as lib/graph's useGraphData, so both share one cache entry.
// =====================================================================

type GraphUnit = GraphRows["units"][number] & {
  current_revision: GraphRows["revisions"][number] | null;
};

async function fetchGraphRows(client: BrowserSupabase): Promise<GraphRows> {
  const [
    unitRows,
    relationships,
    entities,
    unitEntities,
    domains,
    unitDomains,
    pages,
    sections,
    sectionInputs,
    sources,
    sourceUnits,
    suggestions,
    touches,
  ] = await Promise.all([
    readAllPages<GraphUnit>(async (from, to) => {
      const { data, error } = await client
        .from("units")
        .select(
          "id, kind, epistemic_status, current_revision_id, created_at, last_changed_at, current_revision:revisions!units_current_revision_fk(id, content, title, structure)",
        )
        .is("retired_at", null)
        .order("id")
        .range(from, to);
      return { data: data as unknown as GraphUnit[] | null, error };
    }),
    readAllPages((from, to) =>
      client
        .from("relationships")
        .select("id, from_unit_id, to_unit_id, type")
        .is("retired_at", null)
        .order("id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      client
        .from("entities")
        .select("id, name, created_at")
        .is("merged_into_id", null)
        .order("id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      client
        .from("unit_entities")
        .select("unit_id, entity_id")
        .order("unit_id")
        .order("entity_id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      client
        .from("domains")
        .select("id, path, parent_id, context_entity_id")
        .order("id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      client
        .from("unit_domains")
        .select("unit_id, domain_id")
        .order("unit_id")
        .order("domain_id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      client
        .from("pages")
        .select("id, title, slug, created_at, entity_id, domain_id")
        .is("retired_at", null)
        .order("id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      client
        .from("sections")
        .select("id, page_id, title, position, created_at")
        .is("retired_at", null)
        .order("id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      client
        .from("section_inputs")
        .select("section_id, unit_id")
        .order("section_id")
        .order("unit_id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      client.from("sources").select("id, origin").order("id").range(from, to),
    ),
    readAllPages((from, to) =>
      client
        .from("source_units")
        .select("source_id, unit_id")
        .order("source_id")
        .order("unit_id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      client
        .from("article_suggestions")
        .select("id, title, kind, status, unit_ids")
        .eq("status", "pending")
        .order("id")
        .range(from, to),
    ),
    fetchRecentUnitTouches(client),
  ]);
  // The extra current_revision field on each unit is ignored by buildGraph
  const revisions = unitRows.flatMap((unit) =>
    unit.current_revision ? [unit.current_revision] : [],
  );
  return {
    units: unitRows,
    revisions,
    relationships,
    entities,
    unitEntities,
    domains,
    unitDomains,
    pages,
    sections,
    sectionInputs,
    sources,
    sourceUnits,
    suggestions,
    touches,
  };
}

// THE FULL GRAPH, read once and cached under the units table (a commit or Realtime refreshes it)
export function useGraphData(): UseQueryResult<GraphData> {
  return useQuery({
    queryKey: [...queryKeys.table("units"), "graph", "suggestions"],
    queryFn: async () => buildGraph(await fetchGraphRows(getBrowserSupabase())),
  });
}
