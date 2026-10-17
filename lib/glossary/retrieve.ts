import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";
import type { Reference } from "@/lib/chatbot/types";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import { contextRelevance } from "@/lib/knowledge/contextSelection";
import { glossaryAnchor } from "./entries";
import type { GlossaryMatch } from "./embeddingStore";

// Vector results are candidates, not authority. Recheck every cited claim and source
// using the signed-in reader before exposing generated text to the assistant.
export async function glossaryReferences(client: SupabaseClient<Database>, matches: GlossaryMatch[], contextEntity?: { type: string; key: string }): Promise<Reference[]> {
  if (!matches.length) return [];
  const citations = matches.flatMap((match) => match.entry.citations);
  const units = await client.from("units").select("id,current_revision_id").in("id", [...new Set(citations.map((cite) => cite.unitId))]).is("retired_at", null);
  if (units.error) throw units.error;
  const revisions = await client.from("revisions").select("id,knowledge_context").in("id", (units.data ?? []).map((unit) => unit.current_revision_id));
  if (revisions.error) throw revisions.error;
  const sources = await client.from("sources").select("id").in("id", [...new Set(citations.map((cite) => cite.sourceId))]).is("archived_at", null).is("replaced_by_id", null);
  if (sources.error) throw sources.error;
  const current = new Map((units.data ?? []).map((unit) => [unit.id, unit.current_revision_id]));
  const contexts = new Map((revisions.data ?? []).map((revision) => [revision.id, parseKnowledgeContext(revision.knowledge_context)]));
  const activeSources = new Set((sources.data ?? []).map((source) => source.id));
  return matches.filter(({ entry }) => entry.citations.length > 0 && entry.citations.every((cite) => {
    if (current.get(cite.unitId) !== cite.revisionId || !activeSources.has(cite.sourceId)) return false;
    if (!contextEntity) return true;
    const context = contexts.get(cite.revisionId);
    return context && contextRelevance(context, contextEntity) !== "excluded";
  })).slice(0, 6).map(({ entry }, index) => ({
    id: `G${index + 1}`, title: entry.expansion ? `${entry.term} — ${entry.expansion}` : entry.term,
    href: `/glossary#${encodeURIComponent(glossaryAnchor(entry.term))}`, kind: "Glossary",
    text: `AI-generated dictionary meaning, supported by saved sources. ${entry.usageNotes !== undefined ? "Local practices apply only to the explicitly attributed usage notes." : entry.context ? `Scope: ${entry.context}.` : "Do not infer organizational applicability from a term definition."}\n${entry.definition}\n${entry.usageNotes?.map((note) => `Usage (${note.context}): ${note.text}`).join("\n") ?? ""}\nSources: ${[...new Set(entry.citations.map((cite) => cite.sourceTitle))].join("; ")}`,
  }));
}
