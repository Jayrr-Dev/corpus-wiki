"use server";

import type { DraftAction, SectionDraft, UnitKind } from "@/lib/ai/types";
import { loadStageSkills } from "@/lib/ai/skills/server";
import { skillTrace } from "@/lib/ai/skills/prompt";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readChosenModel } from "@/lib/ai/models";
import { expandEntityKnowledge } from "@/lib/living-page/knowledgeExpansion";
import { createArticlePlanner } from "@/lib/living-page/articlePlanner";
import { requireUser } from "@/lib/auth/requireUser";
import { type CommitResult, commitPersonEdit, submitChangeSet, commitChangeSet } from "@/lib/change-control";
import { rebuildPage, type SectionRef } from "@/lib/living-page";
import { refreshSectionStyle } from "@/lib/living-page/refreshStyle";
import { discoverArticleUpdates, repairEmptyIntroductions } from "@/lib/living-page/discoverArticleUpdates";
import { articleUpdateSchema, type ArticleUpdateRequest } from "@/lib/living-page/updateRequest";
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
    await commitOne(`Added section “${section.title.trim()}”`, { ...PERSON_ACTION, type: "create_section", targetId: null, input: { pageId: input.pageId, ...section } });
    const { db, writer } = await getServerDeps();
    await rebuildPage(db, writer, input.pageId);
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
    const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db));
    if (settings) settings.skills = await loadStageSkills(db);
    if (!settings) throw new Error("Configure an AI provider to structure this article.");
    const actions = await createArticlePlanner(settings, admin, true)([{ entityId: entity.id, type: entity.type, key: entity.key, name: entity.name, claimCount: 2, kinds: [], page: { pageId, coveredKinds: [], coversAll: true } }]);
    const result = await commitPersonEdit(db, "Organized article by subject with a content-based title", actions);
    if (result.status !== "applied") throw new Error("The article structure was not fully applied. Review the change set in Changes.");
    await rebuildPage(db, writer, pageId);
    return {};
  });
}

// Discover cited definitions, domain articles, and an organization overview.
export async function expandRelatedArticles(pageId: string): Promise<ActionResult<{ entities: number; definitions: number; articles: number }>> {
  return toActionResult(async () => {
    await requireUser();
    const client = getAdminSupabase();
    const { data: page, error } = await client.from("pages").select("entity_id, context_entity_id").eq("id", pageId).is("retired_at", null).single();
    if (error) throw new Error(error.message);
    const entityId = page.context_entity_id ?? page.entity_id;
    if (!entityId) throw new Error("Choose the organization's main article to expand its knowledge.");
    const { db, writer } = await getServerDeps();
    const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db));
    if (settings) settings.skills = await loadStageSkills(db);
    if (!settings) throw new Error("Configure an AI provider before expanding knowledge.");
    return expandEntityKnowledge({ settings, client, db, writer }, entityId);
  });
}

// Explicit refresh reads current query results and current skill assignments on every run.
export async function updateArticle(input: ArticleUpdateRequest): Promise<ActionResult<{ sections: number }>> {
  return toActionResult(async () => {
    await requireUser();
    const request = articleUpdateSchema.parse(input);
    const admin = getAdminSupabase();
    const table = request.scope === "page" ? "pages" : "sections";
    const { error } = await admin.from(table).select("id").eq("id", request.id).is("retired_at", null).single();
    if (error) throw new Error("This article or section is no longer available. Reload the page and try again.");
    const { db, writer } = await getServerDeps();
    if (writer.name === "fake") throw new Error("Configure an AI provider in Settings before updating an article.");
    if (request.scope === "page") {
      const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db), (call) => db.call("log_ai_call", { p_call: call }));
      if (!settings) throw new Error("Configure an AI provider in Settings before updating an article.");
      settings.skills = await loadStageSkills(db);
      const repairs = await repairEmptyIntroductions(db, admin, request.id);
      const additions = await discoverArticleUpdates(db, admin, settings, request.id, request.note);
      if (additions.length || repairs.length) {
        const actions: DraftAction[] = [...repairs, ...additions.map((section): DraftAction => ({ ...PERSON_ACTION, type: "create_section", targetId: null, input: { pageId: request.id, ...section } }))];
        const { changeSetId } = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, {
          summary: "Updated article knowledge selections and introduction", actions,
          trace: { modelVersion: settings.model ?? null, promptVersion: skillTrace("article-update-discovery-v1", ["plan_articles"], settings.skills), tokensIn: null, tokensOut: null },
        });
        const result = await commitChangeSet(db, changeSetId);
        if (result.status !== "applied") throw new Error("New sections were not fully applied. Review Changes before retrying.");
      }
    }
    const sections = request.scope === "page"
      ? await db.call<SectionRef[]>("list_page_sections", { p_page_id: request.id })
      : [{ sectionId: request.id }];
    if (!sections.length) throw new Error("Add a generated section before updating this article.");
    let completed = 0;
    try {
      for (const section of sections) {
        await refreshSectionStyle(db, writer, section.sectionId, request.note);
        completed++;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The AI update failed.";
      throw new Error(`${completed ? `${completed} section(s) updated before the update stopped. ` : ""}${detail}`);
    }
    return { sections: completed };
  });
}
