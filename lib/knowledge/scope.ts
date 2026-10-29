import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";
import { type GlossaryEntry, visibleGlossaryEntries } from "@/lib/glossary/entries";
import { readGlossaryView } from "@/lib/glossary/storage";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { type KnowledgeContext, parseKnowledgeContext } from "./context";
import type { Coverage, Scope, ScopeOptions } from "./scopeTypes";

export * from "./scopeTypes";

// =====================================================================
// SCOPE CLAIMS: the current claim revisions a scope pulls, for Study,
// Video and Docs (docs/knowledge-modules-plan.md).
//   Topic    claims on the topic and its child topics
//   Article  claims cited by the article's live sections
//   Entity   claims whose knowledge_context names the entity
//   Glossary claims the glossary's terms cite, with their definitions
// Claims come back most central first: cited by the most live sections,
// then newest. The sets are small, so no new indexes (OrioleDB, AGENTS.md).
// =====================================================================

type Client = SupabaseClient<Database>;

// A glossary term a claim supports (Glossary scope only)
export type ScopeTerm = { term: string; definition: string };

// One claim as its current revision; `revisionId` is what generated items store to go stale
export type ScopeClaim = {
  unitId: string;
  revisionId: string;
  title: string | null;
  content: string;
  createdAt: string;
  // live sections that cite the claim (how central it is)
  citedBy: number;
  terms?: ScopeTerm[];
};

// PostgREST puts `in` lists in the URL, so long lists go in chunks
const CHUNK = 200;
async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += CHUNK) {
    const { data, error } = await read(unique.slice(start, start + CHUNK));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

function rowsOf<T>({ data, error }: { data: T[] | null; error: { message: string } | null }): T[] {
  if (error) throw new Error(error.message);
  return data ?? [];
}

// The topic and every live topic under it, by path
export function topicDomainIds(domains: readonly { id: string; path: string }[], rootId: string): string[] {
  const root = domains.find((domain) => domain.id === rootId);
  if (!root) return [];
  return domains.filter((domain) => domain.path === root.path || domain.path.startsWith(`${root.path}/`)).map((domain) => domain.id);
}

// True when a claim's context names the entity, as a party to the claim or where it applies
export function namesEntity(context: KnowledgeContext | null, entity: { type: string; key: string }): boolean {
  if (!context) return false;
  const same = (item: { type: string; key: string }) => item.type === entity.type && item.key === entity.key;
  return context.entities.some(same) || context.applicability.entities.some(same);
}

// Each cited claim's glossary terms, from the entries readers see
export function glossaryTermsByUnit(entries: readonly GlossaryEntry[]): Map<string, ScopeTerm[]> {
  const terms = new Map<string, ScopeTerm[]>();
  for (const entry of entries) {
    const term = { term: entry.expansion ? `${entry.term} (${entry.expansion})` : entry.term, definition: entry.definition };
    const cited = [...entry.citations, ...(entry.usageNotes ?? []).flatMap((note) => note.citations)];
    for (const unitId of new Set(cited.map((cite) => cite.unitId))) terms.set(unitId, [...(terms.get(unitId) ?? []), term]);
  }
  return terms;
}

// Most central first: cited by the most sections, then newest, then a stable order
export function rankScopeClaims<T extends Pick<ScopeClaim, "unitId" | "citedBy" | "createdAt">>(claims: readonly T[]): T[] {
  return [...claims].sort((a, b) => b.citedBy - a.citedBy || b.createdAt.localeCompare(a.createdAt) || a.unitId.localeCompare(b.unitId));
}

// The share of ranked claims a coverage level keeps (rounded up, so a non-empty scope keeps at least one)
export function pickCoverage<T>(ranked: readonly T[], coverage: Coverage): T[] {
  if (coverage >= 100) return [...ranked];
  return ranked.slice(0, Math.ceil((ranked.length * coverage) / 100));
}

// The claims a scope names, before their current revisions are read
async function scopeUnitIds(client: Client, scope: Scope): Promise<{ unitIds: string[]; entity?: { type: string; key: string }; terms?: Map<string, ScopeTerm[]> }> {
  if (scope.kind === "topic") {
    const domains = rowsOf(await client.from("domains").select("id,path").is("retired_at", null));
    const domainIds = topicDomainIds(domains, scope.id);
    const links = await inChunks(domainIds, (chunk) => client.from("unit_domains").select("unit_id").in("domain_id", chunk));
    return { unitIds: links.map((link) => link.unit_id) };
  }
  if (scope.kind === "article") {
    const sections = rowsOf(await client.from("sections").select("id").eq("page_id", scope.id).is("retired_at", null));
    const inputs = await inChunks(sections.map((section) => section.id), (chunk) => client.from("section_inputs").select("unit_id").in("section_id", chunk));
    return { unitIds: inputs.map((input) => input.unit_id) };
  }
  if (scope.kind === "entity") {
    const [entity] = rowsOf(await client.from("entities").select("type,key").eq("id", scope.id));
    if (!entity) return { unitIds: [] };
    const identity = { type: entity.type, key: entity.key };
    // candidates only: the current revision is checked again below
    const [named, scoped] = await Promise.all([
      client.from("revisions").select("unit_id").contains("knowledge_context", { entities: [identity] }),
      client.from("revisions").select("unit_id").contains("knowledge_context", { applicability: { entities: [identity] } }),
    ]);
    return { unitIds: [...rowsOf(named), ...rowsOf(scoped)].map((revision) => revision.unit_id), entity: identity };
  }
  const view = await readGlossaryView(client);
  const entries = visibleGlossaryEntries(view?.entries ?? [], view?.status === "ready" ? [] : view?.live_entries);
  const terms = glossaryTermsByUnit(entries);
  return { unitIds: [...terms.keys()], terms };
}

// SCOPE CLAIMS: the live claims a scope pulls, as their current revisions, most central first
export async function loadScopeClaims(scope: Scope, client: Client = getAdminSupabase()): Promise<ScopeClaim[]> {
  const { unitIds, entity, terms } = await scopeUnitIds(client, scope);
  const units = await inChunks(unitIds, (chunk) => client.from("units").select("id,current_revision_id").in("id", chunk).is("retired_at", null));
  const revisions = await inChunks(units.map((unit) => unit.current_revision_id), (chunk) => client.from("revisions").select("id,unit_id,title,content,created_at,knowledge_context").in("id", chunk));
  const current = entity ? revisions.filter((revision) => namesEntity(parseKnowledgeContext(revision.knowledge_context), entity)) : revisions;
  // centrality: how many live sections cite each claim
  const inputs = await inChunks(current.map((revision) => revision.unit_id), (chunk) => client.from("section_inputs").select("unit_id,section_id").in("unit_id", chunk));
  const liveSections = new Set((await inChunks(inputs.map((input) => input.section_id), (chunk) => client.from("sections").select("id").in("id", chunk).is("retired_at", null))).map((section) => section.id));
  const citedBy = new Map<string, Set<string>>();
  for (const input of inputs) {
    if (!liveSections.has(input.section_id)) continue;
    citedBy.set(input.unit_id, (citedBy.get(input.unit_id) ?? new Set()).add(input.section_id));
  }
  return rankScopeClaims(current.map((revision) => ({
    unitId: revision.unit_id, revisionId: revision.id, title: revision.title, content: revision.content, createdAt: revision.created_at,
    citedBy: citedBy.get(revision.unit_id)?.size ?? 0,
    ...(terms ? { terms: terms.get(revision.unit_id) ?? [] } : {}),
  })));
}

// What the scope picker offers: live topics (by path), articles and entities, by name
export async function loadScopeOptions(client: Client = getAdminSupabase()): Promise<ScopeOptions> {
  const [domains, pages, entities] = await Promise.all([
    client.from("domains").select("id,path").is("retired_at", null).order("path"),
    client.from("pages").select("id,title").is("retired_at", null).not("article_type", "is", null).order("title"),
    client.from("entities").select("id,name").is("retired_at", null).is("merged_into_id", null).order("name"),
  ]);
  return {
    topic: rowsOf(domains).map((domain) => ({ id: domain.id, label: domain.path.replaceAll("/", " › ") })),
    article: rowsOf(pages).map((page) => ({ id: page.id, label: page.title })),
    entity: rowsOf(entities).map((entity) => ({ id: entity.id, label: entity.name })),
  };
}
