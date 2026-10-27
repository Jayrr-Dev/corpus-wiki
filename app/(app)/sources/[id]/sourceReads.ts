"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKeys, type Row } from "@/lib/queries";
import { readIdBatches, readPages } from "@/lib/queries/batched";
import type { SourceReach, SourceUsage } from "@/lib/queries/screens";
import { getBrowserSupabase } from "@/lib/supabase/client";

// =====================================================================
// SOURCE DETAIL READS: the same answers as the shared screen hooks, read
// for this one file only. The file's live claims are read once and shared
// by the articles and the reach lists, instead of once per list.
// Keys start with ["table", <table>] so invalidating a table refreshes them.
// =====================================================================

const unique = (ids: readonly (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();

// THE FILE'S KNOWLEDGE AND ARTICLE COUNTS (one row of source_usage). Keyed under units, like the list's
export function useOneSourceUsage(sourceId: string): UseQueryResult<SourceUsage | null> {
  return useQuery({
    queryKey: [...queryKeys.table("units"), "source-usage", "with-used-units", sourceId],
    queryFn: async () => {
      const { data, error } = await getBrowserSupabase().from("source_usage").select("unit_count, used_unit_count, article_count, line_count, section_count").eq("source_id", sourceId).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { units: data.unit_count ?? 0, usedUnits: data.used_unit_count ?? 0, articles: data.article_count ?? 0, sections: data.section_count ?? 0, lines: data.line_count ?? 0 };
    },
  });
}

// THE FILE'S LIVE CLAIMS: units whose current version cites it, not retired
function useLiveSourceUnitIds(sourceId: string): UseQueryResult<string[]> {
  return useQuery({
    queryKey: [...queryKeys.table("units"), "source-live-ids", sourceId],
    queryFn: async () => {
      const client = getBrowserSupabase();
      const links = await readPages((from, to) => client.from("source_units").select("unit_id").eq("source_id", sourceId).order("unit_id").range(from, to));
      const units = await readIdBatches(unique(links.map((link) => link.unit_id)), (batch) => readPages((from, to) =>
        client.from("units").select("id").in("id", batch).is("retired_at", null).order("id").range(from, to)));
      return units.map((unit) => unit.id);
    },
  });
}

// ARTICLES BUILT FROM THE FILE: live pages with a live section built on its live claims, by title
export function useSourceArticles(sourceId: string): { data: Row<"pages">[] | undefined; isPending: boolean; error: Error | null } {
  const units = useLiveSourceUnitIds(sourceId);
  const ids = units.data;
  const articles = useQuery({
    queryKey: [...queryKeys.table("units"), "source-articles", sourceId, ids],
    enabled: Boolean(ids),
    queryFn: async () => {
      const client = getBrowserSupabase();
      if (!ids?.length) return [];
      const inputs = await readIdBatches(ids, (batch) => readPages((from, to) =>
        client.from("section_inputs").select("section_id,unit_id").in("unit_id", batch).order("section_id").order("unit_id").range(from, to)));
      const sectionIds = unique(inputs.map((input) => input.section_id));
      if (sectionIds.length === 0) return [];
      const sections = await readIdBatches(sectionIds, (batch) => readPages((from, to) =>
        client.from("sections").select("page_id").in("id", batch).is("retired_at", null).order("id").range(from, to)));
      const pageIds = unique(sections.map((section) => section.page_id));
      if (pageIds.length === 0) return [];
      const pages = await readIdBatches(pageIds, (batch) => readPages((from, to) =>
        client.from("pages").select("*").in("id", batch).is("retired_at", null).order("id").range(from, to)));
      return pages.sort((a, b) => a.title.localeCompare(b.title));
    },
  });
  const error = units.error ?? articles.error;
  return { data: articles.data, isPending: !articles.data && !error, error };
}

// Glossary definitions citing the file; a term repeated across scopes is listed once
async function readSourceDefinitions(sourceId: string): Promise<SourceReach["definitions"]> {
  const glossary = await getBrowserSupabase().from("glossary_state").select("entries").eq("id", true).maybeSingle();
  if (glossary.error) throw glossary.error;
  const entries = (glossary.data?.entries ?? []) as unknown as { term: string; definition: string; citations?: { sourceId: string }[] }[];
  const byTerm = new Map<string, { term: string; definition: string }>();
  for (const { term, definition, citations } of entries) {
    if (citations?.some((cite) => cite.sourceId === sourceId) && !byTerm.has(term.toLowerCase())) byTerm.set(term.toLowerCase(), { term, definition });
  }
  return [...byTerm.values()].sort((a, b) => a.term.localeCompare(b.term));
}

// DEFINITIONS, ENTITIES AND DOMAINS FROM THE FILE: the glossary is read while the claims load
export function useSourceReach(sourceId: string): { data: SourceReach | undefined; isPending: boolean; error: Error | null } {
  const units = useLiveSourceUnitIds(sourceId);
  const ids = units.data;
  const definitions = useQuery({
    queryKey: [...queryKeys.table("units"), "source-definitions", sourceId],
    queryFn: () => readSourceDefinitions(sourceId),
  });
  const filed = useQuery({
    queryKey: [...queryKeys.table("units"), "source-filed", sourceId, ids],
    enabled: Boolean(ids),
    queryFn: async (): Promise<Omit<SourceReach, "definitions">> => {
      const client = getBrowserSupabase();
      if (!ids?.length) return { entities: [], domains: [] };
      const [entityLinks, domainLinks] = await Promise.all([
        readIdBatches(ids, (batch) => readPages((from, to) => client.from("unit_entities").select("entity_id").in("unit_id", batch).order("unit_id").order("entity_id").order("role").range(from, to))),
        readIdBatches(ids, (batch) => readPages((from, to) => client.from("unit_domains").select("domain_id").in("unit_id", batch).order("unit_id").order("domain_id").range(from, to))),
      ]);
      const [entities, domains] = await Promise.all([
        readIdBatches(unique(entityLinks.map((link) => link.entity_id)), (batch) => readPages<Row<"entities">>((from, to) =>
          client.from("entities").select("*").in("id", batch).is("retired_at", null).is("merged_into_id", null).order("id").range(from, to))),
        readIdBatches(unique(domainLinks.map((link) => link.domain_id)), (batch) => readPages<Row<"domains">>((from, to) =>
          client.from("domains").select("*").in("id", batch).is("retired_at", null).order("id").range(from, to))),
      ]);
      return {
        entities: entities.sort((a, b) => a.name.localeCompare(b.name)),
        domains: domains.sort((a, b) => a.path.localeCompare(b.path)),
      };
    },
  });
  const error = units.error ?? definitions.error ?? filed.error;
  const data = definitions.data && filed.data ? { definitions: definitions.data, ...filed.data } : undefined;
  return { data, isPending: !data && !error, error };
}
