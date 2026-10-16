import type { getServerSupabase } from "@/lib/supabase/server";
import type { Structure } from "@/lib/ai/types";

type Client = Awaited<ReturnType<typeof getServerSupabase>>;

// A composite (a procedure, a list) with its live steps or items in order
export type CompositeSteps = { unitId: string; revisionId: string; content: string; title: string | null; knowledgeContext: unknown; passageIds: string[]; structure: Structure; steps: string[] };

// THE COMPOSITES BEHIND THESE CLAIMS: the ones among them, and the ones they are steps of,
// each with its steps in order. Read through the person's session, like every other match.
export async function compositesFor(client: Client, unitIds: string[]): Promise<Map<string, CompositeSteps>> {
  if (!unitIds.length) return new Map();
  const parents = await client.from("relationships").select("to_unit_id").eq("type", "part_of").is("retired_at", null).in("from_unit_id", unitIds);
  if (parents.error) throw parents.error;
  const candidates = [...new Set([...unitIds, ...(parents.data ?? []).map((link) => link.to_unit_id)])];
  const units = await client.from("units").select("id,current_revision_id").in("id", candidates).is("retired_at", null);
  if (units.error) throw units.error;
  const revisions = await client.from("revisions").select("id,unit_id,content,title,knowledge_context,passage_ids,structure")
    .in("id", (units.data ?? []).map((unit) => unit.current_revision_id));
  if (revisions.error) throw revisions.error;
  const composites = (revisions.data ?? []).filter((revision) => revision.structure);
  if (!composites.length) return new Map();

  const links = await client.from("relationships").select("from_unit_id,to_unit_id,position,created_at").eq("type", "part_of").is("retired_at", null)
    .in("to_unit_id", composites.map((composite) => composite.unit_id));
  if (links.error) throw links.error;
  const members = await client.from("units").select("id,current_revision_id").in("id", [...new Set((links.data ?? []).map((link) => link.from_unit_id))]).is("retired_at", null);
  if (members.error) throw members.error;
  const memberRevisions = await client.from("revisions").select("id,content").in("id", (members.data ?? []).map((unit) => unit.current_revision_id));
  if (memberRevisions.error) throw memberRevisions.error;
  const revisionOf = new Map((members.data ?? []).map((unit) => [unit.id, unit.current_revision_id]));
  const contentOf = new Map((memberRevisions.data ?? []).map((revision) => [revision.id, revision.content]));
  const ordered = [...(links.data ?? [])].sort((a, b) =>
    (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.created_at.localeCompare(b.created_at));

  return new Map(composites.map((composite) => [composite.unit_id, {
    unitId: composite.unit_id,
    revisionId: composite.id,
    content: composite.content,
    title: composite.title,
    knowledgeContext: composite.knowledge_context,
    passageIds: composite.passage_ids,
    structure: composite.structure as Structure,
    steps: ordered.filter((link) => link.to_unit_id === composite.unit_id)
      .flatMap((link) => contentOf.get(revisionOf.get(link.from_unit_id) ?? "") ?? []),
  }]));
}

// The composite's steps as the model reads them: numbered for a sequence, bulleted for a set
export function stepsText(composite: CompositeSteps): string {
  if (!composite.steps.length) return "";
  const { type, complete, mode } = composite.structure;
  const heading = type === "sequence"
    ? `Steps, in order${complete ? "" : " (the source may list more)"}:`
    : `Items (${mode === "all" ? "all apply" : mode === "any" ? "any one is enough" : "how they combine is not stated"}${complete ? ", the whole list" : ""}):`;
  return `\n${heading}\n${composite.steps.map((step, index) => (type === "sequence" ? `${index + 1}. ${step}` : `- ${step}`)).join("\n")}`;
}
