import "server-only";
import { getServerSupabase } from "@/lib/supabase/server";
import { similarPassages } from "@/lib/knowledge/embeddingStore";
import type { Embedder } from "@/lib/ai/embeddings";
import type { DbRpc } from "@/lib/db/rpc";
import { searchFilter } from "./validation";
import { rankUnits } from "./rank";
import type { Reference } from "./types";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import { contextDescription, contextRelevance } from "@/lib/knowledge/contextSelection";
import { similarGlossary } from "@/lib/glossary/embeddingStore";
import { glossaryReferences } from "@/lib/glossary/retrieve";
import { compositesFor, stepsText } from "./composites";
import { queryText } from "@/lib/ai/queryText";

export async function retrieve(question: string, db: DbRpc, embedder: Embedder, entityId?: string) {
  const client = await getServerSupabase();
  const selected = entityId ? await client.from("entities").select("id,type,key,name").eq("id", entityId).is("merged_into_id", null).single() : null;
  if (selected?.error) throw selected.error;
  const contextEntity = selected?.data ?? undefined;
  const references: Reference[] = [];
  let warning: string | null = null;
  let queryVector: number[] | undefined;
  try {
    const [vector] = await embedder.embed([queryText(embedder.model, "knowledge", question)]);
    if (!vector) throw new Error("No query embedding returned.");
    queryVector = vector;
  } catch { warning = "Semantic search is unavailable; this answer uses text matches only."; }
  const ranked = await rankUnits(question, { db, client, embedder, entity: contextEntity, vector: queryVector ?? null });
  warning = ranked.warning ?? warning;
  if (queryVector) {
    try {
      const glossary = await similarGlossary(db, embedder.model, queryVector, 8);
      references.push(...await glossaryReferences(client, glossary, contextEntity));
    } catch { warning = warning ?? "Glossary matches are temporarily unavailable; other saved evidence is still included."; }
  }
  const candidateIds = ranked.unitIds;
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
      // A procedure or list comes with its steps in order; a matched step brings its procedure along
      const composites = await compositesFor(client, eligible.map(r => r.unit_id));
      const shown = new Set(eligible.map(r => r.unit_id));
      const parents = [...composites.values()].filter(composite => !shown.has(composite.unitId)).filter(composite => {
        const context = parseKnowledgeContext(composite.knowledgeContext);
        return !contextEntity || (context && contextRelevance(context, contextEntity) !== "excluded");
      }).slice(0, 4);
      const knowledge = [...eligible.map(r => ({ unitId: r.unit_id, title: r.title, content: r.content, knowledgeContext: r.knowledge_context })),
        ...parents.map(composite => ({ unitId: composite.unitId, title: composite.title, content: composite.content, knowledgeContext: composite.knowledgeContext }))];
      for (const r of knowledge) {
        const context = parseKnowledgeContext(r.knowledgeContext);
        const composite = composites.get(r.unitId);
        const steps = composite ? stepsText(composite).slice(0, 4000) : "";
        references.push({ id: `K${references.length + 1}`, title: r.title || "Knowledge", href: `/units/${r.unitId}`, kind: "Knowledge", text: `${context ? contextDescription(context) : "Applicability unspecified"}\n${r.content.slice(0, 2400)}${steps}` });
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
  // Source text by meaning, for what no claim covers; scoped answers stay with verified claims (see above)
  if (queryVector && !contextEntity) {
    try {
      const passages = await similarPassages(db, embedder.model, queryVector, 8, 0.45);
      await addSources(passages.map((passage) => ({ source_id: passage.sourceId, text: passage.text })));
    }
    catch { warning = warning ?? "Source passage matches are temporarily unavailable; other saved evidence is still included."; }
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
