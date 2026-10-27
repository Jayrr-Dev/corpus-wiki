"use client";

import type { Structure } from "@/lib/ai/types";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import { typeOwnsContext } from "@/lib/knowledge/entityTypes";
import { toEvidence } from "@/lib/knowledge/evidence";
import { knowledgeLabel } from "@/lib/knowledge/label";
import { readAllPages } from "@/components/graph/readAllPages";
import { readIdBatches, readPages } from "@/lib/queries/batched";
import { fetchRows, queryKeys, type ListOptions, type Row, type TableName } from "@/lib/queries";
import type { UnitSummary } from "@/lib/queries/screens";
import { getBrowserSupabase, type BrowserSupabase } from "@/lib/supabase/client";
import { type QueryClient, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

// =====================================================================
// EVERY UNIT WITH ITS CONTENT, read in a few whole-table pages.
// `useUnitSummaries()` in lib/queries/screens.ts filters each join table
// by unit id in batches of 100, which is one request per 100 units per
// table. For the whole collection a plain paged read of each table
// returns the same rows in far fewer requests, and the join tables are
// read through the same cache entries as `useUnitEntities()` and
// `useUnitDomains()`, so the units screen reads each of them once.
// Same query key as `useUnitSummaries()`, so both share one cache entry.
// =====================================================================

type UnitWithRevision = Row<"units"> & { current_revision: Row<"revisions"> | null };

// A whole-table list through the shared cache (an in-flight read is joined, not repeated)
function cachedList<T extends TableName>(queryClient: QueryClient, client: BrowserSupabase, table: T, options: ListOptions<T>, staleTime?: number): Promise<Row<T>[]> {
  return queryClient.fetchQuery({ queryKey: queryKeys.list(table, options), queryFn: () => fetchRows(client, table, options), staleTime });
}

// The same rows and order as fetchRows(table) for a join table, but a page of 1,000 rows
// (one request where fetchRows makes two in a row), under the same cache key
function cachedJoin(queryClient: QueryClient, client: BrowserSupabase, table: "unit_entities" | "unit_domains"): Promise<Row<typeof table>[]> {
  const order = table === "unit_entities" ? ["unit_id", "entity_id", "role"] : ["unit_id", "domain_id"];
  return queryClient.fetchQuery({
    queryKey: queryKeys.list(table, {}),
    queryFn: () => readAllPages((from, to) => order.reduce((query, column) => query.order(column), client.from(table).select("*")).range(from, to)),
    staleTime: 0,
  });
}

export async function fetchAllUnitSummaries(client: BrowserSupabase, queryClient: QueryClient): Promise<UnitSummary[]> {
  const [units, links, memberships, evidence, sourceLinks, entities, domains, sources] = await Promise.all([
    // The current revision rides along on its foreign key instead of a second read by id
    readPages<UnitWithRevision>(async (from, to) => {
      const { data, error } = await client.from("units").select("*, current_revision:revisions!units_current_revision_fk(*)")
        .order("last_changed_at", { ascending: false }).order("id").range(from, to);
      return { data: data as unknown as UnitWithRevision[] | null, error };
    }),
    // Join tables are refetched with the units (staleTime 0), as the batched read did
    cachedJoin(queryClient, client, "unit_entities") as Promise<Row<"unit_entities">[]>,
    cachedJoin(queryClient, client, "unit_domains") as Promise<Row<"unit_domains">[]>,
    readPages((from, to) => client.from("unit_evidence").select("unit_id, evidence").order("unit_id").range(from, to)),
    readPages((from, to) => client.from("source_units").select("unit_id, source_id").order("unit_id").order("source_id").range(from, to)),
    // Same keys as useEntities() and useDomains(), which the sidebar has usually read already
    cachedList(queryClient, client, "entities", { orderBy: "name" }),
    cachedList(queryClient, client, "domains", { orderBy: "path" }),
    readPages((from, to) => client.from("sources").select("id, origin").order("id").range(from, to)),
  ]);
  const externalSources = new Set(sources.filter((source) => source.origin === "external").map((source) => source.id));
  const externalUnits = new Set<string>();
  const internalUnits = new Set<string>();
  for (const link of sourceLinks) {
    if (!link.unit_id || !link.source_id) continue;
    (externalSources.has(link.source_id) ? externalUnits : internalUnits).add(link.unit_id);
  }
  const evidenceById = new Map(evidence.flatMap((row) => (row.unit_id ? [[row.unit_id, toEvidence(row.evidence)] as const] : [])));
  const subjectById = new Map(entities.filter((entity) => !entity.merged_into_id && !typeOwnsContext(entity.type)).map((entity) => [entity.id, entity.name]));
  const topicById = new Map(domains.map((topic) => [topic.id, topic]));
  const subjectHint = new Map<string, string>();
  for (const link of links) {
    const name = subjectById.get(link.entity_id);
    if (name && link.role === "subject" && !subjectHint.has(link.unit_id)) subjectHint.set(link.unit_id, name);
  }
  const topicHint = new Map<string, Row<"domains">>();
  for (const link of memberships) {
    const topic = topicById.get(link.domain_id);
    if (topic && topic.path.length > (topicHint.get(link.unit_id)?.path.length ?? -1)) topicHint.set(link.unit_id, topic);
  }
  return units.map<UnitSummary>(({ current_revision: revision, ...unit }) => ({
    ...unit,
    context: parseKnowledgeContext(revision?.knowledge_context),
    sourceOrigin: externalUnits.has(unit.id) && !internalUnits.has(unit.id) ? "external" : "internal",
    content: revision?.content ?? "",
    label: revision?.title?.trim() || knowledgeLabel(revision?.content ?? "", { subject: subjectHint.get(unit.id), topic: topicHint.get(unit.id)?.name }),
    evidence: evidenceById.get(unit.id),
    changedBy: revision ?? undefined,
    structure: (revision?.structure as Structure | null | undefined) ?? null,
  }));
}

// EVERY UNIT WITH CONTENT (the units screens); for an id list use useUnitSummariesByIds(ids)
export function useAllUnitSummaries(): UseQueryResult<UnitSummary[]> {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: [...queryKeys.table("units"), "summaries", null],
    queryFn: () => fetchAllUnitSummaries(getBrowserSupabase(), queryClient),
  });
}

// =====================================================================
// SOME UNITS BY ID, in one round of requests. The batched reader makes
// three rounds (units, then revisions and joins, then the entities,
// domains and sources they name); here the revision, entity and domain
// rows ride along on foreign keys, and source origins come from one small
// read of every source's id and origin (source_units is a view, so it
// cannot embed them), so every request starts at once.
// Same query key as `useUnitSummaries(ids)`.
// =====================================================================

type UnitWithLinks = UnitWithRevision & {
  unit_entities: { entity_id: string; role: string; entities: Pick<Row<"entities">, "name" | "type" | "merged_into_id"> | null }[];
  unit_domains: { domain_id: string; domains: Row<"domains"> | null }[];
};

const BY_ID_SELECT = "*, current_revision:revisions!units_current_revision_fk(*), unit_entities(entity_id, role, entities(name, type, merged_into_id)), unit_domains(domain_id, domains(*))";

export async function fetchUnitSummariesByIds(client: BrowserSupabase, ids: string[]): Promise<UnitSummary[]> {
  const [units, evidence, sourceLinks, sources] = await Promise.all([
    readIdBatches(ids, (batch) => readPages<UnitWithLinks>(async (from, to) => {
      const { data, error } = await client.from("units").select(BY_ID_SELECT).in("id", batch).order("id").range(from, to);
      return { data: data as unknown as UnitWithLinks[] | null, error };
    })),
    readIdBatches(ids, (batch) => readPages((from, to) => client.from("unit_evidence").select("unit_id, evidence").in("unit_id", batch).order("unit_id").range(from, to))),
    readIdBatches(ids, (batch) => readPages((from, to) => client.from("source_units").select("unit_id, source_id").in("unit_id", batch).order("unit_id").order("source_id").range(from, to))),
    readPages((from, to) => client.from("sources").select("id, origin").order("id").range(from, to)),
  ]);
  const externalSources = new Set(sources.filter((source) => source.origin === "external").map((source) => source.id));
  const externalUnits = new Set<string>();
  const internalUnits = new Set<string>();
  for (const link of sourceLinks) {
    if (!link.unit_id || !link.source_id) continue;
    (externalSources.has(link.source_id) ? externalUnits : internalUnits).add(link.unit_id);
  }
  const evidenceById = new Map(evidence.flatMap((row) => (row.unit_id ? [[row.unit_id, toEvidence(row.evidence)] as const] : [])));
  return units
    .sort((a, b) => b.last_changed_at.localeCompare(a.last_changed_at))
    .map<UnitSummary>(({ current_revision: revision, unit_entities: links, unit_domains: memberships, ...unit }) => {
      // Same hints as the batched reader: the first subject by entity id, the deepest domain
      const subject = links
        .filter((link) => link.role === "subject" && link.entities && !link.entities.merged_into_id && !typeOwnsContext(link.entities.type))
        .sort((a, b) => a.entity_id.localeCompare(b.entity_id))[0]?.entities?.name;
      let topic: Row<"domains"> | undefined;
      for (const { domains: domain } of [...memberships].sort((a, b) => a.domain_id.localeCompare(b.domain_id))) {
        if (domain && domain.path.length > (topic?.path.length ?? -1)) topic = domain;
      }
      return {
        ...unit,
        context: parseKnowledgeContext(revision?.knowledge_context),
        sourceOrigin: externalUnits.has(unit.id) && !internalUnits.has(unit.id) ? "external" : "internal",
        content: revision?.content ?? "",
        label: revision?.title?.trim() || knowledgeLabel(revision?.content ?? "", { subject, topic: topic?.name }),
        evidence: evidenceById.get(unit.id),
        changedBy: revision ?? undefined,
        structure: (revision?.structure as Structure | null | undefined) ?? null,
      };
    });
}

// UNITS WITH CONTENT BY ID; an empty list reads nothing
export function useUnitSummariesByIds(ids: readonly (string | null | undefined)[]): UseQueryResult<UnitSummary[]> {
  const list = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
  return useQuery({
    queryKey: [...queryKeys.table("units"), "summaries", list],
    queryFn: () => (list.length === 0 ? Promise.resolve([]) : fetchUnitSummariesByIds(getBrowserSupabase(), list)),
  });
}
