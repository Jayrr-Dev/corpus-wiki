import "server-only";
import { z } from "zod";
import { addUsage, chatJson, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import { skillInstructions, skillTrace } from "@/lib/ai/skills/prompt";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { CuratorSnapshot } from "@/lib/curator/curate";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { loadArticleKnowledge } from "./articlePlanner";
import type { ArticleKnowledge } from "./articlePlan";
import { descendantClaimIds, isDetailClaim, placeholderPageHealth, OVERVIEW_PROMPT, overviewActions, overviewMessages, overviewPlanSchema, overviewSections, organizationPageHealth, type OrganizationPageHealth, type OverviewInput } from "./organizationOverview";
import { rebuildPage, type SectionWriter } from "./index";
import type { SectionDraft } from "@/lib/ai/types";
import { CONTEXT_OWNER_TYPES } from "@/lib/knowledge/entityTypes";

// =====================================================================
// REFRESH ORGANIZATION OVERVIEWS: after an upload, a Curator run, or an
// accepted Curator change, every organization page that repeats the pages
// under it is re-planned as an overview (the Planner's role), through
// change control, and rebuilt. Pages with lines a person wrote are left
// alone. Nothing happens, and no AI is called, when no page needs it.
// =====================================================================

export const OVERVIEW_PROMPT_VERSION = "organization-overview-v2";
// The opening chooses from at most this many of the children's claims
const BORROWED_CHOICES = 20;

export type OverviewDeps = { settings: TokenFactorySettings; client: AdminSupabase; db: DbRpc; writer?: SectionWriter };
export type OverviewOutcome = OrganizationPageHealth & { status: "planned" | "applied" | "skipped" | "failed"; detail: string | null; sections: SectionDraft[] };

// Claims by id, in the shape the planner reads
async function loadUnits(client: AdminSupabase, unitIds: string[]): Promise<ArticleKnowledge["units"]> {
  if (!unitIds.length) return [];
  const { data: units, error } = await client.from("units").select("id, current_revision_id, kind, epistemic_status").in("id", unitIds).is("retired_at", null).order("id");
  if (error) throw new Error(error.message);
  const { data: revisions, error: revisionError } = await client.from("revisions").select("id, content").in("id", (units ?? []).map((unit) => unit.current_revision_id));
  if (revisionError) throw new Error(revisionError.message);
  const content = new Map((revisions ?? []).map((revision) => [revision.id, revision.content]));
  return (units ?? []).map((unit) => ({ unitId: unit.id, revisionId: unit.current_revision_id, content: content.get(unit.current_revision_id) ?? "", kind: unit.kind, epistemicStatus: unit.epistemic_status }));
}

// The organization a page is titled after
async function organizationOf(client: AdminSupabase, title: string): Promise<ArticleKnowledge["entity"] | null> {
  // Looked up by name, then alias: never by listing every entity past the API's row cap
  const live = () => client.from("entities").select("id, type, key, name, aliases").in("type", CONTEXT_OWNER_TYPES).is("retired_at", null).is("merged_into_id", null);
  const byName = await live().ilike("name", title.trim().replace(/[%_\\]/g, "\\$&"));
  if (byName.error) throw new Error(byName.error.message);
  const byAlias = byName.data?.length ? null : await live().contains("aliases", [title.trim()]);
  if (byAlias?.error) throw new Error(byAlias.error.message);
  const match = [...(byName.data ?? []), ...(byAlias?.data ?? [])][0];
  return match ? { id: match.id, type: match.type, key: match.key, name: match.name } : null;
}

// THE PLANNER IN OVERVIEW MODE: one call, with one corrective retry
export async function planOverview(settings: TokenFactorySettings, input: OverviewInput): Promise<TokenUsage & { sections: SectionDraft[] }> {
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: `${skillInstructions(["plan_articles"], settings.skills)}\n${OVERVIEW_PROMPT}` },
    { role: "user", content: overviewMessages(input) },
  ];
  let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
  for (let attempt = 0; ; attempt++) {
    const answer = await chatJson(settings, { name: "article_outline", subject: input.organization.name, schema: overviewPlanSchema, jsonSchema: z.toJSONSchema(overviewPlanSchema), maxTokens: 4000, messages });
    usage = addUsage(usage, answer);
    try { return { sections: overviewSections(answer.value, input), ...usage }; }
    catch (error) {
      if (attempt >= 1) throw error;
      messages.push({ role: "user", content: `Your previous overview was ${JSON.stringify(answer.value)}. Validation failed: ${error instanceof Error ? error.message : String(error)}. Return the complete corrected overview.` });
    }
  }
}

// What the Planner reads for one organization page
export async function overviewInput(client: AdminSupabase, snapshot: CuratorSnapshot, health: OrganizationPageHealth): Promise<OverviewInput | string> {
  const page = snapshot.pages.find((item) => item.id === health.pageId)!;
  // A placeholder topic page has no organization: its overview stands on the pages under it
  const organization = page.organization ? await organizationOf(client, health.title) : { id: "", type: "", key: "", name: health.title };
  if (!organization) return "No organization entity matches the page title.";
  const below = descendantClaimIds(snapshot.pages, page.id);
  let about: ArticleKnowledge["units"] = [];
  if (organization.id) try { about = (await loadArticleKnowledge(client, organization.id)).units; } catch { /* an organization with no claims of its own */ }
  // Its own: claims about it, and claims the page cites today, that no page under it cites
  const ownIds = new Set([...about.map((unit) => unit.unitId), ...page.claimIds].filter((id) => !below.has(id)));
  const aboutById = new Map(about.map((unit) => [unit.unitId, unit]));
  const missing = [...ownIds].filter((id) => !aboutById.has(id));
  const loaded = new Map((await loadUnits(client, missing)).map((unit) => [unit.unitId, unit]));
  const own = [...ownIds].flatMap((id) => aboutById.get(id) ?? loaded.get(id) ?? []);
  // The opening may borrow from the children: claims about the organization first
  // (a topic page has none of its own, so it chooses from every claim under it)
  const borrowedIds = [...new Set(organization.id
    ? [...about.map((unit) => unit.unitId).filter((id) => below.has(id)), ...page.claimIds.filter((id) => below.has(id))]
    : [...below])].slice(0, BORROWED_CHOICES);
  const borrowedLoaded = new Map((await loadUnits(client, borrowedIds.filter((id) => !aboutById.has(id)))).map((unit) => [unit.unitId, unit]));
  // A topic's opening never borrows a measurement or limit: those stay on the child pages
  const borrowed = borrowedIds.flatMap((id) => aboutById.get(id) ?? borrowedLoaded.get(id) ?? []).filter((unit) => organization.id || !isDetailClaim(unit.content));
  const childPages = snapshot.pages.filter((child) => child.parentId === page.id).map((child) => child.title);
  return { organization, own, borrowed, childPages };
}

// THE PLANNER'S OVERVIEW MODE for one page: null when it is not an organization page with
// pages under it (then it is planned as an ordinary article)
export async function organizationOverviewPlan(settings: TokenFactorySettings, client: AdminSupabase, db: DbRpc, pageId: string): Promise<(TokenUsage & { sections: SectionDraft[] }) | null> {
  const snapshot = await db.call<CuratorSnapshot>("curator_snapshot");
  const health = [...organizationPageHealth(snapshot.pages), ...placeholderPageHealth(snapshot.pages)].find((page) => page.pageId === pageId);
  if (!health) return null;
  const input = await overviewInput(client, snapshot, health);
  return typeof input === "string" ? null : planOverview(settings, input);
}

// Generated sections the overview replaces; null when a person wrote any of their lines
async function replaceableSections(client: AdminSupabase, pageId: string): Promise<string[] | null> {
  const { data: sections, error } = await client.from("sections").select("id, mode").eq("page_id", pageId).is("retired_at", null);
  if (error) throw new Error(error.message);
  const generated = (sections ?? []).filter((section) => section.mode === "generated").map((section) => section.id);
  if (!generated.length) return [];
  const { data: lines, error: lineError } = await client.from("section_lines").select("section_id, author").in("section_id", generated);
  if (lineError) throw new Error(lineError.message);
  return (lines ?? []).some((line) => line.author === "person") ? null : generated;
}

// RUN: every organization page that repeats its children; dryRun plans without saving
// pageIds: re-plan these organization pages even when they already pass (after a prompt change)
export async function refreshOrganizationOverviews(deps: OverviewDeps, eventId: string | null, options: { dryRun?: boolean; pageIds?: string[] } = {}): Promise<OverviewOutcome[]> {
  const snapshot = await deps.db.call<CuratorSnapshot>("curator_snapshot");
  const outcomes: OverviewOutcome[] = [];
  const chosen = (page: OrganizationPageHealth) => (options.pageIds ? options.pageIds.includes(page.pageId) : page.needsOverview);
  // Organization pages that repeat their children, and placeholder pages waiting for an overview
  for (const health of [...organizationPageHealth(snapshot.pages), ...placeholderPageHealth(snapshot.pages)].filter(chosen)) {
    const outcome = (status: OverviewOutcome["status"], detail: string | null, sections: SectionDraft[] = []): OverviewOutcome => ({ ...health, status, detail, sections });
    try {
      const replace = await replaceableSections(deps.client, health.pageId);
      if (!replace) { outcomes.push(outcome("skipped", "A person wrote lines on this page; it is left as it is.")); continue; }
      const input = await overviewInput(deps.client, snapshot, health);
      if (typeof input === "string") { outcomes.push(outcome("skipped", input)); continue; }
      // No claim says what the topic is: the page's scope introduces it (no AI call), and an
      // older overview that only repeated its children's details is taken out
      if (!input.own.length && !input.borrowed.length) {
        if (!replace.length || options.dryRun) { outcomes.push(outcome(options.dryRun && replace.length ? "planned" : "skipped", "No general claim fits; the page's scope introduces it.")); continue; }
        const { changeSetId } = await submitChangeSet(deps.db, { eventId, cause: eventId ? "upload" : "edit", actor: "ai", operationKey: `overview:${eventId ?? "manual"}:${health.pageId}:${crypto.randomUUID()}` }, {
          summary: `Planner: “${health.title}” is introduced by its scope; removed an opening that repeated its pages' details`,
          actions: overviewActions(health.pageId, [], replace),
          trace: { modelVersion: null, promptVersion: OVERVIEW_PROMPT_VERSION, tokensIn: 0, tokensOut: 0 },
        });
        const result = await commitChangeSet(deps.db, changeSetId);
        outcomes.push(outcome(result.status === "rejected" ? "failed" : "applied", "The page's scope introduces it; its pages are listed under it."));
        continue;
      }
      const { sections, ...usage } = await planOverview(deps.settings, input);
      if (options.dryRun) { outcomes.push(outcome("planned", null, sections)); continue; }
      const { changeSetId } = await submitChangeSet(deps.db, { eventId, cause: eventId ? "upload" : "edit", actor: "ai", operationKey: `overview:${eventId ?? "manual"}:${health.pageId}:${crypto.randomUUID()}` }, {
        summary: `Planner: made “${health.title}” an overview of its pages`,
        actions: overviewActions(health.pageId, sections, replace),
        trace: { modelVersion: deps.settings.model ?? null, promptVersion: skillTrace(OVERVIEW_PROMPT_VERSION, ["plan_articles"], deps.settings.skills), tokensIn: usage.tokensIn, tokensOut: usage.tokensOut },
      });
      const result = await commitChangeSet(deps.db, changeSetId);
      if (result.status === "rejected") { outcomes.push(outcome("failed", "Change control rejected the new outline.", sections)); continue; }
      if (deps.writer) await rebuildPage(deps.db, deps.writer, health.pageId);
      outcomes.push(outcome("applied", null, sections));
    } catch (error) {
      outcomes.push(outcome("failed", error instanceof Error ? error.message : String(error)));
    }
  }
  return outcomes;
}
