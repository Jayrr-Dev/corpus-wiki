import type { Enums } from "@/lib/database/types";
import type { BrowserSupabase } from "@/lib/supabase/client";
import type { PostgrestError } from "@supabase/supabase-js";
import type { RelationshipType } from "./types";

// =====================================================================
// GRAPH ROWS: the columns the graph needs, read in
// parallel. Live rows only (retired units and links, merged entities
// are left out). PostgREST caps a response at 1,000 rows, so every
// table is read page by page until a short page comes back.
// =====================================================================

// ROW SHAPES (only the columns the graph uses)
export interface GraphRows {
  units: {
    id: string;
    kind: Enums<"unit_kind">;
    epistemic_status: Enums<"epistemic_status">;
    current_revision_id: string;
    created_at: string;
    // Optional so older fixtures still build. Live reads always include it.
    last_changed_at?: string;
  }[];
  revisions: {
    id: string;
    content: string;
    title?: string | null;
    structure?: unknown;
  }[];
  relationships: {
    id: string;
    from_unit_id: string;
    to_unit_id: string;
    type: RelationshipType;
  }[];
  // stakeholder: a visible stakeholder profile says so (the Stakeholders page's rule)
  entities: { id: string; name: string; created_at: string; stakeholder?: boolean }[];
  unitEntities: { unit_id: string; entity_id: string }[];
  domains: {
    id: string;
    path: string;
    parent_id?: string | null;
    context_entity_id?: string | null;
  }[];
  unitDomains: { unit_id: string; domain_id: string }[];
  pages: {
    id: string;
    title: string;
    slug: string;
    created_at: string;
    entity_id: string | null;
    domain_id: string | null;
  }[];
  sections: {
    id: string;
    page_id: string;
    title: string;
    position: number;
    created_at?: string;
  }[];
  sectionInputs: { section_id: string; unit_id: string }[];
  sources: { id: string; origin: string }[];
  sourceUnits: { source_id: string | null; unit_id: string | null }[];
  // Pending article suggestions. Optional so older fixtures still build.
  suggestions?: {
    id: string;
    title: string;
    kind?: "create" | "merge";
    status:
      | "pending"
      | "accepting"
      | "applied"
      | "dismissed"
      | "stale"
      | "failed";
    unit_ids: string[];
  }[];
  // Applied actions that changed, used, moved, or applied a unit. Optional for fixtures.
  touches?: { unit_id: string; at: string }[];
}

// PAGE SIZE: PostgREST's default row cap
const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{
  data: T[] | null;
  error: PostgrestError | null;
}>;

// Reads every page of one ordered query; throws the PostgREST error so TanStack Query shows it
async function readAllPages<T>(
  readPage: (from: number, to: number) => PageResult<T>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await readPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

// Reads all tables at once (a stable order keeps the pages from overlapping)
export async function fetchGraphRows(
  client: BrowserSupabase,
): Promise<GraphRows> {
  const [
    units,
    revisions,
    relationships,
    entities,
    stakeholderIds,
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
    readAllPages((from, to) =>
      client
        .from("units")
        .select(
          "id, kind, epistemic_status, current_revision_id, created_at, last_changed_at",
        )
        .is("retired_at", null)
        .order("id")
        .range(from, to),
    ),
    readAllPages((from, to) =>
      client
        .from("revisions")
        .select("id, content, title, structure")
        .order("id")
        .range(from, to),
    ),
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
    fetchStakeholderIds(client),
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
        .eq("kind", "article")
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
  return {
    units,
    revisions,
    relationships,
    entities: markStakeholders(entities, stakeholderIds),
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

// Actions that count as a knowledge unit being changed, used, moved, or applied.
const UNIT_TOUCH_TYPES = [
  "add_claim",
  "revise_claim",
  "set_epistemic_status",
  "merge_duplicates",
  "place_claim",
  "write_line",
  "revise_line",
] as const;

const RECENT_TOUCH_LIMIT = 200;

// Entities a visible stakeholder profile marks (the Stakeholders page's rule)
export async function fetchStakeholderIds(
  client: BrowserSupabase,
): Promise<Set<string>> {
  const profiles = await readAllPages((from, to) =>
    client
      .from("entity_profiles")
      .select("entity_id")
      .eq("is_stakeholder", true)
      .eq("hidden", false)
      .order("entity_id")
      .range(from, to),
  );
  return new Set(profiles.map((profile) => profile.entity_id));
}

// Flags each entity row the stakeholder profiles name
export function markStakeholders(
  entities: GraphRows["entities"],
  stakeholderIds: ReadonlySet<string>,
): GraphRows["entities"] {
  return entities.map((entity) => ({
    ...entity,
    stakeholder: stakeholderIds.has(entity.id),
  }));
}

// Latest applied actions, mapped to the units they touched. A line cites
// revisions, so those revision ids are resolved to units.
export async function fetchRecentUnitTouches(
  client: BrowserSupabase,
): Promise<{ unit_id: string; at: string }[]> {
  const { data, error } = await client
    .from("actions")
    .select("target_id, type, applied_at, input")
    .eq("outcome", "applied")
    .in("type", [...UNIT_TOUCH_TYPES])
    .order("applied_at", { ascending: false })
    .limit(RECENT_TOUCH_LIMIT);
  if (error) throw error;
  const actions = data ?? [];
  const revisionIds = new Set<string>();
  for (const action of actions) {
    if (action.type !== "write_line" && action.type !== "revise_line") continue;
    for (const id of revisionIdsIn(action.input)) revisionIds.add(id);
  }
  const unitByRevision = new Map<string, string>();
  const ids = [...revisionIds];
  for (let from = 0; from < ids.length; from += 100) {
    const { data: revisions, error: revisionError } = await client
      .from("revisions")
      .select("id, unit_id")
      .in("id", ids.slice(from, from + 100));
    if (revisionError) throw revisionError;
    for (const revision of revisions ?? [])
      unitByRevision.set(revision.id, revision.unit_id);
  }
  const touches: { unit_id: string; at: string }[] = [];
  for (const action of actions) {
    if (!action.applied_at) continue;
    if (action.type === "write_line" || action.type === "revise_line") {
      for (const id of revisionIdsIn(action.input)) {
        const unitId = unitByRevision.get(id);
        if (unitId) touches.push({ unit_id: unitId, at: action.applied_at });
      }
      continue;
    }
    if (action.target_id)
      touches.push({ unit_id: action.target_id, at: action.applied_at });
  }
  return touches;
}

function revisionIdsIn(input: unknown): string[] {
  if (!input || typeof input !== "object" || !("unitRevisionIds" in input))
    return [];
  const ids = input.unitRevisionIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
}
