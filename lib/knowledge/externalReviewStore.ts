import "server-only";
import type { Json } from "@/lib/database/types";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { ExternalProjectContext, ReviewRecorder } from "./externalApproval";

export async function externalProjectContext(client: AdminSupabase, page: { title: string; context_entity_id?: string | null; entity_id: string | null }, section: string, candidates: { unitId: string; content: string }[]): Promise<ExternalProjectContext> {
  const chosen = [...new Map(candidates.map((unit) => [unit.unitId, unit])).values()].slice(0, 120);
  const entityId = page.context_entity_id ?? page.entity_id;
  const entity = entityId ? await client.from("entities").select("name").eq("id", entityId).single() : { data: null, error: null };
  if (entity.error) throw new Error(entity.error.message);
  const links = chosen.length ? await client.from("source_units").select("unit_id,source_id").in("unit_id", chosen.map((unit) => unit.unitId)) : { data: [], error: null };
  if (links.error) throw new Error(links.error.message);
  const sourceIds = [...new Set((links.data ?? []).flatMap((link) => link.source_id ? [link.source_id] : []))];
  const sources = sourceIds.length ? await client.from("sources").select("id,title,origin").in("id", sourceIds).is("archived_at", null).is("replaced_by_id", null) : { data: [], error: null };
  if (sources.error) throw new Error(sources.error.message);
  const internalIds = new Set((sources.data ?? []).filter((source) => source.origin === "internal").map((source) => source.id));
  const internalUnits = new Set((links.data ?? []).filter((link) => link.source_id && internalIds.has(link.source_id)).map((link) => link.unit_id));
  const activeSourceIds = new Set((sources.data ?? []).map((source) => source.id));
  const citedUnits = new Set((links.data ?? []).map((link) => link.unit_id));
  const activeUnits = new Set((links.data ?? []).filter((link) => link.source_id && activeSourceIds.has(link.source_id)).map((link) => link.unit_id));
  return {
    organization: entity.data?.name ?? null, article: page.title, section,
    sourceTitles: (sources.data ?? []).filter((source) => internalIds.has(source.id)).map((source) => source.title),
    projectFacts: chosen.filter((unit) => internalUnits.has(unit.unitId)).slice(0, 32).map((unit) => unit.content.slice(0, 1000)),
    existingKnowledge: chosen.filter((unit) => !citedUnits.has(unit.unitId) || activeUnits.has(unit.unitId)).slice(0, 60).map((unit) => unit.content.slice(0, 1000)),
  };
}

export function externalReviewRecorder(client: AdminSupabase, pageId: string | null, sectionId: string | null): ReviewRecorder {
  return async (review) => {
    const { data, error } = await client.from("external_source_reviews").insert({
      page_id: pageId, section_id: sectionId, stage: review.stage, outcome: review.outcome,
      context: JSON.parse(JSON.stringify(review.context)) as Json,
      proposal: JSON.parse(JSON.stringify({ ...review.proposal, _attribution: review.attribution })) as Json,
      tokens_in: review.tokensIn ?? null, tokens_out: review.tokensOut ?? null,
      reason: review.reason, url: review.url, source_title: review.sourceTitle, excerpts: review.excerpts, model: review.model,
    }).select("id").single();
    if (error) throw new Error(`External approval could not be recorded: ${error.message}`);
    return data.id;
  };
}
