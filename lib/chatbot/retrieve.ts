import "server-only";
import { getServerSupabase } from "@/lib/supabase/server";
import { cosine } from "@/lib/knowledge/similarity";
import { savedVectors, similarUnits } from "@/lib/knowledge/embeddingStore";
import type { Embedder } from "@/lib/ai/embeddings";
import type { DbRpc } from "@/lib/db/rpc";
import { searchFilter } from "./validation";
import type { Reference } from "./types";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import { contextDescription, contextRelevance } from "@/lib/knowledge/contextSelection";
import { similarGlossary } from "@/lib/glossary/embeddingStore";
import { glossaryReferences } from "@/lib/glossary/retrieve";

export async function retrieve(question: string, db: DbRpc, embedder: Embedder, entityId?: string) {
  const client = await getServerSupabase();
  const selected = entityId ? await client.from("entities").select("id,type,key,name").eq("id", entityId).is("merged_into_id", null).single() : null;
  if (selected?.error) throw selected.error;
  const contextEntity = selected?.data ?? undefined;
  const references: Reference[] = [];
  let warning: string | null = null;
  let matches: Awaited<ReturnType<typeof similarUnits>> = [];
  let queryVector: number[] | undefined;
  try {
    const [vector] = await embedder.embed([question]);
    if (!vector) throw new Error("No query embedding returned.");
    queryVector = vector;
    matches = await similarUnits(db, embedder.model, vector, 12, 0.35);
  } catch { warning = "Semantic search is unavailable; this answer uses text matches only."; }
  if (queryVector) {
    try {
      const glossary = await similarGlossary(db, embedder.model, queryVector, 8);
      references.push(...await glossaryReferences(client, glossary, contextEntity));
    } catch { warning = warning ?? "Glossary matches are temporarily unavailable; other saved evidence is still included."; }
  }
  const filter = searchFilter(["content", "title"], question);
  const lexical = filter ? await client.from("revisions").select("id,unit_id,content,title,passage_ids").or(filter).limit(20) : { data: [], error: null };
  if (lexical.error) throw lexical.error;
  // Search inside the chosen entity before applying result limits. Otherwise global
  // top matches from larger companies can crowd out every relevant scoped claim.
  const scopedCandidates: string[] = [];
  if (contextEntity) {
    const scopeIds = await db.call<string[]>("living_page_query_units", { p_query: { entity: { type: contextEntity.type, key: contextEntity.key } } });
    const scored: { unitId: string; score: number }[] = [];
    for (let start = 0; start < scopeIds.length; start += 200) {
      const scopeUnits = await client.from("units").select("id,current_revision_id").in("id", scopeIds.slice(start, start + 200)).is("retired_at", null);
      if (scopeUnits.error) throw scopeUnits.error;
      const current = scopeUnits.data ?? [];
      const currentIds = current.map(unit => unit.current_revision_id);
      if (!currentIds.length) continue;
      if (filter) {
        const scopedLexical = await client.from("revisions").select("unit_id").in("id", currentIds).or(filter).limit(20);
        if (scopedLexical.error) throw scopedLexical.error;
        scopedCandidates.push(...(scopedLexical.data ?? []).map(row => row.unit_id));
      }
      if (queryVector) {
        try {
          const vectors = await savedVectors(db, embedder.model, currentIds);
          for (const unit of current) {
            const vector = vectors.get(unit.current_revision_id);
            if (!vector || vector.length !== queryVector.length) continue;
            const score = cosine(queryVector, vector);
            if (score >= 0.35) scored.push({ unitId: unit.id, score });
          }
        } catch { warning = "Some scoped semantic matches are unavailable; text matches are still included."; }
      }
    }
    scopedCandidates.unshift(...scored.sort((a, b) => b.score - a.score).slice(0, 12).map(item => item.unitId));
  }
  const candidateIds = [...new Set([...scopedCandidates.slice(0, 32), ...matches.map(m => m.unitId), ...(lexical.data ?? []).map(r => r.unit_id)])];
  if (candidateIds.length) {
    // Recheck vector results through the user's session and current revision before exposing text.
    const units = await client.from("units").select("id,current_revision_id").in("id", candidateIds).is("retired_at", null);
    if (units.error) throw units.error;
    const ids = (units.data ?? []).map(u => u.current_revision_id);
    if (ids.length) {
      const revisions = await client.from("revisions").select("id,unit_id,content,title,passage_ids,knowledge_context").in("id", ids);
      if (revisions.error) throw revisions.error;
      const rank = new Map(candidateIds.map((id, index) => [id, index]));
      const eligible = (revisions.data ?? []).filter(r => {
        const context = parseKnowledgeContext(r.knowledge_context);
        return !contextEntity || (context && contextRelevance(context, contextEntity) !== "excluded");
      }).sort((a, b) => (rank.get(a.unit_id) ?? 0) - (rank.get(b.unit_id) ?? 0)).slice(0, 32);
      for (const r of eligible) {
        const context = parseKnowledgeContext(r.knowledge_context);
        references.push({ id: `K${references.length + 1}`, title: r.title || "Knowledge", href: `/units/${r.unit_id}`, kind: "Knowledge", text: `${context ? contextDescription(context) : "Applicability unspecified"}\n${r.content.slice(0, 2400)}` });
      }
      const passageIds = eligible.flatMap(r => r.passage_ids).slice(0, 40);
      // A source passage can contain several parties' policies; scoped answers use
      // the verified claims, whose unit pages retain the original evidence links.
      if (passageIds.length && !contextEntity) {
        const passages = await client.from("passages").select("source_id,text").in("id", passageIds);
        if (passages.error) throw passages.error;
        await addSources(passages.data ?? []);
      }
      const lines = await client.from("section_lines").select("page_id,content,unit_revision_ids,is_stale").overlaps("unit_revision_ids", eligible.map(r => r.id)).limit(12);
      if (lines.error) throw lines.error;
      const eligibleIds = new Set(eligible.map(r => r.id));
      await addArticles((lines.data ?? []).filter(line => !line.is_stale && (!contextEntity || line.unit_revision_ids?.every(id => eligibleIds.has(id)))));
    }
  }
  const lineFilter = searchFilter(["content"], question);
  if (lineFilter && !contextEntity) {
    const lines = await client.from("section_lines").select("page_id,content").or(lineFilter).limit(8);
    if (lines.error) throw lines.error;
    await addArticles(lines.data ?? []);
    const passages = await client.from("passages").select("source_id,text").or(searchFilter(["text"], question)).limit(8);
    if (passages.error) throw passages.error;
    await addSources(passages.data ?? []);
  }
  return { references: references.slice(0, 32), warning, contextEntity };

  async function addArticles(lines: { page_id: string | null; content: string | null }[]) {
    const ids = [...new Set(lines.flatMap(l => l.page_id ? [l.page_id] : []))];
    if (!ids.length) return;
    const pages = await client.from("pages").select("id,title,slug").in("id", ids).is("retired_at", null);
    if (pages.error) throw pages.error;
    for (const page of pages.data ?? []) {
      const href = `/p/${encodeURIComponent(page.slug)}`;
      if (!references.some(r => r.href === href)) references.push({ id: `A${references.length + 1}`, title: page.title, href, kind: "Article", text: lines.filter(l => l.page_id === page.id).map(l => l.content).join("\n").slice(0, 4000) });
    }
  }
  async function addSources(passages: { source_id: string; text: string }[]) {
    const ids = [...new Set(passages.map(p => p.source_id))];
    if (!ids.length) return;
    const sources = await client.from("sources").select("id,title").in("id", ids).is("archived_at", null).is("replaced_by_id", null);
    if (sources.error) throw sources.error;
    for (const source of sources.data ?? []) {
      const href = `/sources/${source.id}`;
      if (!references.some(r => r.href === href)) references.push({ id: `S${references.length + 1}`, title: source.title, href, kind: "Source", text: passages.filter(p => p.source_id === source.id).map(p => p.text).join("\n").slice(0, 3000) });
    }
  }
}
