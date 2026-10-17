"use server";

import type { DraftAction, SectionDraft, UnitKind } from "@/lib/ai/types";
import { loadStageSkills } from "@/lib/ai/skills/server";
import { skillTrace } from "@/lib/ai/skills/prompt";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readAllowExternalKnowledge, readAutoUpdateStale, readModelChoice } from "@/lib/ai/models";
import { webSearchKey } from "@/lib/knowledge/webSearch";
import { type ForceCreateResult, fillThinSectionsFromWeb, forceCreateSection as runForceCreate } from "@/lib/living-page/forceCreateSection";
import { expandEntityKnowledge } from "@/lib/living-page/knowledgeExpansion";
import { orchestrateEntityArticles } from "@/lib/living-page/articleOrchestrator";
import { organizeExistingEntityContext } from "@/lib/living-page/organizeHierarchy";
import { embedderFromEnv } from "@/lib/ai/embeddings";
import { createArticlePlanner } from "@/lib/living-page/articlePlanner";
import { requireUser } from "@/lib/auth/requireUser";
import { type CommitResult, commitPersonEdit, submitChangeSet, commitChangeSet, revertChangeSet } from "@/lib/change-control";
import { rebuildPage, rebuildSection, type SectionRef, type SectionState } from "@/lib/living-page";
import { refreshSectionStyle } from "@/lib/living-page/refreshStyle";
import { refreshOrganizationOverviews } from "@/lib/living-page/refreshOrganizationOverviews";
import { pruneEmptySections } from "@/lib/living-page/pruneEmptySections";
import { restructureUpdate, updateNeedsStructure } from "@/lib/living-page/restructureUpdate";
import { discoverArticleUpdates, repairEmptyIntroductions } from "@/lib/living-page/discoverArticleUpdates";
import { emptyArticleCandidates } from "@/lib/living-page/emptyArticleCandidates";
import { pageAndDescendants } from "@/lib/living-page/pageHierarchy";
import { articleUpdateSchema, type ArticleUpdateRequest } from "@/lib/living-page/updateRequest";
import { after } from "next/server";
import { z } from "zod";
import { getServerDeps } from "@/lib/server/deps";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { type ActionResult, toActionResult } from "./result";

// =====================================================================
// PAGE ACTIONS (sidebar menu, Pages list, the page itself). Every edit
// is a typed action in a one-action ChangeSet, so it is listed on the
// Changes screen and can be undone. Removing retires (never deletes).
// =====================================================================

// The fields every action a person sends here shares
const PERSON_ACTION: Pick<DraftAction, "expectedRevisionId" | "passageIds" | "speechAct"> = { expectedRevisionId: null, passageIds: [], speechAct: null };

// CREATE: a page from a title; with an entity it gets a generated "Overview" section and is built
export async function createPage(input: { title: string; entityId: string | null }): Promise<ActionResult<{ pageId: string; slug: string }>> {
  return toActionResult(async () => {
    await requireUser();
    const sections = input.entityId ? [await entitySection(input.entityId, "Overview", null)] : [];
    const action: DraftAction = { ...PERSON_ACTION, type: "create_page", targetId: null, input: { title: input.title, entityId: input.entityId, sections } };
    const pageId = await commitOne(`Created page “${input.title.trim()}”`, action);
    const { db, writer } = await getServerDeps();
    await rebuildPage(db, writer, pageId);
    if (input.entityId) fillFromWebLater(await pageSectionIds(pageId), "");
    return { pageId, slug: await pageSlug(pageId) };
  });
}

// RENAME: changes the title only; the slug stays so links keep working
export async function renamePage(pageId: string, title: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    await commitOne(`Renamed a page to “${title.trim()}”`, { ...PERSON_ACTION, type: "rename_page", targetId: pageId, input: { title } });
    return {};
  });
}

// REMOVE: the page leaves the wiki (undo brings it back); no knowledge unit is touched
export async function deletePage(pageId: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    await commitOne("Removed a page", { ...PERSON_ACTION, type: "retire_page", targetId: pageId, input: {} });
    return {};
  });
}

// ADD SECTION: a generated section showing an entity's claims (optionally one kind), built right away
export async function createSection(input: { pageId: string; title: string; entityId: string; kind: UnitKind | null }): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const section = await entitySection(input.entityId, input.title, input.kind);
    const sectionId = await commitOne(`Added section “${section.title.trim()}”`, { ...PERSON_ACTION, type: "create_section", targetId: null, input: { pageId: input.pageId, ...section } });
    const { db, writer } = await getServerDeps();
    await rebuildPage(db, writer, input.pageId);
    fillFromWebLater([sectionId], "");
    return {};
  });
}

// RENAME SECTION
export async function renameSection(sectionId: string, title: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    await commitOne(`Renamed a section to “${title.trim()}”`, { ...PERSON_ACTION, type: "rename_section", targetId: sectionId, input: { title } });
    return {};
  });
}

// REMOVE SECTION: its lines leave the page with it (undo brings them back)
export async function removeSection(sectionId: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    await commitOne("Removed a section", { ...PERSON_ACTION, type: "retire_section", targetId: sectionId, input: {} });
    return {};
  });
}

// REMOVE LINE: the line leaves its section; the claims it stated stay
export async function removeLine(lineId: string, lineRevisionId: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    await commitOne("Removed a line", { ...PERSON_ACTION, type: "retire_line", targetId: lineId, input: { expectedLineRevisionId: lineRevisionId } });
    return {};
  });
}

// =====================================================================
// HELPERS
// =====================================================================

// Commits one action; throws the check's reason when it was not applied; returns its target (a create's new row)
async function commitOne(summary: string, action: DraftAction): Promise<string> {
  const { db } = await getServerDeps();
  const result: CommitResult = await commitPersonEdit(db, summary, [action]);
  const { data, error } = await getAdminSupabase().from("actions").select("target_id, check_results").eq("change_set_id", result.changeSetId).single();
  if (error) throw new Error(error.message);
  if (result.status !== "applied") throw new Error(failedCheckDetail(data.check_results) ?? "The change was not applied.");
  if (!data.target_id) throw new Error("The change was applied but has no target.");
  return data.target_id;
}

// Web searches one article build may run, so a large update cannot run up the search bill
const MAX_WEB_FILLS = 2;
// Sections a background web fill is working on, so a second build does not search them again meanwhile
const webFilling = new Set<string>();

// EXTERNAL KNOWLEDGE: when Settings allows it, thin sections among sectionIds are also filled from the
// web (see fillThinSectionsFromWeb). It runs after the response, so the build that asked for it returns
// at once and the page shows the new claims when the fill lands; a failure is only logged.
function fillFromWebLater(sectionIds: string[], note: string): void {
  const ids = sectionIds.filter((id) => !webFilling.has(id));
  if (!ids.length) return;
  for (const id of ids) webFilling.add(id);
  after(async () => {
    try {
      const { db, writer } = await getServerDeps();
      if (writer.name === "fake" || !(await readAllowExternalKnowledge(db))) return;
      const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
      if (!settings) return;
      settings.skills = await loadStageSkills(db);
      await fillThinSectionsFromWeb({ db, client: getAdminSupabase(), settings, writer, webSearchKey: webSearchKey() }, ids, note, MAX_WEB_FILLS);
    } catch (error) {
      console.warn("Web fill failed:", error instanceof Error ? error.message : error);
    } finally {
      for (const id of ids) webFilling.delete(id);
    }
  });
}

async function pageSectionIds(pageId: string): Promise<string[]> {
  const { db } = await getServerDeps();
  return (await db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId })).map((section) => section.sectionId);
}

// The first failed check's reason, from actions.check_results ([{ name, passed, detail }])
function failedCheckDetail(checks: unknown): string | null {
  if (!Array.isArray(checks)) return null;
  const failed = checks.find((check) => check && typeof check === "object" && check.passed === false);
  return typeof failed?.detail === "string" ? failed.detail : null;
}

// A section showing the entity's claims (all kinds, or one)
async function entitySection(entityId: string, title: string, kind: UnitKind | null): Promise<SectionDraft> {
  const { data, error } = await getAdminSupabase().from("entities").select("type, key").eq("id", entityId).single();
  if (error) throw new Error(error.message);
  const entity = { type: data.type, key: data.key };
  return { title, query: kind ? { entity, kinds: [kind] } : { entity } };
}

// The page's address (made by the database from its title)
async function pageSlug(pageId: string): Promise<string> {
  const { data, error } = await getAdminSupabase().from("pages").select("slug").eq("id", pageId).single();
  if (error) throw new Error(error.message);
  return data.slug;
}

// Reorganize an existing entity article through audited page/section actions.
export async function improveArticle(pageId: string): Promise<ActionResult> {
  return toActionResult(async () => {
    await requireUser();
    const admin = getAdminSupabase();
    const { data: page, error } = await admin.from("pages").select("entity_id").eq("id", pageId).is("retired_at", null).single();
    if (error) throw new Error(error.message);
    if (!page.entity_id) throw new Error("Link this page to an entity before generating an article.");
    const { data: entity, error: entityError } = await admin.from("entities").select("id, type, key, name").eq("id", page.entity_id).single();
    if (entityError) throw new Error(entityError.message);
    const { db, writer } = await getServerDeps();
    const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db));
    if (settings) settings.skills = await loadStageSkills(db);
    if (!settings) throw new Error("Configure an AI provider to structure this article.");
    const { actions } = await createArticlePlanner(settings, admin, true)([{ entityId: entity.id, type: entity.type, key: entity.key, name: entity.name, claimCount: 2, kinds: [], page: { pageId, coveredKinds: [], coversAll: true } }]);
    const result = await commitPersonEdit(db, "Organized article by subject with a content-based title", actions);
    if (result.status !== "applied") throw new Error("The article structure was not fully applied. Review the change set in Changes.");
    await rebuildPage(db, writer, pageId);
    fillFromWebLater(await pageSectionIds(pageId), "");
    return {};
  });
}

// Discover cited definitions, then let the Article Orchestrator propose and review articles for the entity's claims.
export async function expandRelatedArticles(pageId: string): Promise<ActionResult<{ entities: number; definitions: number; articles: number }>> {
  return toActionResult(async () => {
    await requireUser();
    const client = getAdminSupabase();
    const { data: page, error } = await client.from("pages").select("entity_id, context_entity_id").eq("id", pageId).is("retired_at", null).single();
    if (error) throw new Error(error.message);
    const entityId = page.context_entity_id ?? page.entity_id;
    if (!entityId) throw new Error("Choose the organization's main article to expand its knowledge.");
    const { db, writer } = await getServerDeps();
    const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db));
    if (settings) settings.skills = await loadStageSkills(db);
    if (!settings) throw new Error("Configure an AI provider before expanding knowledge.");
    const { entities, definitions } = await expandEntityKnowledge({ settings, client, db, writer }, entityId);
    const embedder = embedderFromEnv(process.env);
    const articles = await orchestrateEntityArticles({ settings, client, db, embedder }, entityId);
    for (const id of articles.pageIds) await rebuildPage(db, writer, id);
    await organizeExistingEntityContext(db, client, entityId);
    return { entities, definitions, articles: articles.created + articles.updated + articles.sections };
  });
}

// Explicit refresh reads current query results and current skill assignments on every run.
// scope "tree" refreshes the page and every page nested under it.
export async function updateArticle(input: ArticleUpdateRequest): Promise<ActionResult<{ sections: number; message?: string }>> {
  return toActionResult(async () => {
    await requireUser();
    const request = articleUpdateSchema.parse(input);
    const admin = getAdminSupabase();
    const { db, writer } = await getServerDeps();
    if (writer.name === "fake") throw new Error("Configure an AI provider in Settings before updating an article.");
    const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
    if (!settings) throw new Error("Configure an AI provider in Settings before updating an article.");
    settings.skills = await loadStageSkills(db);
    const restructure = await updateNeedsStructure(settings, request.note);
    if (request.scope === "section") {
      const { data: section, error } = await admin.from("sections").select("id, page_id").eq("id", request.id).is("retired_at", null).single();
      if (error) throw new Error("This article or section is no longer available. Reload the page and try again.");
      if (restructure) {
        const sections = await restructureUpdate(db, admin, settings, section.page_id, request.note, request.id);
        // Build only the new sections; unrelated sections keep their text.
        try {
          for (const target of sections) await refreshSectionStyle(db, writer, target.sectionId, request.note);
        } finally {
          await pruneEmptySections(db, sections.map((target) => target.sectionId));
        }
        const remaining = await db.call<SectionRef[]>("list_page_sections", { p_page_id: section.page_id });
        const createdIds = new Set(sections.map((target) => target.sectionId));
        fillFromWebLater(remaining.filter((target) => createdIds.has(target.sectionId)).map((target) => target.sectionId), request.note);
        return { sections: sections.length };
      }
      await refreshSectionStyle(db, writer, request.id, request.note);
      fillFromWebLater([request.id], request.note);
      return { sections: 1 };
    }
    const { data: pages, error } = await admin.from("pages").select("id,parent_page_id,title,scope,entity_id,context_entity_id").is("retired_at", null);
    if (error) throw new Error(error.message);
    if (!(pages ?? []).some((page) => page.id === request.id)) throw new Error("This article or section is no longer available. Reload the page and try again.");
    const pageIds = request.scope === "tree" ? pageAndDescendants(pages ?? [], request.id) : [request.id];
    let completed = 0;
    const webFillIds: string[] = [];
    try {
      for (const pageId of pageIds) {
        // Parent overviews must select evidence before rewriting. Generic discovery
        // would otherwise add the child process's claims straight back to the parent.
        if (pages!.some((page) => page.parent_page_id === pageId)) {
          const outcomes = await refreshOrganizationOverviews({ db, client: admin, settings }, null, { pageIds: [pageId] });
          const overview = outcomes.find((outcome) => outcome.pageId === pageId);
          if (overview?.status === "failed") throw new Error(overview.detail ?? "Could not update the article overview.");
          if (overview?.status === "applied") {
            const completedBeforePage = completed;
            try {
              const sections = await db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId });
              for (const section of sections) {
                await refreshSectionStyle(db, writer, section.sectionId, request.note);
                completed++;
              }
            } catch (error) {
              // Restore the old outline and its text when a replacement writer
              // fails. A failed Update must not leave a formerly complete page empty.
              if (overview.changeSetId) {
                await revertChangeSet(db, overview.changeSetId);
                completed = completedBeforePage;
              }
              throw error;
            }
            continue;
          }
        }
        const existing = await db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId });
        const candidates = existing.length ? [] : await emptyArticleCandidates(db, admin, pages!.find((page) => page.id === pageId)!, pages!,
          embedderFromEnv(process.env, (call) => db.call("log_ai_call", { p_call: { ...call, purpose: "empty_article_retrieval" } })));
        if (restructure && existing.length) await restructureUpdate(db, admin, settings, pageId, request.note);
        const repairs = await repairEmptyIntroductions(db, admin, pageId);
        const { sections: additions, tokensIn, tokensOut } = await discoverArticleUpdates(db, admin, settings, pageId, request.note, candidates);
        if (additions.length || repairs.length) {
          const actions: DraftAction[] = [...repairs, ...additions.map((section): DraftAction => ({ ...PERSON_ACTION, type: "create_section", targetId: null, input: { pageId, ...section } }))];
          const { changeSetId } = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, {
            summary: "Updated article knowledge selections and introduction", actions,
            trace: { modelVersion: settings.model ?? null, promptVersion: skillTrace("article-update-discovery-v1", ["plan_articles"], settings.skills), tokensIn, tokensOut },
          });
          const result = await commitChangeSet(db, changeSetId);
          if (result.status !== "applied") throw new Error("New sections were not fully applied. Review Changes before retrying.");
        }
        const sections = await db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId });
        try {
          for (const section of sections) {
            await refreshSectionStyle(db, writer, section.sectionId, request.note);
            completed++;
          }
        } finally {
          await pruneEmptySections(db, sections.map((section) => section.sectionId));
        }
        const remaining = await db.call<SectionRef[]>("list_page_sections", { p_page_id: pageId });
        webFillIds.push(...remaining.map((section) => section.sectionId));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The AI update failed.";
      throw new Error(`${completed ? `${completed} section(s) updated before the update stopped. ` : ""}${detail}`);
    }
    if (!completed) return { sections: 0, message: "No saved knowledge fits this article yet. Add a relevant source, then try Update again." };
    fillFromWebLater(webFillIds, request.note);
    return { sections: completed };
  });
}

// FORCE CREATE OPTIONS: whether the dialog may offer a web search (allowed on /settings)
export async function forceCreateOptions(): Promise<ActionResult<{ webAllowed: boolean; webReady: boolean }>> {
  return toActionResult(async () => {
    await requireUser();
    const { db } = await getServerDeps();
    // Wikipedia needs no key, so the web is always reachable
    return { webAllowed: await readAllowExternalKnowledge(db), webReady: true };
  });
}

// FORCE CREATE: fills one section from the saved claims that fit its heading and, when asked
// and allowed, from web pages stored as external sources (see lib/living-page/forceCreateSection)
export async function forceCreateSection(input: { sectionId: string; note: string; useWeb: boolean }): Promise<ActionResult<ForceCreateResult>> {
  return toActionResult(async () => {
    await requireUser();
    const request = z.object({ sectionId: z.uuid(), note: z.string().max(2000), useWeb: z.boolean() }).parse(input);
    const { db, writer } = await getServerDeps();
    if (writer.name === "fake") throw new Error("Configure an AI provider in Settings before using Force Create.");
    const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
    if (!settings) throw new Error("Configure an AI provider in Settings before using Force Create.");
    settings.skills = await loadStageSkills(db);
    if (request.useWeb && !(await readAllowExternalKnowledge(db))) throw new Error("External knowledge is turned off in Settings.");
    return runForceCreate({ db, client: getAdminSupabase(), settings, writer, webSearchKey: webSearchKey() }, request.sectionId, request.note.trim(), request.useWeb);
  });
}

// One section is rewritten at a time per server process, so the article page and the
// background sweep do not both ask the model to rewrite it.
const rebuildingSections = new Set<string>();

async function rewriteStaleSections(sectionIds: string[]): Promise<number> {
  const { db, writer } = await getServerDeps();
  const enabled = await readAutoUpdateStale(db);
  if (!enabled) return 0;
  let completed = 0;
  for (const sectionId of sectionIds) {
    if (rebuildingSections.has(sectionId)) continue;
    rebuildingSections.add(sectionId);
    try {
      const state = await db.call<SectionState>("read_section_state", { p_section_id: sectionId });
      const { data: section, error } = await getAdminSupabase().from("sections").select("status,build_cancelled").eq("id", sectionId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!section || section.build_cancelled || section.status === "building") continue;
      const stale = section.status === "stale" || state.lines.some((line) => line.needsRewrite);
      if (!stale) continue;
      const finished = await rebuildSection(db, writer, sectionId, null);
      if (finished && !finished.rebuildRequested) completed += 1;
    } finally {
      rebuildingSections.delete(sectionId);
    }
  }
  return completed;
}

// AUTO-UPDATE: rewrites sections that still cite an old claim.
// Off in Settings, this returns without writing. Update still works.
export async function refreshStaleSections(sectionIds: string[]): Promise<ActionResult<{ sections: number }>> {
  return toActionResult(async () => {
    await requireUser();
    const ids = z.array(z.uuid()).max(30).parse(sectionIds);
    return { sections: await rewriteStaleSections(ids) };
  });
}

// BACKGROUND: any signed-in page can start the pending rewrites. The article does not have to be open.
export async function refreshPendingStaleSections(): Promise<ActionResult<{ sections: number }>> {
  return toActionResult(async () => {
    await requireUser();
    const { data, error } = await getAdminSupabase().from("stale_lines").select("section_id");
    if (error) throw new Error(error.message);
    const ids = [...new Set((data ?? []).flatMap((row) => row.section_id ? [row.section_id] : []))].slice(0, 30);
    return { sections: await rewriteStaleSections(ids) };
  });
}
