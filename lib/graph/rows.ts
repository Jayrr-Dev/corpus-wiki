import type { PostgrestError } from "@supabase/supabase-js";
import type { Enums } from "@/lib/database/types";
import type { BrowserSupabase } from "@/lib/supabase/client";
import type { RelationshipType } from "./types";

// =====================================================================
// GRAPH ROWS: the columns the graph needs from nine tables, read in
// parallel. Live rows only (retired units and links, merged entities
// are left out). PostgREST caps a response at 1,000 rows, so every
// table is read page by page until a short page comes back.
// =====================================================================

// ROW SHAPES (only the columns the graph uses)
export interface GraphRows {
  units: { id: string; kind: Enums<"unit_kind">; epistemic_status: Enums<"epistemic_status">; current_revision_id: string; created_at: string }[];
  revisions: { id: string; content: string; title?: string | null }[];
  relationships: { id: string; from_unit_id: string; to_unit_id: string; type: RelationshipType }[];
  entities: { id: string; name: string; created_at: string }[];
  unitEntities: { unit_id: string; entity_id: string }[];
  domains: { id: string; path: string; parent_id?: string | null; context_entity_id?: string | null }[];
  unitDomains: { unit_id: string; domain_id: string }[];
  pages: { id: string; title: string; slug: string; created_at: string; entity_id: string | null; domain_id: string | null }[];
  sections: { id: string; page_id: string }[];
  sectionInputs: { section_id: string; unit_id: string }[];
}

// PAGE SIZE: PostgREST's default row cap
const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: PostgrestError | null }>;

// Reads every page of one ordered query; throws the PostgREST error so TanStack Query shows it
async function readAllPages<T>(readPage: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await readPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

// Reads all nine tables at once (a stable order keeps the pages from overlapping)
export async function fetchGraphRows(client: BrowserSupabase): Promise<GraphRows> {
  const [units, revisions, relationships, entities, unitEntities, domains, unitDomains, pages, sections, sectionInputs] =
    await Promise.all([
      readAllPages((from, to) =>
        client.from("units").select("id, kind, epistemic_status, current_revision_id, created_at").is("retired_at", null).order("id").range(from, to),
      ),
      readAllPages((from, to) => client.from("revisions").select("id, content, title").order("id").range(from, to)),
      readAllPages((from, to) =>
        client.from("relationships").select("id, from_unit_id, to_unit_id, type").is("retired_at", null).order("id").range(from, to),
      ),
      readAllPages((from, to) =>
        client.from("entities").select("id, name, created_at").is("merged_into_id", null).order("id").range(from, to),
      ),
      readAllPages((from, to) => client.from("unit_entities").select("unit_id, entity_id").order("unit_id").order("entity_id").range(from, to)),
      readAllPages((from, to) => client.from("domains").select("id, path, parent_id, context_entity_id").order("id").range(from, to)),
      readAllPages((from, to) => client.from("unit_domains").select("unit_id, domain_id").order("unit_id").order("domain_id").range(from, to)),
      readAllPages((from, to) =>
        client.from("pages").select("id, title, slug, created_at, entity_id, domain_id").is("retired_at", null).order("id").range(from, to),
      ),
      readAllPages((from, to) => client.from("sections").select("id, page_id").is("retired_at", null).order("id").range(from, to)),
      readAllPages((from, to) =>
        client.from("section_inputs").select("section_id, unit_id").order("section_id").order("unit_id").range(from, to),
      ),
    ]);
  return { units, revisions, relationships, entities, unitEntities, domains, unitDomains, pages, sections, sectionInputs };
}
