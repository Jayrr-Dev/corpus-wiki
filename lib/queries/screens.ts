import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getBrowserSupabase, type BrowserSupabase } from "@/lib/supabase/client";
import { fetchRowById, type Row } from "./fetchers";
import { type Evidence, toEvidence } from "@/lib/knowledge/evidence";
import { knowledgeLabel } from "@/lib/knowledge/label";
import { fetchDescribableEntityIds } from "@/lib/knowledge/describableEntities";
import { queryKeys } from "./keys";
import { parseKnowledgeContext, type KnowledgeContext } from "@/lib/knowledge/context";

// =====================================================================
// SCREEN READ HOOKS: the reads the table hooks in ./index.ts cannot
// express (id lists, array overlaps, either-side links, polling).
// Keys start with ["table", <table>] so invalidating a table refreshes them.
// =====================================================================

// SHARED SHAPES
// changedBy: who wrote the current revision (a person's profile id, or the AI's model)
export type UnitSummary = Row<"units"> & { content: string; context?: KnowledgeContext | null; label?: string; evidence?: Evidence; sourceOrigin?: "internal" | "external"; changedBy?: Pick<Row<"revisions">, "author" | "author_id" | "model_version"> };

// TABLES THAT HAVE A UUID `id` AND ARE READ BY ID LISTS HERE
type ByIdTable = "units" | "revisions" | "line_revisions" | "passages" | "sources" | "entities" | "domains" | "actions" | "change_sets";

// Reads rows by id; an empty list reads nothing
async function fetchByIds<T extends ByIdTable>(client: BrowserSupabase, table: T, ids: readonly string[]): Promise<Row<T>[]> {
  if (ids.length === 0) return [];
  // The generic `from(table)` cannot type `.in("id")`, so the PostgREST filter is written out
  const { data, error } = await client.from(table).select("*").filter("id", "in", `(${ids.join(",")})`);
  if (error) throw error;
  return (data ?? []) as unknown as Row<T>[];
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
async function fetchUnitSummaries(client: BrowserSupabase, ids: string[] | null): Promise<UnitSummary[]> {
  let query = client.from("units").select("*").order("last_changed_at", { ascending: false });
  if (ids) query = query.in("id", ids);
  const { data, error } = await query;
  if (error) throw error;
  const units = (data ?? []) as Row<"units">[];
  if (!units.length) return [];
  const revisions = await fetchByIds(client, "revisions", units.map((unit) => unit.current_revision_id));
  const [links, memberships, subjects, topics, evidence, sourceLinks, sources] = await Promise.all([
    client.from("unit_entities").select("unit_id, entity_id, role").in("unit_id", units.map((unit)=>unit.id)),
    client.from("unit_domains").select("unit_id, domain_id").in("unit_id", units.map((unit)=>unit.id)),
    client.from("entities").select("id, name, type").is("merged_into_id", null),
    client.from("domains").select("id, name, path"),
    ids ? client.from("unit_evidence").select("unit_id, evidence").in("unit_id", ids) : client.from("unit_evidence").select("unit_id, evidence"),
    client.from("source_units").select("unit_id, source_id").in("unit_id", units.map((unit) => unit.id)),
    client.from("sources").select("id, origin"),
  ]);
  for (const result of [sourceLinks, sources]) if (result.error) throw result.error;
  const externalSources = new Set((sources.data ?? []).filter((source) => source.origin === "external").map((source) => source.id));
  const externalUnits = new Set<string>();
  const internalUnits = new Set<string>();
  for (const link of sourceLinks.data ?? []) {
    if (!link.unit_id || !link.source_id) continue;
    (externalSources.has(link.source_id) ? externalUnits : internalUnits).add(link.unit_id);
  }
  for (const result of [links,memberships,subjects,topics,evidence]) if (result.error) throw result.error;
  const evidenceById = new Map((evidence.data ?? []).map((row) => [row.unit_id, toEvidence(row.evidence)]));
  const subjectById = new Map((subjects.data ?? []).filter((entity)=>!["company","organization","person","project","team","product"].includes(entity.type)).map((entity)=>[entity.id, entity.name]));
  const topicById = new Map((topics.data ?? []).map((topic)=>[topic.id, topic]));
  const hints = (id: string) => ({
    subject: (links.data ?? []).filter((link)=>link.unit_id===id && link.role==="subject").map((link)=>subjectById.get(link.entity_id)).find(Boolean),
    topic: (memberships.data ?? []).filter((link)=>link.unit_id===id).map((link)=>topicById.get(link.domain_id)).filter((topic)=>!!topic).sort((a,b)=>b.path.length-a.path.length)[0]?.name,
  });
  const contentById = new Map(revisions.map((revision) => [revision.id, revision.content]));
  const titleById = new Map(revisions.map((revision) => [revision.id, revision.title?.trim() || null]));
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  return units.map<UnitSummary>((unit) => ({ ...unit, context: parseKnowledgeContext(revisionById.get(unit.current_revision_id)?.knowledge_context), sourceOrigin: externalUnits.has(unit.id) && !internalUnits.has(unit.id) ? "external" : "internal", content: contentById.get(unit.current_revision_id) ?? "", label: titleById.get(unit.current_revision_id) ?? knowledgeLabel(contentById.get(unit.current_revision_id) ?? "", hints(unit.id)), evidence: evidenceById.get(unit.id), changedBy: revisionById.get(unit.current_revision_id) }));
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

// Reads actions whose evidence includes any of the passages
async function fetchActionsForPassages(client: BrowserSupabase, passageIds: string[]): Promise<Row<"actions">[]> {
  if (passageIds.length === 0) return [];
  const { data, error } = await client.from("actions").select("*").overlaps("passage_ids", passageIds);
  if (error) throw error;
  return data ?? [];
}

// ACTIONS CITING PASSAGES (Source detail: what each passage produced)
export function useActionsForPassages(passageIds: readonly string[]): UseQueryResult<Row<"actions">[]> {
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
  const { data, error } = await client.from("source_units").select("unit_id").eq("source_id", sourceId);
  if (error) throw error;
  return (data ?? []).flatMap((row) => (row.unit_id ? [row.unit_id] : []));
}

export type SourceUsage = { units: number; articles: number; lines: number };

// Reads every file's knowledge, article and line counts (source_usage view), by source id
async function fetchSourceUsage(client: BrowserSupabase): Promise<Map<string, SourceUsage>> {
  const { data, error } = await client.from("source_usage").select("source_id, unit_count, article_count, line_count");
  if (error) throw error;
  return new Map(
    (data ?? []).flatMap((row) =>
      row.source_id ? [[row.source_id, { units: row.unit_count ?? 0, articles: row.article_count ?? 0, lines: row.line_count ?? 0 }] as const] : [],
    ),
  );
}

// KNOWLEDGE AND ARTICLE COUNTS PER FILE (Sources list). Keyed under units so knowledge edits refresh it
export function useSourceUsage(): UseQueryResult<Map<string, SourceUsage>> {
  return useQuery({
    queryKey: [...queryKeys.table("units"), "source-usage"],
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
  const inputs = await client.from("section_inputs").select("section_id").in("unit_id", units.map((unit) => unit.id));
  if (inputs.error) throw inputs.error;
  const sectionIds = uniqueIds((inputs.data ?? []).map((input) => input.section_id));
  if (sectionIds.length === 0) return [];
  const sections = await client.from("sections").select("page_id").in("id", sectionIds).is("retired_at", null);
  if (sections.error) throw sections.error;
  const pageIds = uniqueIds((sections.data ?? []).map((section) => section.page_id));
  if (pageIds.length === 0) return [];
  const pages = await client.from("pages").select("*").in("id", pageIds).is("retired_at", null).order("title");
  if (pages.error) throw pages.error;
  return pages.data ?? [];
}

// ARTICLES BUILT FROM A FILE (Source detail). Keyed under units, like the article count it lists
export function useSourceArticles(sourceId: string): UseQueryResult<Row<"pages">[]> {
  return useQuery({
    queryKey: [...queryKeys.table("units"), "source-articles", sourceId],
    queryFn: () => fetchSourceArticles(getBrowserSupabase(), sourceId),
  });
}

export type SourceReach = { definitions: number; entities: number; domains: number };

// Counts what the file's live knowledge produced: glossary definitions citing the file, and the
// live entities and domains its live claims are filed under
async function fetchSourceReach(client: BrowserSupabase, sourceId: string): Promise<SourceReach> {
  const glossary = await client.from("glossary_state").select("entries").eq("id", true).maybeSingle();
  if (glossary.error) throw glossary.error;
  const entries = (glossary.data?.entries ?? []) as unknown as { citations?: { sourceId: string }[] }[];
  const definitions = entries.filter((entry) => entry.citations?.some((cite) => cite.sourceId === sourceId)).length;
  const unitIds = uniqueIds(await fetchSourceUnitIds(client, sourceId));
  const units = (await fetchByIds(client, "units", unitIds)).filter((unit) => !unit.retired_at).map((unit) => unit.id);
  if (units.length === 0) return { definitions, entities: 0, domains: 0 };
  const [entityLinks, domainLinks] = await Promise.all([
    client.from("unit_entities").select("entity_id").in("unit_id", units),
    client.from("unit_domains").select("domain_id").in("unit_id", units),
  ]);
  if (entityLinks.error) throw entityLinks.error;
  if (domainLinks.error) throw domainLinks.error;
  const [entities, domains] = await Promise.all([
    fetchByIds(client, "entities", uniqueIds((entityLinks.data ?? []).map((link) => link.entity_id))),
    fetchByIds(client, "domains", uniqueIds((domainLinks.data ?? []).map((link) => link.domain_id))),
  ]);
  return {
    definitions,
    entities: entities.filter((entity) => !entity.retired_at && !entity.merged_into_id).length,
    domains: domains.filter((domain) => !domain.retired_at).length,
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
