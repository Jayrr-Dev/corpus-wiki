import "server-only";
import { z } from "zod";
import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import type { DraftAction } from "@/lib/ai/types";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { articleActions, articleSections, articlePlanSchema, type ArticleKnowledge } from "./articlePlan";
import type { PageCandidate } from "./proposePages";
import { skillInstructions, skillTrace } from "@/lib/ai/skills/prompt";

export type PagePlanner = ((candidates: PageCandidate[]) => Promise<DraftAction[]>) & { promptVersion?: string };

const PROMPT = `Plan an encyclopedia article from the supplied verified claims.
Choose the title from what the claims are ABOUT, not merely the entity name or file name.
For a company's safety manual, use a title such as "Health and safety program at ExampleCo", not just "ExampleCo".
For a broad company profile, the company name is appropriate. Never invent a broader subject than the evidence supports.
Select 2-6 representative claim refs for a short opening introduction explaining the subject and scope.
Group ALL claims into 2-8 coherent topic sections (fewer for a short article), in a useful reading order.
Use meaningful subject headings such as "Responsibilities", "Protective equipment" and "Incident reporting" when supported.
Do not use storage categories like Facts, Decisions, Definitions, or Preferences as headings.
Each claim must appear in at least one topic section. Refs may also appear in the introduction.
Use only C1, C2, ... from the supplied claims. Return a concise title, introduction refs, and sections with titles and refs.
Do not write prose or citations here; the section writer will write only from the claims assigned to each section.`;

export async function loadArticleKnowledge(client: AdminSupabase, entityId: string): Promise<ArticleKnowledge> {
  const { data: entity, error: entityError } = await client.from("entities").select("id, type, key, name").eq("id", entityId).single();
  if (entityError) throw new Error(entityError.message);
  const { data: links, error: linkError } = await client.from("unit_entities").select("unit_id").eq("entity_id", entityId);
  if (linkError) throw new Error(linkError.message);
  const unitIds = [...new Set((links ?? []).map((link) => link.unit_id))];
  if (!unitIds.length) throw new Error("This page has no claims to organize yet.");
  const { data: units, error: unitError } = await client.from("units").select("id, current_revision_id, kind, epistemic_status").in("id", unitIds).is("retired_at", null).order("id");
  if (unitError) throw new Error(unitError.message);
  const { data: revisions, error: revisionError } = await client.from("revisions").select("id, content").in("id", (units ?? []).map((unit) => unit.current_revision_id));
  if (revisionError) throw new Error(revisionError.message);
  const byId = new Map((revisions ?? []).map((revision) => [revision.id, revision.content]));
  return { entity, units: (units ?? []).map((unit) => ({ unitId: unit.id, revisionId: unit.current_revision_id, content: byId.get(unit.current_revision_id) ?? "", kind: unit.kind, epistemicStatus: unit.epistemic_status })) };
}

export async function planArticle(settings: TokenFactorySettings, knowledge: ArticleKnowledge) {
  if (!knowledge.units.length) throw new Error("This page has no current claims to organize.");
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: `${skillInstructions(["plan_articles"],settings.skills)}\n${PROMPT}` },
    { role: "user", content: JSON.stringify({ entity: knowledge.entity.name, claims: knowledge.units.map((unit, index) => ({ ref: `C${index + 1}`, content: unit.content, status: unit.epistemicStatus })) }) },
  ];
  for (let attempt = 0; ; attempt++) {
    const answer = await chatJson(settings, {
      name: "article_outline", schema: articlePlanSchema, jsonSchema: z.toJSONSchema(articlePlanSchema), maxTokens: 8000, messages,
    });
    try {
      articleSections(answer.value, knowledge);
      return answer.value;
    } catch (error) {
      if (attempt >= 1) throw error;
      messages.push({ role: "user", content: `Your previous outline was ${JSON.stringify(answer.value)}. Validation failed: ${error instanceof Error ? error.message : String(error)}. Return the complete corrected outline, covering every supplied claim in the topic sections. Claims listed only in the introduction must ALSO be assigned to a topic section.` });
    }
  }
}

// Used for new uploads and the explicit Improve article command. Handwritten sections are kept.
export function createArticlePlanner(settings: TokenFactorySettings, client: AdminSupabase, force = false): PagePlanner {
  const planner: PagePlanner = async (candidates) => {
    const actions: DraftAction[] = [];
    for (const candidate of candidates) {
      if (candidate.claimCount < 2) continue;
      const pageId = candidate.page?.pageId ?? null;
      let replaceIds: string[] = [];
      if (pageId) {
        const { data: sections, error } = await client.from("sections").select("id, title, mode, query").eq("page_id", pageId).is("retired_at", null);
        if (error) throw new Error(error.message);
        const generated = (sections ?? []).filter((section) => {
          const query = section.query as Record<string, unknown> | null;
          return section.mode === "generated" && (force || query?.article === true || ["Facts", "Decisions", "How it works", "Definitions", "Preferences"].includes(section.title));
        });
        // A manually designed page is left alone until its owner requests improvement.
        if (!force && generated.length === 0) continue;
        replaceIds = generated.map((section) => section.id);
        if (replaceIds.length) {
          const { data: lines, error: lineError } = await client.from("section_lines").select("section_id, author").in("section_id", replaceIds);
          if (lineError) throw new Error(lineError.message);
          const handwritten = new Set((lines ?? []).filter((line) => line.author === "person").map((line) => line.section_id));
          if (!force && handwritten.size) continue;
          if (handwritten.size) throw new Error("This article has manually edited lines. Keep those sections or move your edits before reorganizing it.");
        }
      }
      const knowledge = await loadArticleKnowledge(client, candidate.entityId);
      const plan = await planArticle(settings, knowledge);
      actions.push(...articleActions(plan, knowledge, pageId, replaceIds));
    }
    return actions;
  };
  planner.promptVersion = skillTrace("article-outline-v2",["plan_articles"],settings.skills);
  return planner;
}
