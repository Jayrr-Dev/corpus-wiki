import "server-only";
import type { Embedder } from "@/lib/ai/embeddings";
import type { SectionQuery } from "@/lib/ai/types";
import type { DbRpc } from "@/lib/db/rpc";
import { similarUnits } from "@/lib/knowledge/embeddingStore";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { pageAndDescendants } from "./pageHierarchy";

const MAX_CANDIDATES = 300;
export type EmptyArticlePage = { id: string; title: string; scope?: string | null; entity_id: string | null; context_entity_id?: string | null };

// An empty article has no section query to expand. Use its saved subject and
// descendants as retrieval hints; the discovery model still checks relevance.
// Never substitute {} here: that would select the entire knowledge base.
export async function emptyArticleCandidates(db: DbRpc, client: AdminSupabase, page: EmptyArticlePage,
  pages: { id: string; parent_page_id?: string | null }[], embedder: Embedder | null): Promise<string[]> {
  const ids = new Set<string>();
  const add = (found: string[]) => { for (const id of found) if (ids.size < MAX_CANDIDATES) ids.add(id); };
  const queries: SectionQuery[] = [];
  const entityId = page.entity_id ?? page.context_entity_id;
  if (entityId) {
    const { data: entity, error } = await client.from("entities").select("type,key").eq("id", entityId).is("retired_at", null).single();
    if (error) throw new Error(error.message);
    if (entity) queries.push({ entity: { type: entity.type, key: entity.key } });
  }
  const children = pageAndDescendants(pages, page.id).filter((id) => id !== page.id);
  if (children.length) {
    const { data, error } = await client.from("sections").select("query").in("page_id", children).eq("mode", "generated").is("retired_at", null).limit(MAX_CANDIDATES);
    if (error) throw new Error(error.message);
    queries.push(...(data ?? []).map((section) => (section.query ?? {}) as SectionQuery));
  }
  for (const query of queries) {
    if (!query.unitIds?.length && !query.entity && !query.domainPaths?.length) continue;
    add(await db.call<string[]>("living_page_query_units", { p_query: query }));
    if (ids.size >= MAX_CANDIDATES) break;
  }
  // Bounded semantic retrieval also works for an unlinked, childless article.
  if (embedder && ids.size < MAX_CANDIDATES) {
    const [vector] = await embedder.embed([`${page.title}\n${page.scope ?? ""}`.slice(0, 6000)]);
    if (vector) add((await similarUnits(db, embedder.model, vector, 40, 0.55)).map((unit) => unit.unitId));
  }
  return [...ids];
}
