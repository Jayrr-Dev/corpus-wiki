import "server-only";
import { addUsage, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import type { DraftAction } from "@/lib/ai/types";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { articleActions, articleSections, type ArticleKnowledge } from "./articlePlan";
import { buildOutline, OUTLINE_POLICY_VERSION, type Attempt } from "./outlineBuilder";
import type { PageCandidate } from "./proposePages";
import { skillInstructions, skillTrace } from "@/lib/ai/skills/prompt";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import { contextRelevance } from "@/lib/knowledge/contextSelection";
import { supabaseRpc } from "@/lib/db/rpc";
import { overviewActions } from "./organizationOverview";
import { organizationOverviewPlan } from "./refreshOrganizationOverviews";
import { readIdBatches, readPages } from "@/lib/queries/batched";

export type PagePlanner = ((candidates: PageCandidate[]) => Promise<TokenUsage & { actions: DraftAction[] }>) & { promptVersion?: string; model?: string };

export class NoArticleClaimsError extends Error {
  constructor() { super("This page has no claims to organize yet."); }
}

export async function loadArticleKnowledge(client: AdminSupabase, entityId: string): Promise<ArticleKnowledge> {
  const { data: entity, error: entityError } = await client.from("entities").select("id, type, key, name").eq("id", entityId).single();
  if (entityError) throw new Error(entityError.message);
  const unitIds = await supabaseRpc(client).call<string[]>("living_page_query_units", { p_query: { entity: { type: entity.type, key: entity.key } } });
  if (!unitIds.length) throw new NoArticleClaimsError();
  const units = await readIdBatches(unitIds,(batch)=>readPages((from,to)=>client.from("units").select("id, current_revision_id, kind, epistemic_status").in("id", batch).is("retired_at", null).order("id").range(from,to)));
  units.sort((a,b)=>a.id.localeCompare(b.id));
  const revisions = await readIdBatches(units.map((unit)=>unit.current_revision_id),(batch)=>readPages((from,to)=>client.from("revisions").select("id, content, knowledge_context").in("id", batch).order("id").range(from,to)));
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  // Steps and items of a composite on this page, so the outline keeps them with it
  const memberships = await readIdBatches(unitIds,(batch)=>readPages((from,to)=>client.from("relationships").select("from_unit_id, to_unit_id")
    .eq("type", "part_of").is("retired_at", null).in("from_unit_id", batch).order("from_unit_id").order("to_unit_id").range(from,to)));
  const included = new Set(units.map(unit=>unit.id));
  const memberOf = new Map(memberships.filter(link=>included.has(link.to_unit_id)).map((link) => [link.from_unit_id, link.to_unit_id]));
  return { entity, units: units.flatMap((unit) => {
    const revision = byId.get(unit.current_revision_id);
    const context = parseKnowledgeContext(revision?.knowledge_context);
    if (context && contextRelevance(context, entity) === "excluded") return [];
    const composite = memberOf.get(unit.id);
    return [{ unitId: unit.id, revisionId: unit.current_revision_id, content: revision?.content ?? "", context, kind: unit.kind, epistemicStatus: unit.epistemic_status, ...(composite ? { memberOf: composite } : {}) }];
  }) };
}

// Both automatic planning and explicit updates use the reviewed evidence-led builder.
export async function planArticle(settings: TokenFactorySettings, knowledge: ArticleKnowledge, subject?: string, editorialNote?: string, options: { onAttempt?: (attempt: Attempt) => void } = {}) {
  const result = await buildOutline(settings, knowledge, {
    subject, editorialNote, systemInstructions: skillInstructions(["plan_articles"], settings.skills), onAttempt: options.onAttempt,
  });
  const rationale = result.attempts.at(-1)?.readingOrderRationale;
  return { plan: result.plan, ...(rationale ? { rationale } : {}), tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

// A small topic needs no separate opening: with one body section, the introduction's claims open that section.
export function topicSections(plan: Parameters<typeof articleSections>[0], knowledge: ArticleKnowledge) {
  const sections = articleSections(plan, knowledge);
  if (sections.length !== 2) return sections;
  const [intro, body] = sections as [typeof sections[number], typeof sections[number]];
  return [{ ...body, query: { ...body.query, unitIds: [...(intro.query.unitIds ?? []), ...(body.query.unitIds ?? [])] } }];
}

// Refreshes existing entity pages after uploads, and runs the explicit Improve article command. Handwritten sections are kept.
export function createArticlePlanner(settings: TokenFactorySettings, client: AdminSupabase, force = false): PagePlanner {
  const planner: PagePlanner = async (candidates) => {
    const actions: DraftAction[] = [];
    let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
    for (const candidate of candidates) {
      if (candidate.claimCount < 2) continue;
      // New articles come only from the Article Orchestrator, after independent review
      const pageId = candidate.page?.pageId ?? null;
      if (!pageId) continue;
      let replaceIds: string[] = [];
      {
        // A reviewed article keeps its approved title and scope; the orchestrator adds to it
        const { data: typed, error: typeError } = await client.from("pages").select("article_type").eq("id", pageId).single();
        if (typeError) throw new Error(typeError.message);
        if (typed.article_type && !force) continue;
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
      // An organization's page with pages under it is an overview: it keeps its name and only its own claims
      const overview = await organizationOverviewPlan(settings, client, supabaseRpc(client), pageId);
      if (overview) {
        usage = addUsage(usage, overview);
        actions.push(...overviewActions(pageId, overview.sections, replaceIds));
        continue;
      }
      const knowledge = await loadArticleKnowledge(client, candidate.entityId);
      const { plan, ...planUsage } = await planArticle(settings, knowledge);
      usage = addUsage(usage, planUsage);
      actions.push(...articleActions(plan, knowledge, pageId, replaceIds));
    }
    return { actions, ...usage };
  };
  planner.promptVersion = skillTrace(OUTLINE_POLICY_VERSION,["plan_articles"],settings.skills);
  planner.model = settings.model;
  return planner;
}
