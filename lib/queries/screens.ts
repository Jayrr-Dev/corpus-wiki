import type { Structure } from "@/lib/ai/types";
import { parseKnowledgeContext, type KnowledgeContext } from "@/lib/knowledge/context";
import { fetchDescribableEntityIds } from "@/lib/knowledge/describableEntities";
import { typeOwnsContext } from "@/lib/knowledge/entityTypes";
import { toEvidence, type Evidence } from "@/lib/knowledge/evidence";
import { knowledgeLabel } from "@/lib/knowledge/label";
import { getBrowserSupabase, type BrowserSupabase } from "@/lib/supabase/client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { readIdBatches, readPages } from "./batched";
import { fetchRowById, fetchRows, type Row } from "./fetchers";
import { queryKeys } from "./keys";

// =====================================================================
// SCREEN READ HOOKS: the reads the table hooks in ./index.ts cannot
// express (id lists, array overlaps, either-side links, polling).
// Keys start with ["table", <table>] so invalidating a table refreshes them.
// =====================================================================

// SHARED SHAPES
// changedBy: who wrote the current revision (a person's profile id, or the AI's model)
// structure: set when the unit is a composite (a procedure, a list) whose members link to it
export type UnitSummary = Row<"units"> & { content: string; context?: KnowledgeContext | null; label?: string; evidence?: Evidence; sourceOrigin?: "internal" | "external"; changedBy?: Pick<Row<"revisions">, "author" | "author_id" | "model_version">; structure?: Structure | null };

// TABLES THAT HAVE A UUID `id` AND ARE READ BY ID LISTS HERE
type ByIdTable = "units" | "revisions" | "line_revisions" | "passages" | "sources" | "entities" | "domains" | "actions" | "change_sets";

// Reads rows by id; an empty list reads nothing
async function fetchByIds<T extends ByIdTable>(client: BrowserSupabase, table: T, ids: readonly string[]): Promise<Row<T>[]> {
  // The generic `from(table)` cannot type `.in("id")`, so the PostgREST filter is written out
  return readIdBatches(ids, (batch) => readPages<Row<T>>(async (from, to) => {
    const { data, error } = await client.from(table).select("*").filter("id", "in", `(${batch.join(",")})`).order("id").range(from, to);
    return { data: data as unknown as Row<T>[] | null, error };
  }));
}

// Sorted, de-duplicated ids so the query key is stable
function uniqueIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
}

// ROWS BY ID LIST (any of the tables above)
export function useRowsByIds<T extends ByIdTable>(table: T, ids: readonly (string | null | undefined)[]): UseQueryResult<Row<T>[]> {
  const list = uniqueIds(ids);
  return useQuery({
    queryKey: [...queryKeys.table(table), "ids", list],
    queryFn: () => fetchByIds(getBrowserSupabase(), table, list),
  });
}

// Reads units (all, or by id) with their current revision's content
export async function fetchUnitSummaries(client: BrowserSupabase, ids: string[] | null): Promise<UnitSummary[]> {
  const units = ids
    ? (await fetchByIds(client, "units", ids)).sort((a, b) => b.last_changed_at.localeCompare(a.last_changed_at))
    : await fetchRows(client, "units", { orderBy: "last_changed_at", ascending: false });
  if (!units.length) return [];
  const unitIds = units.map((unit) => unit.id);
  const [revisions, links, memberships, evidence, sourceLinks] = await Promise.all([
    fetchByIds(client, "revisions", units.map((unit) => unit.current_revision_id)),
    readIdBatches(unitIds, (batch) => readPages((from, to) => client.from("unit_entities").select("unit_id, entity_id, role").in("unit_id", batch).order("unit_id").order("entity_id").order("role").range(from, to))),
    readIdBatches(unitIds, (batch) => readPages((from, to) => client.from("unit_domains").select("unit_id, domain_id").in("unit_id", batch).order("unit_id").order("domain_id").range(from, to))),
    readIdBatches(unitIds, (batch) => readPages((from, to) => client.from("unit_evidence").select("unit_id, evidence").in("unit_id", batch).order("unit_id").range(from, to))),
    readIdBatches(unitIds, (batch) => readPages((from, to) => client.from("source_units").select("unit_id, source_id").in("unit_id", batch).order("unit_id").order("source_id").range(from, to))),
  ]);
  // Read only referenced metadata, once for the whole collection.
  const [subjects, topics, sources] = await Promise.all([
    fetchByIds(client, "entities", uniqueIds(links.map((link) => link.entity_id))),
    fetchByIds(client, "domains", uniqueIds(memberships.map((link) => link.domain_id))),
    fetchByIds(client, "sources", uniqueIds(sourceLinks.map((link) => link.source_id))),
  ]);
  const externalSources = new Set(sources.filter((source) => source.origin === "external").map((source) => source.id));
  const externalUnits = new Set<string>();
  const internalUnits = new Set<string>();
  for (const link of sourceLinks) {
    if (!link.unit_id || !link.source_id) continue;
    (externalSources.has(link.source_id) ? externalUnits : internalUnits).add(link.unit_id);
  }
  const evidenceById = new Map(evidence.map((row) => [row.unit_id, toEvidence(row.evidence)]));
  const subjectById = new Map(subjects.filter((entity)=>!entity.merged_into_id && !typeOwnsContext(entity.type)).map((entity)=>[entity.id, entity.name]));
  const topicById = new Map(topics.map((topic)=>[topic.id, topic]));
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
  const hints = (id: string) => ({
    subject: subjectHint.get(id),
    topic: topicHint.get(id)?.name,
  });
  const contentById = new Map(revisions.map((revision) => [revision.id, revision.content]));
  const titleById = new Map(revisions.map((revision) => [revision.id, revision.title?.trim() || null]));
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  return units.map<UnitSummary>((unit) => ({ ...unit, context: parseKnowledgeContext(revisionById.get(unit.current_revision_id)?.knowledge_context), sourceOrigin: externalUnits.has(unit.id) && !internalUnits.has(unit.id) ? "external" : "internal", content: contentById.get(unit.current_revision_id) ?? "", label: titleById.get(unit.current_revision_id) ?? knowledgeLabel(contentById.get(unit.current_revision_id) ?? "", hints(unit.id)), evidence: evidenceById.get(unit.id), changedBy: revisionById.get(unit.current_revision_id), structure: (revisionById.get(unit.current_revision_id)?.structure as Structure | null | undefined) ?? null }));
}

// UNITS WITH CONTENT: every unit when `ids` is omitted, else just those
export function useUnitSummaries(ids?: readonly (string | null | undefined)[]): UseQueryResult<UnitSummary[]> {
  const list = ids ? uniqueIds(ids) : null;
  return useQuery({
    queryKey: [...queryKeys.table("units"), "summaries", list],
    queryFn: () => (list?.length === 0 ? Promise.resolve([]) : fetchUnitSummaries(getBrowserSupabase(), list)),
  });
}

// Reads a unit's links in both directions, newest first
async function fetchUnitRelationships(client: BrowserSupabase, unitId: string): Promise<Row<"relationships">[]> {
  const { data, error } = await client
    .from("relationships")
    .select("*")
    .or(`from_unit_id.eq.${unitId},to_unit_id.eq.${unitId}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// LINKS OF ONE UNIT (from it and to it)
export function useUnitRelationships(unitId: string): UseQueryResult<Row<"relationships">[]> {
  return useQuery({
    queryKey: [...queryKeys.table("relationships"), "unit", unitId],
    queryFn: () => fetchUnitRelationships(getBrowserSupabase(), unitId),
  });
}

// The passage screen only needs identity, kind, target and citations. Selecting
// the whole row pulls glossary and review snapshots stored on other actions.
export type PassageAction = Pick<Row<"actions">, "id" | "type" | "target_id" | "passage_ids">;

// Reads actions whose evidence includes any of the passages
export async function fetchActionsForPassages(client: BrowserSupabase, passageIds: string[]): Promise<PassageAction[]> {
  const actions = await readIdBatches(passageIds, (batch) => readPages<PassageAction>((from, to) =>
    client.from("actions").select("id,type,target_id,passage_ids").overlaps("passage_ids", batch).order("id").range(from, to)));
  // An action can cite passages in several batches.
  return [...new Map(actions.map((action) => [action.id, action])).values()];
}

// ACTIONS CITING PASSAGES (Source detail: what each passage produced)
export function useActionsForPassages(passageIds: readonly string[]): UseQueryResult<PassageAction[]> {
  const list = uniqueIds(passageIds);
  return useQuery({
    queryKey: [...queryKeys.table("actions"), "passages", list],
    queryFn: () => fetchActionsForPassages(getBrowserSupabase(), list),
  });
}

// Reads the domain links of a list of units
async function fetchUnitDomainsFor(client: BrowserSupabase, unitIds: string[]): Promise<Row<"unit_domains">[]> {
  if (unitIds.length === 0) return [];
  const { data, error } = await client.from("unit_domains").select("*").in("unit_id", unitIds);
  if (error) throw error;
  return data ?? [];
}

// DOMAIN LINKS OF MANY UNITS (Entity detail: the domains its units sit in)
export function useUnitDomainsFor(unitIds: readonly string[]): UseQueryResult<Row<"unit_domains">[]> {
  const list = uniqueIds(unitIds);
  return useQuery({
    queryKey: [...queryKeys.table("unit_domains"), "units", list],
    queryFn: () => fetchUnitDomainsFor(getBrowserSupabase(), list),
  });
}

// ONE SHIFT EVENT, POLLED EVERY SECOND WHILE `isLive` (Upload: watch the pipeline move)
export function useLiveShiftEvent(eventId: string | undefined, isLive: boolean): UseQueryResult<Row<"shift_events"> | null> {
  return useQuery({
    queryKey: queryKeys.row("shift_events", eventId ?? ""),
    queryFn: () => fetchRowById(getBrowserSupabase(), "shift_events", eventId ?? ""),
    enabled: Boolean(eventId),
    refetchInterval: isLive ? 1000 : false,
  });
}

// Reads the ids of units whose current revision cites the file (source_units view)
async function fetchSourceUnitIds(client: BrowserSupabase, sourceId: string): Promise<string[]> {
  const rows = await readPages((from, to) => client.from("source_units").select("unit_id").eq("source_id", sourceId).order("unit_id").range(from, to));
  return uniqueIds(rows.map((row) => row.unit_id));
}

export type SourceUsage = { units: number; articles: number; sections: number; lines: number };

// Reads every file's knowledge, article and line counts (source_usage view), by source id
async function fetchSourceUsage(client: BrowserSupabase): Promise<Map<string, SourceUsage>> {
  const { data, error } = await client.from("source_usage").select("source_id, unit_count, article_count, line_count, section_count");
  if (error) throw error;
  return new Map(
    (data ?? []).flatMap((row) =>
      row.source_id ? [[row.source_id, { units: row.unit_count ?? 0, articles: row.article_count ?? 0, sections: row.section_count ?? 0, lines: row.line_count ?? 0 }] as const] : [],
    ),
  );
}

// KNOWLEDGE AND ARTICLE COUNTS PER FILE (Sources list). Keyed under units so knowledge edits refresh it
export function useSourceUsage(): UseQueryResult<Map<string, SourceUsage>> {
  return useQuery({
    queryKey: [...queryKeys.table("units"), "source-usage", "with-sections"],
    queryFn: () => fetchSourceUsage(getBrowserSupabase()),
  });
}

// KNOWLEDGE LINKED TO A FILE (Source detail). Keyed under units so knowledge edits refresh it
export function useSourceUnitIds(sourceId: string): UseQueryResult<string[]> {
  return useQuery({
    queryKey: [...queryKeys.table("units"), "source", sourceId],
    queryFn: () => fetchSourceUnitIds(getBrowserSupabase(), sourceId),
  });
}

// Reads the live articles built on the file's live knowledge (same join as source_usage.article_count), by title
async function fetchSourceArticles(client: BrowserSupabase, sourceId: string): Promise<Row<"pages">[]> {
  const unitIds = await fetchSourceUnitIds(client, sourceId);
  const units = (await fetchByIds(client, "units", uniqueIds(unitIds))).filter((unit) => !unit.retired_at);
  if (units.length === 0) return [];
  const inputs = await readIdBatches(units.map((unit) => unit.id), (batch) => readPages((from, to) =>
    client.from("section_inputs").select("section_id,unit_id").in("unit_id", batch).order("section_id").order("unit_id").range(from, to)));
  const sectionIds = uniqueIds(inputs.map((input) => input.section_id));
  if (sectionIds.length === 0) return [];
  const sectionRows = await readIdBatches(sectionIds, (batch) => readPages((from, to) =>
    client.from("sections").select("page_id").in("id", batch).is("retired_at", null).order("id").range(from, to)));
  const pageIds = uniqueIds(sectionRows.map((section) => section.page_id));
  if (pageIds.length === 0) return [];
  const pages = await readIdBatches(pageIds, (batch) => readPages((from, to) =>
    client.from("pages").select("*").in("id", batch).is("retired_at", null).order("id").range(from, to)));
  return pages.sort((a, b) => a.title.localeCompare(b.title));
}

// ARTICLES BUILT FROM A FILE (Source detail). Keyed under units, like the article count it lists
export function useSourceArticles(sourceId: string): UseQueryResult<Row<"pages">[]> {
  return useQuery({
    queryKey: [...queryKeys.table("units"), "source-articles", sourceId],
    queryFn: () => fetchSourceArticles(getBrowserSupabase(), sourceId),
  });
}

export type SourceReach = {
  definitions: { term: string; definition: string }[];
  entities: Row<"entities">[];
  domains: Row<"domains">[];
};

// Lists what the file's live knowledge produced: glossary definitions citing the file, and the
// live entities and domains its live claims are filed under, each sorted by name
async function fetchSourceReach(client: BrowserSupabase, sourceId: string): Promise<SourceReach> {
  const glossary = await client.from("glossary_state").select("entries").eq("id", true).maybeSingle();
  if (glossary.error) throw glossary.error;
  const entries = (glossary.data?.entries ?? []) as unknown as { term: string; definition: string; citations?: { sourceId: string }[] }[];
  // A term can repeat across scopes; list it once, since every copy opens the same glossary anchor
  const byTerm = new Map<string, { term: string; definition: string }>();
  for (const { term, definition, citations } of entries) {
    if (citations?.some((cite) => cite.sourceId === sourceId) && !byTerm.has(term.toLowerCase())) byTerm.set(term.toLowerCase(), { term, definition });
  }
  const definitions = [...byTerm.values()].sort((a, b) => a.term.localeCompare(b.term));
  const unitIds = uniqueIds(await fetchSourceUnitIds(client, sourceId));
  const units = (await fetchByIds(client, "units", unitIds)).filter((unit) => !unit.retired_at).map((unit) => unit.id);
  if (units.length === 0) return { definitions, entities: [], domains: [] };
  const [entityLinks, domainLinks] = await Promise.all([
    readIdBatches(units, (batch) => readPages((from, to) => client.from("unit_entities").select("entity_id").in("unit_id", batch).order("unit_id").order("entity_id").order("role").range(from, to))),
    readIdBatches(units, (batch) => readPages((from, to) => client.from("unit_domains").select("domain_id").in("unit_id", batch).order("unit_id").order("domain_id").range(from, to))),
  ]);
  const [entities, domains] = await Promise.all([
    fetchByIds(client, "entities", uniqueIds(entityLinks.map((link) => link.entity_id))),
    fetchByIds(client, "domains", uniqueIds(domainLinks.map((link) => link.domain_id))),
  ]);
  return {
    definitions,
    entities: entities.filter((entity) => !entity.retired_at && !entity.merged_into_id).sort((a, b) => a.name.localeCompare(b.name)),
    domains: domains.filter((domain) => !domain.retired_at).sort((a, b) => a.path.localeCompare(b.path)),
  };
}

// DEFINITIONS, ENTITIES AND DOMAINS FROM A FILE (Source detail). Keyed under units so knowledge edits refresh it
export function useSourceReach(sourceId: string): UseQueryResult<SourceReach> {
  return useQuery({
    queryKey: [...queryKeys.table("units"), "source-reach", sourceId],
    queryFn: () => fetchSourceReach(getBrowserSupabase(), sourceId),
  });
}

// Counts the entities a describe pass would plan (same read as planDescribeBatches)
async function fetchUndescribedEntityCount(client: BrowserSupabase): Promise<number> {
  return (await fetchDescribableEntityIds(client)).length;
}

// ENTITIES A DESCRIBE PASS CAN STILL DESCRIBE (Graph actions). Keyed under entities so describing refreshes it
export function useUndescribedEntityCount(): UseQueryResult<number> {
  return useQuery({
    queryKey: [...queryKeys.table("entities"), "undescribed-count"],
    queryFn: () => fetchUndescribedEntityCount(getBrowserSupabase()),
  });
}
